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

export type ErrorSeverity = "none" | "low" | "medium" | "high" | "critical";

export type ReviewTargetType =
  | "translation"
  | "speaker_role"
  | `soap_${string}`;

export type SoapSectionKey = string;

export type ReviewErrorTag =
  | "meaning_changed"
  | "omitted_clinical_detail"
  | "incorrect_medication"
  | "incorrect_dose"
  | "incorrect_symptom"
  | "incorrect_negation"
  | "hallucinated_detail"
  | "unclear_speech"
  | "speaker_mislabeled"
  | "unsupported_by_transcript"
  | "wrong_soap_section"
  | "missing_safety_netting";

export type ReviewModelMetadata = {
  translationModel: string;
  diarizationModel: string;
  roleModel: string;
  soapModel: string;
  templateName: string;
  templateVersion: string;
  promptVersion: string;
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
  translatedText: string;
  correctedTranslation?: string | null;
  errorTags: ReviewErrorTag[];
  severity: ErrorSeverity;
  comment?: string;
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
  assignedReviewer?: string;
  model: string;
  audioUrl?: string;
  audioFileName: string;
  createdAt: string;
  sourceLanguage?: string;
  targetLanguage: string;
  criticalFlagCount: number;
  turnCount: number;
  transcriptReviewStatus: ReviewStatus;
  soapReviewStatus: ReviewStatus;
};

export type ReviewCase = ReviewCaseSummary & {
  modelMetadata: ReviewModelMetadata;
  transcript: TranscriptTurnReview[];
  soap: Record<SoapSectionKey, SoapSectionReview>;
  overallRating?: number;
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
  overallRating: number;
  reviewerComments: string;
  annotations: ReviewAnnotationPayload[];
  submittedAt: string;
};
