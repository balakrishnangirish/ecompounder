import { NextResponse } from "next/server";

import { generateSoap, getConfiguredSoapProvider } from "@/lib/soap/generate";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { transcript, patient } = await req.json();

    if (!transcript) {
      return NextResponse.json(
        { error: "Missing transcript" },
        { status: 400 }
      );
    }

    const soap = await generateSoap({
      transcript,
      patient,
      provider: getConfiguredSoapProvider(),
    });

    return NextResponse.json(soap);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "SOAP generation failed" },
      { status: 500 }
    );
  }
}
