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

    const prompt = `
You are a clinical AI assistant.

Convert this transcript into a structured SOAP note:

FORMAT:
- Subjective
- Objective
- Assessment
- Plan

Transcript:
${transcript}
`;

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
          messages: [
            {
              role: "system",
              content:
                "You are a precise clinical documentation assistant.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.2,
          stream: true,
        }),
      }
    );

    if (!response.body) {
      throw new Error("No response body from Groq");
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body!.getReader();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });

          // Groq streams OpenAI-style SSE chunks
          const lines = chunk
            .split("\n")
            .filter((l) => l.startsWith("data: "));

          for (const line of lines) {
            const data = line.replace("data: ", "").trim();

            if (data === "[DONE]") continue;

            try {
              const json = JSON.parse(data);
              const token = json?.choices?.[0]?.delta?.content;

              if (token) {
                controller.enqueue(encoder.encode(token));
              }
            } catch {}
          }
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}