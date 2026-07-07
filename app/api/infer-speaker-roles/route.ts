import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Role = "Doctor" | "Patient" | "Speaker";

function extractJson(content: string) {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  if (start === -1 || end === -1) {
    throw new Error("Invalid role inference JSON");
  }

  return JSON.parse(content.slice(start, end + 1));
}

export async function POST(req: Request) {
  try {
    const { transcript, speakers, patientName } = await req.json();

    if (!transcript || !Array.isArray(speakers) || speakers.length === 0) {
      return NextResponse.json(
        { error: "Missing transcript or speakers" },
        { status: 400 }
      );
    }

    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: "Missing GROQ_API_KEY" },
        { status: 500 }
      );
    }

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          temperature: 0,
          messages: [
            {
              role: "system",
              content: `
You infer clinical speaker roles from diarized consultation transcripts.

Rules:
- Output ONLY valid JSON.
- Do not include markdown or commentary.
- Map each provided speaker ID to one of: "Doctor", "Patient", "Speaker".
- Use "Speaker" when uncertain.
- Prefer "Doctor" for the speaker asking clinical questions, giving advice, prescribing, assessing, or explaining plans.
- Prefer "Patient" for the speaker describing symptoms, history, concerns, or answering questions.

Return exactly:
{
  "roles": {
    "SPEAKER_ID": "Doctor"
  }
}
              `.trim(),
            },
            {
              role: "user",
              content: JSON.stringify({
                speakers,
                patientName: patientName || "",
                transcript,
              }),
            },
          ],
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data?.error?.message || "Role inference failed" },
        { status: response.status }
      );
    }

    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        { error: "No role inference output" },
        { status: 500 }
      );
    }

    const parsed = extractJson(content);
    const roles: Record<string, Role> = {};

    for (const speaker of speakers) {
      const role = parsed?.roles?.[speaker];
      roles[speaker] =
        role === "Doctor" || role === "Patient" || role === "Speaker"
          ? role
          : "Speaker";
    }

    return NextResponse.json({ roles });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Role inference failed" },
      { status: 500 }
    );
  }
}
