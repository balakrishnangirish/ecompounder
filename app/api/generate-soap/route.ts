import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MODEL =
  "google/medgemma-4b-it";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const transcript = body.transcript;

    if (!transcript) {
      return NextResponse.json(
        { error: "Missing transcript" },
        { status: 400 }
      );
    }

    const prompt = `
You are a clinical AI assistant.

Convert the following medical conversation into a professional SOAP note.

Transcript:
${transcript}

SOAP Note:
`;

const response = await fetch(
  `https://api-inference.huggingface.co/models/${MODEL}`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.HF_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        max_new_tokens: 700,
        temperature: 0.2,
      },
    }),
    // 🔥 IMPORTANT: avoid hanging DNS issues in serverless
    signal: AbortSignal.timeout(30000),
  }
);

    const result = await response.json();

    const soap =
      result?.[0]?.generated_text ||
      "SOAP generation failed.";

    return NextResponse.json({
      success: true,
      soap,
    });

  } catch (err: any) {
    console.error("SOAP ERROR", err);

    return NextResponse.json(
      {
        success: false,
        error: err.message,
      },
      { status: 500 }
    );
  }
}
