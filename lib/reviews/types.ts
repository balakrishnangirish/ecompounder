export type ReviewStatus =
  | "locked"
  | "ready_for_review"
  | "in_review"
  | "completed";

export type SpeakerRole =
  | "Doctor"
  | "Patient"
  | "Speaker"
  | "Caregiver"
  | "Nurse"
  | "Other"
  | "Unknown";

export const severityOptions = [
  "none",
  "low",
  "medium",
  "high",
  "critical",
] as const;

export type ErrorSeverity = (typeof severityOptions)[number];

export type ReviewTargetType =
  | "source_transcription"
  | "translation"
  | "speaker_role"
  | "model_preference"
  | `soap_${string}`;

export type SoapSectionKey = string;

export const reviewErrorTagOptions = [
  "CLINICAL_NEGATION_FLIPPED",
  "CLINICAL_DATA_MUTATION",
  "MEDICAL_ENTITY_WRONG",
  "INFORMATION_OMISSION",
  "INFORMATION_HALLUCINATION",
  "SPEAKER_MISLABELED",
  "SRC_AUDIO_UNCLEAR",
] as const;

export type ReviewErrorTag = (typeof reviewErrorTagOptions)[number];

export type ReviewModelMetadata = {
  processingProvider?: "sarvam" | "aws_transcribe_medical" | "unknown";
  transcriptionModel?: string;
  translationModel: string;
  diarizationModel: string;
  roleModel: string;
  soapModel: string;
  templateName: string;
  templateVersion: string;
  promptVersion: string;
};

export type TranscriptModelOutput = {
  modelKey: string;
  label: string;
  text: string;
  predictedRole?: SpeakerRole;
  errorTags?: ReviewErrorTag[];
  severity?: ErrorSeverity;
};

export type TranscriptTurnReview = {
  id: string;
  turnIndex: number;
  startTimeSeconds?: number;
  endTimeSeconds?: number;
  speakerId: string;
  predictedRole: SpeakerRole;
  reviewedRole: SpeakerRole;
  sourceText?: string;
  sourceTextNeedsCorrection?: boolean;
  correctedSourceText?: string | null;
  translatedText: string;
  correctedTranslation?: string | null;
  modelOutputs?: TranscriptModelOutput[];
  preferredModelOutput?: string | null;
  errorTags: ReviewErrorTag[];
  severity: ErrorSeverity;
  verifiedPerfect?: boolean;
  reviewMetrics?: ReviewTurnMetrics;
  comment?: string;
};

export type ReviewTurnMetrics = {
  visibleDurationMs: number;
  activeDurationMs: number;
  firstSeenAt?: string;
  firstInteractionAt?: string;
  lastInteractionAt?: string;
  correctionEditCount: number;
  roleChangeCount: number;
  severityChangeCount: number;
  tagToggleCount: number;
  commentEditCount: number;
  audioReplayCount: number;
};

export type TranscriptReviewMetrics = {
  startedAt: string;
  completedAt?: string;
  durationMs: number;
  turnCount: number;
  verifiedPerfectTurnCount: number;
  editedTurnCount: number;
};

export type SoapSectionReview = {
  key: SoapSectionKey;
  title: string;
  generatedText: string;
  reviewedText?: string | null;
  generatedJson?: unknown;
  reviewedJson?: unknown;
  errorTags: ReviewErrorTag[];
  severity: ErrorSeverity;
  comment?: string;
};

export type ReviewCaseSummary = {
  id: string;
  status: ReviewStatus;
  model: string;
  audioUrl?: string;
  audioFileName: string;
  createdAt: string;
  sourceLanguage?: string;
  targetLanguage: string;
  translationLanguage?: string;
  criticalFlagCount: number;
  turnCount: number;
  transcriptReviewStatus: ReviewStatus;
  soapReviewStatus: ReviewStatus;
};

export type ReviewCase = ReviewCaseSummary & {
  modelMetadata: ReviewModelMetadata;
  transcript: TranscriptTurnReview[];
  transcriptReviewMetrics?: TranscriptReviewMetrics;
  soap: Record<SoapSectionKey, SoapSectionReview>;
  signable?: boolean;
  reviewerComments?: string;
};

export type ReviewAnnotationPayload = {
  targetType: ReviewTargetType;
  targetId?: string;
  errorTags: ReviewErrorTag[];
  severity: ErrorSeverity;
  beforeText?: string;
  afterText?: string;
  comment?: string;
};

export type SubmitReviewPayload = {
  caseId: string;
  status: "completed";
  transcript: TranscriptTurnReview[];
  soap: Record<SoapSectionKey, SoapSectionReview>;
  signable: boolean;
  reviewerComments: string;
  annotations: ReviewAnnotationPayload[];
  transcriptReviewMetrics?: TranscriptReviewMetrics;
  submittedAt: string;
};
