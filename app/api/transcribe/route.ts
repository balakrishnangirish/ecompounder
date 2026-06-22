import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { exec } from "child_process";

export const runtime = "nodejs";

const CHUNK_SIZE_SECONDS = 25;
const TMP_ROOT = "/tmp";

function run(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) reject(stderr || err.message);
      else resolve(stdout);
    });
  });
}

async function transcribeFile(filePath: string, jobId: string, i: number) {
  console.log(`[${jobId}] STEP 7.${i}: sending chunk to Sarvam`);

  const fileBuffer = fs.readFileSync(filePath);

  const blob = new Blob([fileBuffer], { type: "audio/wav" });

  const form = new FormData();
  form.append("file", blob, "chunk.wav");
  form.append("model", "saaras:v3");

  const res = await fetch("https://api.sarvam.ai/speech-to-text", {
    method: "POST",
    headers: {
      "api-subscription-key": process.env.API_KEY!,
    },
    body: form,
  });

  const text = await res.text();

  if (!res.ok) {
    console.error(`[${jobId}] STEP 7.${i}: FAILED`, text);
    throw new Error(`Chunk failed: ${res.status}`);
  }

  try {
    const json = JSON.parse(text);
    return json.text || json.transcript || "";
  } catch {
    return "";
  }
}

async function splitAudio(inputPath: string, outputDir: string, jobId: string) {
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`[${jobId}] STEP 3: starting ffmpeg chunking`);

  const cmd = `
    ffmpeg -i "${inputPath}" \
    -ac 1 \
    -ar 16000 \
    -c:a pcm_s16le \
    -f segment \
    -segment_time ${CHUNK_SIZE_SECONDS} \
    "${outputDir}/chunk_%03d.wav"
  `;

  const result = await run(cmd);

  console.log(`[${jobId}] STEP 4: ffmpeg finished`);
  console.log(`[${jobId}] ffmpeg output:`, result);
}

export async function POST(request: Request) {
  const jobId = uuidv4();
  const jobDir = path.join(TMP_ROOT, `transcribe-${jobId}`);
  const inputPath = path.join(jobDir, "input.wav");
  const chunkDir = path.join(jobDir, "chunks");

  fs.mkdirSync(jobDir, { recursive: true });

  try {
    console.log(`[${jobId}] STEP 1: request received`);

    // STEP 1: Parse file
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;

    if (!audioFile) {
      return NextResponse.json(
        { error: "Missing audio file" },
        { status: 400 }
      );
    }

    // STEP 2: write input file
    console.log(`[${jobId}] STEP 2: writing input file`);

    const buffer = Buffer.from(await audioFile.arrayBuffer());
    fs.writeFileSync(inputPath, buffer);

    console.log(`[${jobId}] STEP 2 COMPLETE: file saved at ${inputPath}`);

    // STEP 3–4: split audio
    await splitAudio(inputPath, chunkDir, jobId);

    // STEP 5: load chunks
    console.log(`[${jobId}] STEP 5: reading chunks`);

    const chunks = fs
      .readdirSync(chunkDir)
      .filter(f => f.endsWith(".wav"))
      .map(f => path.join(chunkDir, f))
      .sort();

    console.log(`[${jobId}] STEP 5 COMPLETE: ${chunks.length} chunks found`);

    if (chunks.length === 0) {
      throw new Error("No audio chunks generated (ffmpeg likely failed)");
    }

    // STEP 6: transcription loop
    console.log(`[${jobId}] STEP 6: starting transcription loop`);

    const transcriptParts: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      try {
        const text = await transcribeFile(chunks[i], jobId, i);
        transcriptParts.push(text);
      } catch (err) {
        console.error(`[${jobId}] STEP 7.${i} FAILED`, err);
      }
    }
    // STEP 8: final merge
    console.log(`[${jobId}] STEP 8: merging transcript`);

    const finalTranscript = transcriptParts.join(" ").trim();

    console.log(`[${jobId}] STEP 8 COMPLETE`);

    return NextResponse.json({
      success: true,
      jobId,
      chunks: chunks.length,
      transcript: finalTranscript,
    });

  } catch (err: any) {
    console.error(`[${jobId}] FULL FAILURE TRACE:`, err);

    return NextResponse.json(
      {
        success: false,
        error: "Transcription failed",
        message: err?.message,
        jobId,
      },
      { status: 500 }
    );

  } finally {
    try {
      fs.rmSync(jobDir, { recursive: true, force: true });
      console.log(`[${jobId}] cleanup complete`);
    } catch (e) {
      console.error(`[${jobId}] cleanup failed`, e);
    }
  }
}