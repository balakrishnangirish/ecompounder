import { NextResponse } from "next/server";

import { generateSoap } from "@/lib/soap/generate";

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
    });

    return NextResponse.json({
      success: true,
      soap,
    });
  } catch (err: any) {
    console.error("SOAP ERROR", err);

    return NextResponse.json(
      {
        success: false,
        error: err?.message || "SOAP generation failed",
      },
      { status: 500 }
    );
  }
}
