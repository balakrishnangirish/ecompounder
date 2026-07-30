import path from "path";

import primaryCareSoapTemplate from "@/lib/soap/templates/primary-care-soap.v1.json";
import type {
  ErrorSeverity,
  ReviewCase,
  ReviewCaseSummary,
  ReviewErrorTag,
  SoapSectionReview,
  SoapSectionKey,
  SubmitReviewPayload,
} from "@/lib/reviews/types";

export type AudioReviewFixture = {
  id: string;
  fileName: string;
  sourceLanguage?: string;
  targetLanguage: string;
  numSpeakers?: number;
};

export const reviewErrorTagLabels: Record<ReviewErrorTag, string> = {
  meaning_changed: "Meaning changed",
  omitted_clinical_detail: "Omitted detail",
  incorrect_medication: "Medication",
  incorrect_dose: "Dose",
  incorrect_symptom: "Symptom",
  incorrect_negation: "Negation",
  hallucinated_detail: "Hallucination",
  unclear_speech: "Unclear speech",
  speaker_mislabeled: "Speaker label",
  unsupported_by_transcript: "Unsupported",
  wrong_soap_section: "Wrong section",
  missing_safety_netting: "Safety netting",
};

export const severityLabels: Record<ErrorSeverity, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

const soapTemplate = primaryCareSoapTemplate;
const soapTemplateMetadata = {
  templateName: soapTemplate.name,
  templateVersion: soapTemplate.version,
  promptVersion: "soap-json-v1",
};

export const soapSectionOrder: SoapSectionKey[] = soapTemplate.sections.map(
  (section) => section.key
);

export const audioFixtures: AudioReviewFixture[] = [
  {
    id: "rev-mp3-001",
    fileName: "Hindi.mp3",
    sourceLanguage: "Audio test 1",
    targetLanguage: "en",
  },
  {
    id: "rev-mp3-002",
    fileName: "e98b161f1ed510f74b0effeee351c915.mp3",
    sourceLanguage: "Audio test 2",
    targetLanguage: "en",
  },
  {
    id: "rev-mp3-003",
    fileName: "Hindi_Marathi.mp3",
    sourceLanguage: "Audio test 3",
    targetLanguage: "en",
  },
  {
    id: "rev-mp3-004",
    fileName: "97a6b8d6fa46d2e85a7c6b666aa19d77.mp3",
    sourceLanguage: "Audio test 4",
    targetLanguage: "en",
  },
];

const audioFilePathById: Record<string, string> = {
  "rev-mp3-001": path.join(process.cwd(), "Hindi.mp3"),
  "rev-mp3-002": path.join(
    process.cwd(),
    "e98b161f1ed510f74b0effeee351c915.mp3"
  ),
  "rev-mp3-003": path.join(process.cwd(), "Hindi_Marathi.mp3"),
  "rev-mp3-004": path.join(
    process.cwd(),
    "97a6b8d6fa46d2e85a7c6b666aa19d77.mp3"
  ),
};

export const reviewCases: ReviewCase[] = audioFixtures.map((fixture, index) =>
  buildUnprocessedReviewCase(fixture, index)
);

export function getAudioFixture(id: string) {
  return audioFixtures.find((fixture) => fixture.id === id);
}

export function getAudioFileName(id: string) {
  return getAudioFixture(id)?.fileName;
}

export function getAudioFilePath(id: string) {
  return audioFilePathById[id] ?? null;
}

export function getReviewCaseSummaries(): ReviewCaseSummary[] {
  return reviewCases.map(({ transcript, soap, modelMetadata, ...summary }) => ({
    ...summary,
    turnCount: transcript.length,
  }));
}

export function getReviewCase(id: string) {
  return reviewCases.find((reviewCase) => reviewCase.id === id);
}

function buildUnprocessedReviewCase(
  fixture: AudioReviewFixture,
  index: number
): ReviewCase {
  const startedAt = new Date("2026-07-13T09:15:00.000Z");
  startedAt.setMinutes(startedAt.getMinutes() + index * 30);

  return {
    id: fixture.id,
    audioFileName: fixture.fileName,
    createdAt: startedAt.toISOString(),
    sourceLanguage: fixture.sourceLanguage,
    targetLanguage: fixture.targetLanguage,
    status: "ready_for_review",
    assignedReviewer: "Dr. Meera Shah",
    model: "pending processing",
    criticalFlagCount: 0,
    turnCount: 0,
    transcriptReviewStatus: "ready_for_review",
    soapReviewStatus: "locked",
    audioUrl: `/api/reviews/${fixture.id}/audio`,
    modelMetadata: {
      translationModel: "pending Sarvam processing",
      diarizationModel: "pending Sarvam processing",
      roleModel: "pending Groq processing",
      soapModel: "pending Groq processing",
      templateName: soapTemplateMetadata.templateName,
      templateVersion: soapTemplateMetadata.templateVersion,
      promptVersion: soapTemplateMetadata.promptVersion,
    },
    transcript: [],
    soap: buildEmptySoapReview(),
    overallRating: 1,
    signable: false,
    reviewerComments: "",
  };
}

export function emptySoapSection(key: SoapSectionKey, title: string) {
  return {
    key,
    title,
    generatedText: "",
    reviewedText: null,
    errorTags: [],
    severity: "none" as const,
  };
}

export function buildEmptySoapReview(): Record<SoapSectionKey, SoapSectionReview> {
  return Object.fromEntries(
    soapTemplate.sections.map((section) => [
      section.key,
      emptySoapSection(section.key, section.title),
    ])
  );
}

export function buildSubmitPayload(caseData: ReviewCase): SubmitReviewPayload {
  const annotations = [
    ...caseData.transcript
      .filter(
        (turn) =>
          turn.errorTags.length > 0 ||
          turn.reviewedRole !== turn.predictedRole ||
          turn.correctedTranslation !== null && turn.correctedTranslation !== undefined
      )
      .map((turn) => ({
        targetType:
          turn.reviewedRole !== turn.predictedRole
            ? ("speaker_role" as const)
            : ("translation" as const),
        targetId: turn.id,
        errorTags: turn.errorTags,
        severity: turn.severity,
        beforeText: turn.translatedText,
        afterText: turn.correctedTranslation ?? turn.translatedText,
        comment: turn.comment,
      })),
    ...soapSectionOrder
      .map((key) => caseData.soap[key])
      .filter(
        (section) =>
          section.errorTags.length > 0 ||
          (section.reviewedText !== null && section.reviewedText !== undefined) ||
          (section.reviewedJson !== null && section.reviewedJson !== undefined)
      )
      .map((section) => ({
        targetType: `soap_${section.key}` as const,
        errorTags: section.errorTags,
        severity: section.severity,
        beforeText: section.generatedText,
        afterText:
          section.reviewedText ??
          (soapSectionText(section.reviewedJson) || section.generatedText),
        comment: section.comment,
      })),
  ];

  return {
    caseId: caseData.id,
    status: "completed",
    transcript: caseData.transcript,
    soap: caseData.soap,
    signable: Boolean(caseData.signable),
    overallRating: caseData.overallRating || 1,
    reviewerComments: caseData.reviewerComments || "",
    annotations,
    submittedAt: new Date().toISOString(),
  };
}

function soapSectionText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";

  return Object.entries(value)
    .flatMap(([key, entry]) => flattenSoapValue(formatSoapLabel(key), entry))
    .filter(Boolean)
    .join("\n");
}

function flattenSoapValue(label: string, value: unknown): string[] {
  if (typeof value === "string") {
    return value ? [`${label}: ${value}`] : [];
  }

  if (typeof value === "boolean") {
    return value ? [`${label}: Yes`] : [];
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const nested = Object.entries(value).flatMap(([key, entry]) =>
    flattenSoapValue(formatSoapLabel(key), entry)
  );

  return nested.length > 0
    ? [`${label}:`, ...nested.map((line) => `  ${line}`)]
    : [];
}

function formatSoapLabel(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
