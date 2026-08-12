import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

export const runtime = "nodejs";

async function transcribeAudio(file: File, jobId: string) {
  console.log(`[${jobId}] STEP 1: sending audio directly to Sarvam`);

  const form = new FormData();
  form.append("file", file, "audio.wav");
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
    console.error(`[${jobId}] FAILED`, text);
    throw new Error(`Transcription failed: ${res.status}`);
  }

  const json = JSON.parse(text);
  return json.text || json.transcript || "";
}

export async function POST(request: Request) {
  const jobId = uuidv4();

  try {
    console.log(`[${jobId}] REQUEST RECEIVED`);

    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;

    if (!audioFile) {
      return NextResponse.json(
        { error: "Missing audio file" },
        { status: 400 }
      );
    }

    // 🔥 NO FILE SYSTEM, NO FFMPEG
    const transcript = await transcribeAudio(audioFile, jobId);

    return NextResponse.json({
      success: true,
      jobId,
      transcript,
    });

  } catch (err: any) {
    console.error(`[${jobId}] ERROR`, err);

    return NextResponse.json(
      {
        success: false,
        error: "Transcription failed",
        message: err?.message,
        jobId,
      },
      { status: 500 }
    );
  }
}
