import { randomUUID } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";

import { NextResponse } from "next/server";
import { SarvamAIClient } from "sarvamai";

export const runtime = "nodejs";
export const maxDuration = 300;

type DiarizedEntry = {
  speaker_id?: string;
  transcript?: string;
  start_time_seconds?: number;
  end_time_seconds?: number;
};

function getEntries(value: any): DiarizedEntry[] {
  const candidates = [
    value?.diarized_transcript?.entries,
    value?.diarizedTranscript?.entries,
    value?.data?.diarized_transcript?.entries,
    value?.data?.diarizedTranscript?.entries,
    value?.results?.[0]?.diarized_transcript?.entries,
    value?.results?.[0]?.diarizedTranscript?.entries,
  ];

  return candidates.find(Array.isArray) || [];
}

function getTranscript(value: any) {
  return (
    value?.transcript ||
    value?.text ||
    value?.data?.transcript ||
    value?.data?.text ||
    value?.results?.[0]?.transcript ||
    value?.results?.[0]?.text ||
    ""
  );
}

function formatDiarizedTranscript(entries: DiarizedEntry[]) {
  const lines: string[] = [];

  for (const entry of entries) {
    const text = entry.transcript?.trim();
    if (!text) continue;

    const speaker = entry.speaker_id || "Speaker";
    const lastLine = lines[lines.length - 1];
    const prefix = `${speaker}:`;

    if (lastLine?.startsWith(prefix)) {
      lines[lines.length - 1] = `${lastLine} ${text}`;
    } else {
      lines.push(`${prefix} ${text}`);
    }
  }

  return lines.join("\n");
}

export async function POST(req: Request) {
  const apiKey = process.env.API_KEY || process.env.SARVAM_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing API_KEY" },
      { status: 500 }
    );
  }

  const workDir = path.join(os.tmpdir(), `sarvam-diarize-${randomUUID()}`);

  try {
    const formData = await req.formData();
    const audio = formData.get("audio");
    const numSpeakersValue = formData.get("numSpeakers");
    const numSpeakers =
      typeof numSpeakersValue === "string"
        ? Number.parseInt(numSpeakersValue, 10)
        : 2;

    if (!(audio instanceof File)) {
      return NextResponse.json(
        { error: "Missing audio file" },
        { status: 400 }
      );
    }

    await mkdir(workDir, { recursive: true });

    const inputFileName = "encounter.wav";
    const inputPath = path.join(workDir, inputFileName);
    const audioBuffer = Buffer.from(await audio.arrayBuffer());

    await writeFile(inputPath, audioBuffer);

    const client = new SarvamAIClient({
      apiSubscriptionKey: apiKey,
      timeoutInSeconds: 120,
    });

    const job = await client.speechToTextTranslateJob.createJob({
      withDiarization: true,
      numSpeakers: Number.isFinite(numSpeakers) ? numSpeakers : 2,
    });

    const uploadLinks =
      await client.speechToTextTranslateJob.getUploadLinks({
        body: {
          job_id: job.jobId,
          files: [inputFileName],
        },
      });

    const uploadUrl = uploadLinks.upload_urls[inputFileName]?.file_url;
    if (!uploadUrl) {
      throw new Error("Sarvam did not return an upload URL");
    }

    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      body: audioBuffer,
      headers: {
        "Content-Type": "audio/wav",
        "x-ms-blob-type": "BlockBlob",
      },
    });

    if (!uploadResponse.ok) {
      throw new Error(`Audio upload failed: ${uploadResponse.status}`);
    }

    await job.start();

    const status = await job.waitUntilComplete(5, 240);
    if (status.job_state.toLowerCase() !== "completed") {
      return NextResponse.json(
        {
          error: "Diarization job failed",
          status,
        },
        { status: 502 }
      );
    }

    const outputDir = path.join(workDir, "outputs");
    await job.downloadOutputs(outputDir);

    const outputPath = path.join(outputDir, `${inputFileName}.json`);
    const output = JSON.parse(await readFile(outputPath, "utf8"));
    const entries = getEntries(output);
    const diarizedTranscript = formatDiarizedTranscript(entries);
    const transcript = diarizedTranscript || getTranscript(output);

    if (!transcript) {
      return NextResponse.json(
        { error: "No diarized transcript returned", raw: output },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      jobId: job.jobId,
      transcript,
      entries,
      raw: output,
    });
  } catch (err: any) {
    console.error("DIARIZATION ERROR", err);

    return NextResponse.json(
      {
        success: false,
        error: err?.message || "Diarization failed",
      },
      { status: 500 }
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
