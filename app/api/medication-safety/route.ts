import { NextResponse } from "next/server";
import { extractMedications, extractAllergies } from "@/lib/meds/extractor";
import { runMedicationSafetyReview } from "@/lib/meds/safety-engine";

export async function POST(req: Request) {
  const body = await req.json();

  const soap = body.soap;

  const medications = extractMedications(soap);
  const allergies = extractAllergies(soap);

  const alerts = runMedicationSafetyReview(
    medications,
    allergies
  );

  return NextResponse.json({
    medications,
    allergies,
    alerts
  });
}