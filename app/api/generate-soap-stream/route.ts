import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { transcript } = await req.json();

    if (!transcript) {
      return NextResponse.json(
        { error: "Missing transcript" },
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
          temperature: 0.1,
          messages: [
            {
              role: "system",
              content: `
You are a clinical documentation engine.

OUTPUT RULES (STRICT):
- Output ONLY valid JSON
- No markdown
- No commentary
- No extra text

Return EXACTLY this format:

{
  "subjective": "",
  "objective": "",
  "assessment": "",
  "plan": ""
}

If unknown, use "".
              `.trim(),
            },
            {
              role: "user",
              content: `TRANSCRIPT:\n${transcript}\n\nReturn ONLY JSON.`,
            },
          ],
        }),
      }
    );

    const data = await response.json();

    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        { error: "No model output" },
        { status: 500 }
      );
    }

    // Hard JSON extraction safety layer
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");

    if (start === -1 || end === -1) {
      return NextResponse.json(
        { error: "Invalid JSON returned by model", raw: content },
        { status: 500 }
      );
    }

    const json = JSON.parse(content.slice(start, end + 1));

    return NextResponse.json(json);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}
