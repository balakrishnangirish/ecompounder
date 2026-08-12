import path from "path";

import primaryCareSoapTemplate from "@/lib/soap/templates/primary-care-soap.v1.json";
import type {
  ReviewCase,
  ReviewCaseSummary,
  SoapSectionReview,
  SoapSectionKey,
  SubmitReviewPayload,
  TranscriptReviewMetrics,
} from "@/lib/reviews/types";

export type AudioReviewFixture = {
  id: string;
  fileName: string;
  sourceLanguage?: string;
  targetLanguage: string;
  translationLanguage?: string;
  numSpeakers?: number;
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
    translationLanguage: fixture.translationLanguage ?? fixture.targetLanguage,
    status: "ready_for_review",
    model: "pending processing",
    criticalFlagCount: 0,
    turnCount: 0,
    transcriptReviewStatus: "ready_for_review",
    soapReviewStatus: "locked",
    audioUrl: `/api/reviews/${fixture.id}/audio`,
    modelMetadata: {
      processingProvider: "sarvam",
      transcriptionModel: "pending Model A processing",
      translationModel: "pending Model A processing",
      diarizationModel: "pending Model A processing",
      roleModel: "pending Groq processing",
      soapModel: "pending Groq processing",
      templateName: soapTemplateMetadata.templateName,
      templateVersion: soapTemplateMetadata.templateVersion,
      promptVersion: soapTemplateMetadata.promptVersion,
    },
    transcript: [],
    soap: buildEmptySoapReview(),
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

export function buildSubmitPayload(
  caseData: ReviewCase,
  transcriptReviewMetrics?: TranscriptReviewMetrics
): SubmitReviewPayload {
  const transcript = caseData.transcript.map((turn) => ({
    ...turn,
    verifiedPerfect: isVerifiedPerfectTurn(turn),
  }));
  const annotations = [
    ...transcript.flatMap((turn) =>
      transcriptModelOutputsForTurn(turn)
        .filter(
          (output) =>
            (output.errorTags || []).length > 0 ||
            (output.severity || "none") !== "none"
        )
        .map((output) => ({
          targetType: "translation" as const,
          targetId: `${turn.id}:${output.modelKey}`,
          errorTags: output.errorTags || [],
          severity: output.severity || "none",
          beforeText: output.text,
          afterText:
            turn.correctedTranslation && output.modelKey === turn.preferredModelOutput
              ? turn.correctedTranslation
              : output.text,
          comment: turn.comment,
        }))
    ),
    ...transcript
      .filter((turn) => turn.reviewedRole !== turn.predictedRole)
      .map((turn) => ({
        targetType: "speaker_role" as const,
        targetId: turn.id,
        errorTags: [],
        severity: "none" as const,
        beforeText: turn.predictedRole,
        afterText: turn.reviewedRole,
        comment: turn.comment,
      })),
    ...transcript
      .filter(
        (turn) =>
          turn.sourceTextNeedsCorrection &&
          turn.correctedSourceText !== null &&
          turn.correctedSourceText !== undefined &&
          turn.correctedSourceText.trim() !== (turn.sourceText || "").trim()
      )
      .map((turn) => ({
        targetType: "source_transcription" as const,
        targetId: turn.id,
        errorTags: turn.errorTags,
        severity: turn.severity,
        beforeText: turn.sourceText || "",
        afterText: turn.correctedSourceText || "",
        comment: turn.comment,
      })),
    ...transcript
      .filter((turn) => Boolean(turn.preferredModelOutput))
      .map((turn) => ({
        targetType: "model_preference" as const,
        targetId: turn.id,
        errorTags: [],
        severity: "none" as const,
        beforeText: turn.modelOutputs?.map((output) => output.label).join(", "),
        afterText: turn.preferredModelOutput || "",
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
    transcript,
    soap: caseData.soap,
    signable: Boolean(caseData.signable),
    reviewerComments: caseData.reviewerComments || "",
    annotations,
    transcriptReviewMetrics,
    submittedAt: new Date().toISOString(),
  };
}

function isVerifiedPerfectTurn(turn: ReviewCase["transcript"][number]) {
  const correctedTranslation = turn.correctedTranslation?.trim();
  const correctedSourceText = turn.correctedSourceText?.trim();
  const isTextUnchanged =
    !correctedTranslation || correctedTranslation === turn.translatedText.trim();
  const isSourceTextUnchanged =
    !turn.sourceTextNeedsCorrection ||
    !correctedSourceText ||
    correctedSourceText === (turn.sourceText || "").trim();
  const isRoleUnchanged = turn.reviewedRole === turn.predictedRole;
  const hasNoModelPreference = !turn.preferredModelOutput;
  const hasNoModelIssues = transcriptModelOutputsForTurn(turn).every(
    (output) =>
      (output.severity || "none") === "none" &&
      (output.errorTags || []).length === 0
  );

  return (
    isTextUnchanged &&
    isSourceTextUnchanged &&
    isRoleUnchanged &&
    hasNoModelPreference &&
    hasNoModelIssues
  );
}

function transcriptModelOutputsForTurn(turn: ReviewCase["transcript"][number]) {
  const outputs = turn.modelOutputs?.filter((output) => output.text.trim());
  if (outputs && outputs.length > 0) return outputs;

  return [
    {
      modelKey: "model_1",
      label: "Model A",
      text: turn.translatedText,
      predictedRole: turn.predictedRole,
      errorTags: turn.errorTags,
      severity: turn.severity,
    },
    {
      modelKey: "model_2",
      label: "Model B",
      text: turn.sourceText || "",
      predictedRole: "Speaker" as const,
      errorTags: [],
      severity: "none" as const,
    },
  ];
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
