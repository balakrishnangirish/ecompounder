import type { ErrorSeverity, ReviewErrorTag } from "@/lib/reviews/types";
export { reviewErrorTagOptions, severityOptions } from "@/lib/reviews/types";

export const reviewErrorTagLabels: Record<ReviewErrorTag, string> = {
  CLINICAL_NEGATION_FLIPPED: "Clinical Negation Flipped",
  CLINICAL_DATA_MUTATION: "Clinical Data Mutation",
  MEDICAL_ENTITY_WRONG: "Medical Entity Wrong",
  INFORMATION_OMISSION: "Information Omission",
  INFORMATION_HALLUCINATION: "Information Hallucination",
  SPEAKER_MISLABELED: "Speaker Mislabeled",
  SRC_AUDIO_UNCLEAR: "Audio Unclear",
};

export const reviewErrorTagDescriptions: Record<ReviewErrorTag, string> = {
  CLINICAL_NEGATION_FLIPPED:
    'Errors such as "not taking" vs "taking" or "no fever" vs "fever"',
  CLINICAL_DATA_MUTATION:
    "Errors in dosages, frequencies, dates, durations, and laterality (e.g., 5mg->50mg, 3 days->3 weeks, Left side->Right side)",
  MEDICAL_ENTITY_WRONG:
    "Wrong or garbled drug names, allergies, or diagnoses",
  INFORMATION_OMISSION:
    "Dropped a clinically relevant medication, symptom, or safety-netting detail",
  INFORMATION_HALLUCINATION:
    "Fabricated or added clinical content completely missing from the original audio",
  SPEAKER_MISLABELED:
    "Incorrectly assigning Doctor->Patient, etc.",
  SRC_AUDIO_UNCLEAR:
    "Poor audio- too noisy/muffled, unclear, garbled, etc.",
};

export const severityLabels: Record<ErrorSeverity, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};
