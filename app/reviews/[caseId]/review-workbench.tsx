"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ClipboardCheck,
  FileText,
  Play,
  Star,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  buildSubmitPayload,
  reviewErrorTagLabels,
  severityLabels,
} from "@/lib/reviews/fixtures";
import { getReviewCaseById, submitReview } from "@/lib/reviews/client";
import { reviewStatusLabel } from "@/lib/reviews/status";
import primaryCareSoapTemplate from "@/lib/soap/templates/primary-care-soap.v1.json";
import type {
  ErrorSeverity,
  ReviewCase,
  ReviewErrorTag,
  ReviewStatus,
  SoapSectionKey,
  SpeakerRole,
  TranscriptTurnReview,
} from "@/lib/reviews/types";

type SoapTemplateField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "checkbox" | "group" | "array";
  fields?: SoapTemplateField[];
  item?: {
    type: "text" | "textarea";
    label: string;
  };
  minItems?: number;
  maxItems?: number;
};

type SoapTemplateSection = {
  key: string;
  title: string;
  fields: SoapTemplateField[];
};

const soapTemplate = primaryCareSoapTemplate as {
  sections: SoapTemplateSection[];
};

type SectionReviewState = {
  status: Extract<ReviewStatus, "in_review" | "completed">;
  completedAt?: string;
  rating: number;
  reviewerNote: string;
};

const roleOptions: SpeakerRole[] = [
  "Doctor",
  "Patient",
  "Speaker",
  "Caregiver",
  "Nurse",
  "Other",
  "Unknown",
];

const severityOptions: ErrorSeverity[] = [
  "none",
  "low",
  "medium",
  "high",
  "critical",
];

const tagOptions: ReviewErrorTag[] = [
  "meaning_changed",
  "incorrect_negation",
  "omitted_clinical_detail",
  "incorrect_symptom",
  "incorrect_medication",
  "incorrect_dose",
  "hallucinated_detail",
  "unsupported_by_transcript",
  "unclear_speech",
  "speaker_mislabeled",
  "wrong_soap_section",
  "missing_safety_netting",
];

const pageTitleClassName = "text-[22px] font-semibold leading-7 tracking-normal";
const panelTitleClassName =
  "flex items-center gap-2 text-[17px] font-semibold leading-6 tracking-normal";
const sectionTitleClassName = "text-[15px] font-semibold leading-5 text-slate-900";
const groupTitleClassName = "text-[14px] font-semibold leading-5 text-slate-700";
const fieldLabelClassName = "text-[13px] font-medium leading-5 text-slate-500";
const helperTextClassName = "text-[13px] leading-5 text-slate-500";
const aiGeneratedBoxClassName =
  "rounded-md border border-slate-100 bg-slate-50/80 p-3 text-sm leading-6 text-slate-500";

export function ReviewWorkbench({ caseId }: { caseId: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [reviewCase, setReviewCase] = useState<ReviewCase | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submittedAt, setSubmittedAt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [transcriptReview, setTranscriptReview] = useState<SectionReviewState>({
    status: "in_review",
    rating: 1,
    reviewerNote: "",
  });
  const [soapReview, setSoapReview] = useState<SectionReviewState>({
    status: "in_review",
    rating: 1,
    reviewerNote: "",
  });

  useEffect(() => {
    getReviewCaseById(caseId)
      .then((caseData) => {
        setReviewCase(structuredClone(caseData));
        setSoapReview((current) => ({
          ...current,
          rating: caseData.overallRating || current.rating,
          reviewerNote: caseData.reviewerComments || current.reviewerNote,
        }));
      })
      .catch((error) =>
        setLoadError(
          error instanceof Error ? error.message : "Review processing failed"
        )
      )
      .finally(() => setIsLoading(false));
  }, [caseId]);

  const isTranscriptReviewComplete = transcriptReview.status === "completed";
  const isSoapReviewEnabled = isTranscriptReviewComplete;
  const isSoapReviewComplete = soapReview.status === "completed";
  const isSoapReviewEditable = isSoapReviewEnabled && !isSoapReviewComplete;

  function updateTurn(
    turnId: string,
    updater: (turn: TranscriptTurnReview) => TranscriptTurnReview
  ) {
    if (isTranscriptReviewComplete) return;

    setReviewCase((current) => {
      if (!current) return current;

      return {
        ...current,
        transcript: current.transcript.map((turn) =>
          turn.id === turnId ? updater(turn) : turn
        ),
      };
    });
  }

  function updateSoap(
    key: SoapSectionKey,
    patch: Partial<ReviewCase["soap"][SoapSectionKey]>
  ) {
    if (!isSoapReviewEditable) return;

    setReviewCase((current) => {
      if (!current) return current;

      return {
        ...current,
        soap: {
          ...current.soap,
          [key]: {
            ...current.soap[key],
            ...patch,
          },
        },
      };
    });
  }

  function seekToTurn(turn: TranscriptTurnReview) {
    if (!audioRef.current || turn.startTimeSeconds === undefined) return;

    const audio = audioRef.current;
    const startTime = Math.max(0, turn.startTimeSeconds);
    const play = () => {
      audio.currentTime = startTime;
      audio.play().catch(() => {
        // Browsers can block programmatic playback; the seek still succeeds.
      });
    };

    if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
      audio.addEventListener("loadedmetadata", play, { once: true });
      audio.load();
      return;
    }

    play();
  }

  async function completeSoapReview() {
    if (!reviewCase || !isSoapReviewEditable) return;

    setIsSubmitting(true);
    setSubmitError("");

    const nextCase: ReviewCase = {
      ...reviewCase,
      status: "completed",
      transcriptReviewStatus: "completed",
      soapReviewStatus: "completed",
      reviewerComments: soapReview.reviewerNote,
      overallRating: soapReview.rating,
    };

    try {
      const response = await submitReview(
        reviewCase.id,
        buildSubmitPayload(nextCase)
      );

      setReviewCase(nextCase);
      setSoapReview((current) => ({
        ...current,
        status: "completed",
        completedAt: response.receivedAt,
      }));
      setSubmittedAt(response.receivedAt);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Review submission failed"
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
        Processing recording and preparing the review workbench...
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
        <div className="max-w-2xl rounded-md border border-red-200 bg-red-50 p-4 text-red-800 shadow-sm">
          <h1 className="font-semibold">Review processing failed</h1>
          <p className="mt-2 text-sm">{loadError}</p>
        </div>
      </main>
    );
  }

  if (!reviewCase) {
    return (
      <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
        Review case not found.
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-4 md:px-6">
        <header className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
                <Link href="/reviews">
                  <ArrowLeft className="h-4 w-4" />
                  Queue
                </Link>
              </Button>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className={pageTitleClassName}>
                  {reviewCase.id}
                </h1>
              </div>
            </div>

            <div className="w-full lg:max-w-xl">
              <audio
                ref={audioRef}
                controls
                preload="metadata"
                src={reviewCase.audioUrl}
                className="h-9 w-full"
              />
            </div>
          </div>
        </header>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <div>
                <h2 className={panelTitleClassName}>
                  <ClipboardCheck className="h-5 w-5 text-slate-500" />
                  Transcript Review
                </h2>
                <p className={helperTextClassName}>
                  Review and correct any errors: translation, speaker role. Apply tags, and severity.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={
                    isTranscriptReviewComplete
                      ? "border-teal-200 bg-teal-50 text-teal-700"
                      : "border-amber-200 bg-amber-50 text-amber-700"
                  }
                >
                  {reviewStatusLabel(transcriptReview.status)}
                </Badge>
              </div>
            </div>

            <div
              className={`space-y-3 p-3 ${
                isTranscriptReviewComplete ? "bg-slate-50/80" : "bg-sky-50/80"
              }`}
            >
              {reviewCase.transcript.map((turn) => (
                <TranscriptTurn
                  key={turn.id}
                  turn={turn}
                  disabled={isTranscriptReviewComplete}
                  onSeek={() => seekToTurn(turn)}
                  onChange={(nextTurn) => updateTurn(turn.id, () => nextTurn)}
                />
              ))}
            </div>

            <div className="border-t border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="flex-1">
                  <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
                    <div className={fieldLabelClassName} id="transcript-rating-label">
                      Rating
                    </div>
                    <StarRating
                      value={transcriptReview.rating}
                      disabled={isTranscriptReviewComplete}
                      labelledBy="transcript-rating-label"
                      onChange={(rating) =>
                        setTranscriptReview((current) => ({
                          ...current,
                          rating,
                        }))
                      }
                    />
                  </div>

                  <label className={`mt-3 block ${fieldLabelClassName}`}>
                    Transcript review note
                    <Textarea
                      value={transcriptReview.reviewerNote}
                      disabled={isTranscriptReviewComplete}
                      onChange={(event) =>
                        setTranscriptReview((current) => ({
                          ...current,
                          reviewerNote: event.target.value,
                        }))
                      }
                      placeholder="Notes about transcript corrections, speaker roles, or translation quality"
                      className="mt-1 min-h-12 bg-white"
                    />
                  </label>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  {transcriptReview.completedAt ? (
                    <span className="text-xs text-slate-500">
                      Completed at{" "}
                      {new Date(transcriptReview.completedAt).toLocaleTimeString()}
                    </span>
                  ) : null}
                  <Button
                    type="button"
                    disabled={isTranscriptReviewComplete}
                    onClick={() =>
                      setTranscriptReview((current) => ({
                        ...current,
                        status: "completed",
                        completedAt: new Date().toISOString(),
                      }))
                    }
                  >
                    <Check className="h-4 w-4" />
                    {isTranscriptReviewComplete ? "Transcript Completed" : "Complete Transcript"}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 p-4">
                <div>
                  <h2 className={panelTitleClassName}>
                    <FileText className="h-5 w-5 text-slate-500" />
                    SOAP Review
                  </h2>
                  <p className={helperTextClassName}>
                    {isSoapReviewEnabled
                      ? `${reviewCase.modelMetadata.templateName} ${reviewCase.modelMetadata.templateVersion}`
                      : "Enabled after Transcript Review is complete."}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      isSoapReviewComplete
                        ? "border-teal-200 bg-teal-50 text-teal-700"
                        : isSoapReviewEnabled
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-slate-200 bg-slate-50 text-slate-600"
                    }
                  >
                    {isSoapReviewEnabled
                      ? reviewStatusLabel(soapReview.status)
                      : "Locked"}
                  </Badge>
                </div>
              </div>

              <div
                className={`space-y-3 p-3 ${
                  isSoapReviewEditable ? "bg-sky-50/80" : "bg-slate-50/80"
                } ${
                  isSoapReviewEnabled ? "" : "opacity-70"
                }`}
                aria-disabled={!isSoapReviewEditable}
              >
                {soapTemplate.sections.map((templateSection) => {
                  const key = templateSection.key;
                  const section = reviewCase.soap[key];
                  if (!section) return null;

                  return (
                    <div
                      key={key}
                      className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <h3 className={sectionTitleClassName}>{section.title}</h3>
                      </div>

                      <SoapTemplateSectionReview
                        section={section}
                        templateSection={templateSection}
                        disabled={!isSoapReviewEditable}
                        onJsonChange={(reviewedJson) =>
                          updateSoap(key, {
                            reviewedJson,
                            reviewedText:
                              reviewedJson === null
                                ? null
                                : soapSectionText(reviewedJson),
                          })
                        }
                      />

                      <ReviewControls
                        severity={section.severity}
                        tags={section.errorTags}
                        disabled={!isSoapReviewEditable}
                        onSeverityChange={(severity) => updateSoap(key, { severity })}
                        onTagsChange={(errorTags) => updateSoap(key, { errorTags })}
                      />

                      <label className={`mt-3 block ${fieldLabelClassName}`}>
                        Additional Comment
                        <Textarea
                          value={section.comment || ""}
                          disabled={!isSoapReviewEditable}
                          onChange={(event) =>
                            updateSoap(key, { comment: event.target.value })
                          }
                          className="mt-2 min-h-12 border-slate-300 bg-white shadow-[inset_0_1px_0_rgba(15,23,42,0.03)]"
                        />
                      </label>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-slate-200 bg-white p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div className="flex-1">
                    <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
                      <div className={fieldLabelClassName} id="soap-rating-label">
                        Rating
                      </div>
                      <StarRating
                        value={soapReview.rating}
                        disabled={!isSoapReviewEditable}
                        labelledBy="soap-rating-label"
                        onChange={(rating) => {
                          setSoapReview((current) => ({
                            ...current,
                            rating,
                          }));
                          setReviewCase({
                            ...reviewCase,
                            overallRating: rating,
                          });
                        }}
                      />
                    </div>

                    <label className={`mt-3 block ${fieldLabelClassName}`}>
                      SOAP review note
                      <Textarea
                        value={soapReview.reviewerNote}
                        disabled={!isSoapReviewEditable}
                        onChange={(event) => {
                          const reviewerNote = event.target.value;

                          setSoapReview((current) => ({
                            ...current,
                            reviewerNote,
                          }));
                          setReviewCase({
                            ...reviewCase,
                            reviewerComments: reviewerNote,
                          });
                        }}
                        placeholder="Notes about SOAP corrections, clinical usability, or signability"
                        className="mt-1 min-h-12 bg-white"
                      />
                    </label>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    {soapReview.completedAt ? (
                      <span className="text-xs text-slate-500">
                        Completed at{" "}
                        {new Date(soapReview.completedAt).toLocaleTimeString()}
                      </span>
                    ) : null}
                    {submittedAt ? (
                      <span className="text-xs text-teal-700">
                        Submitted at {new Date(submittedAt).toLocaleTimeString()}
                      </span>
                    ) : null}
                    {submitError ? (
                      <span className="text-xs text-red-700">{submitError}</span>
                    ) : null}
                    <Button
                      type="button"
                      disabled={!isSoapReviewEditable || isSubmitting}
                      onClick={completeSoapReview}
                    >
                      <Check className="h-4 w-4" />
                      {isSoapReviewComplete
                        ? "SOAP Completed"
                        : isSubmitting
                        ? "Submitting..."
                        : "Complete SOAP"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </main>
  );
}

function TranscriptTurn({
  turn,
  disabled = false,
  onSeek,
  onChange,
}: {
  turn: TranscriptTurnReview;
  disabled?: boolean;
  onSeek: () => void;
  onChange: (turn: TranscriptTurnReview) => void;
}) {
  return (
    <div>
      <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className={sectionTitleClassName}>
              Turn {turn.turnIndex}
            </div>
          </div>

          <button
            type="button"
            onClick={onSeek}
            disabled={turn.startTimeSeconds === undefined}
            className="inline-flex h-8 w-fit items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-teal-700 transition hover:bg-teal-50 disabled:cursor-not-allowed disabled:text-slate-400"
            title="Play this audio segment"
          >
            <Play className="h-3 w-3" />
            {formatTimestamp(turn)}
          </button>
        </div>

        <div className="grid gap-4 py-4 lg:grid-cols-2">
          <div className="min-w-0">
            <div className={`${aiGeneratedBoxClassName} min-h-24`}>
              {turn.translatedText}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <div className={fieldLabelClassName}>
                  Speaker ID
                </div>
                <div className="mt-1 text-sm font-medium text-slate-900">
                  {turn.speakerId}
                </div>
              </div>
              <div>
                <div className={fieldLabelClassName}>
                  AI Role
                </div>
                <div className="mt-1 text-sm font-medium text-slate-900">
                  {turn.predictedRole}
                </div>
              </div>
            </div>
          </div>

          <div className="min-w-0">
            <label className="block">
              <span className="sr-only">Clinician correction</span>
              <Textarea
                value={turn.correctedTranslation ?? turn.translatedText}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...turn,
                    correctedTranslation: normalizeReviewedText(
                      event.target.value,
                      turn.translatedText
                    ),
                  })
                }
                className="min-h-24 border-slate-300 bg-white"
              />
            </label>
            <label className={`mt-3 block ${fieldLabelClassName}`}>
              Correct Role
              <select
                value={turn.reviewedRole}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...turn,
                    reviewedRole: event.target.value as SpeakerRole,
                  })
                }
                className="mt-2 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-normal normal-case text-slate-900"
              >
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="border-t border-slate-100 py-4">
          <div className={`mb-2 ${fieldLabelClassName}`}>
            Error Tags
          </div>
          <ErrorTagsRail
            tags={turn.errorTags}
            disabled={disabled}
            onTagsChange={(errorTags) => onChange({ ...turn, errorTags })}
          />
        </div>

        <div className="border-t border-slate-100 pt-4">
          <SeverityCommentsRail
            severity={turn.severity}
            comment={turn.comment || ""}
            disabled={disabled}
            onSeverityChange={(severity) => onChange({ ...turn, severity })}
            onCommentChange={(comment) => onChange({ ...turn, comment })}
          />
        </div>
      </div>
    </div>
  );
}

function ErrorTagsRail({
  tags,
  disabled = false,
  onTagsChange,
}: {
  tags: ReviewErrorTag[];
  disabled?: boolean;
  onTagsChange: (tags: ReviewErrorTag[]) => void;
}) {
  function toggleTag(tag: ReviewErrorTag) {
    if (tags.includes(tag)) {
      onTagsChange(tags.filter((item) => item !== tag));
      return;
    }

    onTagsChange([...tags, tag]);
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {tagOptions.map((tag) => {
        const isSelected = tags.includes(tag);

        return (
          <button
            key={tag}
            type="button"
            disabled={disabled}
            onClick={() => toggleTag(tag)}
            className={`inline-flex min-h-7 items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition ${
              disabled
                ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                : isSelected
                ? "border-teal-700 bg-teal-50 text-teal-800"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {isSelected ? <Check className="h-3 w-3" /> : null}
            {reviewErrorTagLabels[tag]}
          </button>
        );
      })}
    </div>
  );
}

function SeverityCommentsRail({
  severity,
  comment,
  disabled = false,
  onSeverityChange,
  onCommentChange,
}: {
  severity: ErrorSeverity;
  comment: string;
  disabled?: boolean;
  onSeverityChange: (severity: ErrorSeverity) => void;
  onCommentChange: (comment: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <div>
        <div className={`mb-2 ${fieldLabelClassName}`}>
          Severity
        </div>
        <div className="grid overflow-hidden rounded-md border border-slate-200 bg-slate-100 p-1 sm:grid-cols-5">
          {severityOptions.map((option) => {
            const isSelected = option === severity;

            return (
              <button
                key={option}
                type="button"
                disabled={disabled}
                onClick={() => onSeverityChange(option)}
                className={`min-h-8 rounded-sm px-2 text-xs font-medium transition ${
                  disabled
                    ? "cursor-not-allowed text-slate-400"
                    : isSelected
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-600 hover:bg-white/70"
                }`}
              >
                {severityLabels[option]}
              </button>
            );
          })}
        </div>
      </div>

      <label className={`block ${fieldLabelClassName}`}>
        Additional Comment
        <Textarea
          value={comment}
          disabled={disabled}
          onChange={(event) => onCommentChange(event.target.value)}
          className="mt-2 min-h-12 bg-white"
        />
      </label>
    </div>
  );
}

function SoapTemplateSectionReview({
  section,
  templateSection,
  disabled,
  onJsonChange,
}: {
  section: ReviewCase["soap"][SoapSectionKey];
  templateSection: SoapTemplateSection;
  disabled: boolean;
  onJsonChange: (reviewedJson: unknown | null) => void;
}) {
  const generatedHasContent = soapValueHasContent(section.generatedJson);
  const generatedError = section.comment?.startsWith("SOAP generation failed")
    ? section.comment
    : "";

  return (
    <div className="grid gap-3">
      {generatedError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {generatedError}
        </div>
      ) : !generatedHasContent ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          SOAP was generated, but this section has no populated fields from the transcript.
        </div>
      ) : null}
      {templateSection.fields.map((field) => (
        <SoapTemplateFieldReview
          key={`${templateSection.key}.${field.key}`}
          field={field}
          path={[field.key]}
          isTopLevel
          generatedJson={section.generatedJson}
          reviewedJson={section.reviewedJson}
          disabled={disabled}
          onJsonChange={(reviewedJson) => {
            const nextReviewedJson = deepEqual(
              reviewedJson,
              section.generatedJson
            )
              ? null
              : reviewedJson;
            onJsonChange(nextReviewedJson);
          }}
        />
      ))}
    </div>
  );
}

function SoapTemplateFieldReview({
  field,
  path,
  isTopLevel = false,
  generatedJson,
  reviewedJson,
  disabled,
  onJsonChange,
}: {
  field: SoapTemplateField;
  path: string[];
  isTopLevel?: boolean;
  generatedJson: unknown;
  reviewedJson: unknown;
  disabled: boolean;
  onJsonChange: (reviewedJson: unknown) => void;
}) {
  const generatedValue = getNestedValue(generatedJson, path);
  const reviewedRoot = reviewedJson ?? generatedJson;
  const reviewedValue = getNestedValue(reviewedRoot, path);
  const labelClassName = isTopLevel ? groupTitleClassName : fieldLabelClassName;

  if (field.type === "group") {
    const hasCheckboxes = field.fields?.some((child) => child.type === "checkbox");

    return (
      <div className="space-y-3">
        <div className={groupTitleClassName}>
          {field.label}
        </div>
        <div
          className={
            hasCheckboxes
              ? "grid gap-3 lg:grid-cols-2"
              : "grid gap-3"
          }
        >
          {(field.fields || []).map((child) => {
            const shouldSpanFullRow = hasCheckboxes && child.type !== "checkbox";

            return (
              <div
                key={[...path, child.key].join(".")}
                className={shouldSpanFullRow ? "lg:col-span-2" : ""}
              >
                <SoapTemplateFieldReview
                  field={child}
                  path={[...path, child.key]}
                  isTopLevel={false}
                  generatedJson={generatedJson}
                  reviewedJson={reviewedJson}
                  disabled={disabled}
                  onJsonChange={onJsonChange}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (field.type === "checkbox") {
    const generatedChecked = coerceBoolean(generatedValue);
    const reviewedChecked = coerceBoolean(reviewedValue);

    return (
      <div>
        <div className={`mb-2 ${fieldLabelClassName}`}>
          {field.label}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div
            className={`${aiGeneratedBoxClassName} flex min-h-10 items-center gap-2 py-2`}
            aria-label={`AI prediction: ${generatedChecked ? "selected" : "not selected"}`}
          >
            <input
              type="checkbox"
              checked={generatedChecked}
              disabled
              readOnly
              className="h-4 w-4 shrink-0 accent-slate-400"
            />
            <span>{generatedChecked ? "Selected" : "Not selected"}</span>
          </div>
          <label
            className="flex min-h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 shadow-[inset_0_1px_0_rgba(15,23,42,0.03)]"
            aria-label={`${field.label} correction`}
          >
          <span className="sr-only">{field.label} correction</span>
          <input
            type="checkbox"
            checked={reviewedChecked}
            disabled={disabled}
            onChange={(event) =>
              onJsonChange(
                setNestedValue(reviewedRoot, path, event.target.checked)
              )
            }
            className="h-4 w-4 accent-teal-700"
          />
            <span>{reviewedChecked ? "Selected" : "Not selected"}</span>
          </label>
        </div>
      </div>
    );
  }

  if (field.type === "array") {
    const generatedItems = Array.isArray(generatedValue)
      ? generatedValue.map((item) => (typeof item === "string" ? item : ""))
      : [];
    const reviewedItems = Array.isArray(reviewedValue)
      ? reviewedValue.map((item) => (typeof item === "string" ? item : ""))
      : generatedItems;
    const reviewedText = arrayToNumberedText(reviewedItems);

    return (
      <div>
        <div className={`mb-2 ${labelClassName}`}>
          {field.label}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className={`${aiGeneratedBoxClassName} min-h-24`}>
            {generatedItems.length > 0 ? (
              <ol className="list-decimal space-y-1 pl-5">
                {generatedItems.map((item, index) => (
                  <li key={`${field.key}-generated-${index}`}>
                    {item || "No generated text."}
                  </li>
                ))}
              </ol>
            ) : (
              "No generated text."
            )}
          </div>
          <Textarea
            value={reviewedText}
            disabled={disabled}
            onChange={(event) =>
              onJsonChange(
                setNestedValue(
                  reviewedRoot,
                  path,
                  numberedTextToArray(event.target.value)
                )
              )
            }
            aria-label={`${field.label} correction`}
            className="min-h-24 border-slate-300 bg-white shadow-[inset_0_1px_0_rgba(15,23,42,0.03)]"
          />
        </div>
      </div>
    );
  }

  const generatedText = typeof generatedValue === "string" ? generatedValue : "";
  const reviewedText = typeof reviewedValue === "string" ? reviewedValue : "";
  const isShortTextField = field.type === "text";
  const textBoxHeightClassName = isShortTextField ? "min-h-12" : "min-h-24";

  return (
    <div>
      <div className={`mb-2 ${labelClassName}`}>
        {field.label}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div
          className={`${aiGeneratedBoxClassName} ${textBoxHeightClassName}`}
        >
          {generatedText || "No generated text."}
        </div>
        <label className="block">
          <span className="sr-only">{field.label} correction</span>
          <Textarea
            value={reviewedText}
            disabled={disabled}
            onChange={(event) =>
              onJsonChange(setNestedValue(reviewedRoot, path, event.target.value))
            }
            className={`${textBoxHeightClassName} resize-y border-slate-300 bg-white shadow-[inset_0_1px_0_rgba(15,23,42,0.03)]`}
          />
        </label>
      </div>
    </div>
  );
}

function ReviewControls({
  severity,
  tags,
  disabled = false,
  onSeverityChange,
  onTagsChange,
}: {
  severity: ErrorSeverity;
  tags: ReviewErrorTag[];
  disabled?: boolean;
  onSeverityChange: (severity: ErrorSeverity) => void;
  onTagsChange: (tags: ReviewErrorTag[]) => void;
}) {
  function toggleTag(tag: ReviewErrorTag) {
    if (tags.includes(tag)) {
      onTagsChange(tags.filter((item) => item !== tag));
      return;
    }

    onTagsChange([...tags, tag]);
  }

  return (
    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
      <div>
        <div className={`mb-2 ${fieldLabelClassName}`}>
          Error Tags
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tagOptions.map((tag) => {
            const isSelected = tags.includes(tag);

            return (
              <button
                key={tag}
                type="button"
                disabled={disabled}
                onClick={() => toggleTag(tag)}
                className={`inline-flex min-h-7 items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition ${
                  disabled
                    ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                    : isSelected
                    ? "border-teal-700 bg-teal-50 text-teal-800"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {isSelected ? <Check className="h-3 w-3" /> : null}
                {reviewErrorTagLabels[tag]}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className={`mb-2 ${fieldLabelClassName}`}>
          Severity
        </div>
        <div className="grid overflow-hidden rounded-md border border-slate-200 bg-slate-100 p-1 sm:grid-cols-5">
          {severityOptions.map((option) => {
            const isSelected = option === severity;

            return (
              <button
                key={option}
                type="button"
                disabled={disabled}
                onClick={() => onSeverityChange(option)}
                className={`min-h-8 rounded-sm px-2 text-xs font-medium transition ${
                  disabled
                    ? "cursor-not-allowed text-slate-400"
                    : isSelected
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-600 hover:bg-white/70"
                }`}
              >
                {severityLabels[option]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StarRating({
  value,
  disabled = false,
  labelledBy,
  onChange,
}: {
  value: number;
  disabled?: boolean;
  labelledBy: string;
  onChange: (value: number) => void;
}) {
  return (
    <div
      aria-labelledby={labelledBy}
      className="flex items-center gap-1"
      role="radiogroup"
    >
      {[1, 2, 3, 4, 5].map((rating) => {
        const isSelected = rating <= value;

        return (
          <button
            key={rating}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={`${rating} star${rating === 1 ? "" : "s"}`}
            disabled={disabled}
            onClick={() => onChange(rating)}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-md border transition ${
              disabled
                ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                : isSelected
                ? "border-amber-300 bg-amber-50 text-amber-500"
                : "border-slate-200 bg-white text-slate-300 hover:bg-slate-50"
            }`}
          >
            <Star
              className="h-5 w-5"
              fill={isSelected ? "currentColor" : "none"}
            />
          </button>
        );
      })}
      <span className="ml-2 text-sm font-medium text-slate-700">
        {value}/5
      </span>
    </div>
  );
}

function formatTimestamp(turn: TranscriptTurnReview) {
  if (turn.startTimeSeconds === undefined || turn.endTimeSeconds === undefined) {
    return "No timestamp";
  }

  return `${formatAudioTime(turn.startTimeSeconds)}-${formatAudioTime(
    turn.endTimeSeconds
  )}`;
}

function normalizeReviewedText(reviewedText: string, generatedText: string) {
  return reviewedText.trim() === generatedText.trim() ? null : reviewedText;
}

function getNestedValue(value: unknown, path: string[]) {
  return path.reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function setNestedValue(root: unknown, path: string[], value: unknown) {
  const next = cloneJsonObject(root);
  let current = next;

  path.slice(0, -1).forEach((key) => {
    const child = current[key];
    current[key] =
      child && typeof child === "object" && !Array.isArray(child)
        ? { ...(child as Record<string, unknown>) }
        : {};
    current = current[key] as Record<string, unknown>;
  });

  current[path[path.length - 1]] = value;
  return next;
}

function cloneJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function deepEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function coerceBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;

  if (typeof value === "string") {
    return [
      "true",
      "yes",
      "y",
      "present",
      "positive",
      "checked",
      "1",
    ].includes(value.trim().toLowerCase());
  }

  return false;
}

function soapValueHasContent(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.some(soapValueHasContent);
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some(soapValueHasContent);
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

function arrayToNumberedText(items: string[]) {
  const visibleItems = items.length > 0 ? items : [""];
  return visibleItems.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function numberedTextToArray(value: string) {
  return value
    .split("\n")
    .map((line) => line.replace(/^\s*\d+[\).:-]?\s*/, ""));
}

function formatAudioTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}
