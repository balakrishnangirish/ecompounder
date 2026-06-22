import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { transcript } = await request.json();

    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "medgemma",
        messages: [
          {
            role: "user",
            content: `Parse this conversation and generate a detailed English SOAP Note: ${transcript}`,
          },
        ],
        stream: false,
      }),
    });

    const resJson = await response.json();

    let soapNote = "";
    if (resJson.message) {
      soapNote = resJson.message.content;
    } else if (resJson.response) {
      soapNote = resJson.response;
    } else {
      throw new Error("Unexpected json structure from local Ollama container.");
    }

    return NextResponse.json({ soapNote });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
