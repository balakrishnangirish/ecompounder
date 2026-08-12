"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ClipboardCheck,
  FileText,
  Lock,
  Play,
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
  ReviewTurnMetrics,
  ReviewStatus,
  SoapSectionKey,
  SpeakerRole,
  TranscriptReviewMetrics,
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
  reviewerNote: string;
};

type TurnInteractionKind =
  | "correction"
  | "role"
  | "severity"
  | "tag"
  | "comment"
  | "audio";

type InternalTurnMetrics = ReviewTurnMetrics & {
  isVisible: boolean;
  visibleSinceMs?: number;
};

type TranscriptTimingState = {
  startedAt: string;
  startedAtMs: number;
  completedAt?: string;
  completedAtMs?: number;
  turns: Record<string, InternalTurnMetrics>;
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
  const timingRef = useRef<TranscriptTimingState | null>(null);
  const turnHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const [reviewCase, setReviewCase] = useState<ReviewCase | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submittedAt, setSubmittedAt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTurnIndex, setActiveTurnIndex] = useState(0);
  const [highlightedTurnId, setHighlightedTurnId] = useState("");
  const [transcriptReview, setTranscriptReview] = useState<SectionReviewState>({
    status: "in_review",
    reviewerNote: "",
  });
  const [soapReview, setSoapReview] = useState<SectionReviewState>({
    status: "in_review",
    reviewerNote: "",
  });

  useEffect(() => {
    getReviewCaseById(caseId)
      .then((caseData) => {
        setReviewCase(structuredClone(caseData));
        timingRef.current = createTranscriptTimingState(caseData);
        setActiveTurnIndex(0);
        setHighlightedTurnId(caseData.transcript[0]?.id || "");
        setSoapReview((current) => ({
          ...current,
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

  useEffect(() => {
    function handleVisibilityChange() {
      const timing = timingRef.current;
      if (!timing) return;

      if (document.visibilityState === "hidden") {
        pauseVisibleTurnDurations(timing);
        return;
      }

      resumeVisibleTurnDurations(timing);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    return () => {
      if (turnHighlightTimeoutRef.current) {
        clearTimeout(turnHighlightTimeoutRef.current);
      }
    };
  }, []);

  const isTranscriptReviewComplete = transcriptReview.status === "completed";
  const isSoapReviewEnabled = isTranscriptReviewComplete;
  const isSoapReviewComplete = soapReview.status === "completed";
  const isSoapReviewEditable = isSoapReviewEnabled && !isSoapReviewComplete;
  const transcriptValidationErrors = reviewCase
    ? getTranscriptValidationErrors(reviewCase)
    : [];
  const soapValidationErrors = reviewCase ? getSoapValidationErrors(reviewCase) : [];
  const turnCount = reviewCase?.transcript.length || 0;
  const activeTurnNumber = turnCount
    ? Math.min(activeTurnIndex + 1, turnCount)
    : 0;
  const transcriptProgressPercent = turnCount
    ? Math.round((activeTurnNumber / turnCount) * 100)
    : 0;
  const hasReachedFinalTurn = turnCount > 0 && activeTurnIndex >= turnCount - 1;
  const hasPreferredEveryTurn = reviewCase
    ? reviewCase.transcript.every((turn) => Boolean(turn.preferredModelOutput))
    : false;

  function recordTurnVisibility(turnId: string, isVisible: boolean) {
    const timing = timingRef.current;
    if (!timing || timing.completedAt) return;

    if (isVisible) {
      markTurnVisible(timing, turnId);
      return;
    }

    markTurnHidden(timing, turnId);
  }

  function recordTurnInteraction(
    turnId: string,
    kind: TurnInteractionKind
  ) {
    const timing = timingRef.current;
    if (!timing || timing.completedAt) return;

    markTurnInteraction(timing, turnId, kind);
  }

  function completeTranscriptReview() {
    if (
      !reviewCase ||
      !hasReachedFinalTurn ||
      !hasPreferredEveryTurn ||
      transcriptValidationErrors.length > 0
    ) {
      return;
    }

    finalizeTranscriptTiming(timingRef.current, reviewCase);
    setTranscriptReview((current) => ({
      ...current,
      status: "completed",
      completedAt: timingRef.current?.completedAt || new Date().toISOString(),
    }));
  }

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
    recordTurnInteraction(turn.id, "audio");

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

  function scrollToTurn(turnId: string) {
    document
      .getElementById(`review-turn-${turnId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function focusTurn(index: number) {
    if (!reviewCase || isTranscriptReviewComplete) return;

    const boundedIndex = Math.max(
      0,
      Math.min(index, reviewCase.transcript.length - 1)
    );
    const turn = reviewCase.transcript[boundedIndex];
    setActiveTurnIndex(boundedIndex);
    setHighlightedTurnId(turn.id);
    if (turnHighlightTimeoutRef.current) {
      clearTimeout(turnHighlightTimeoutRef.current);
    }
    turnHighlightTimeoutRef.current = setTimeout(
      () => setHighlightedTurnId(""),
      1800
    );
    requestAnimationFrame(() => scrollToTurn(turn.id));
  }

  async function completeSoapReview() {
    if (!reviewCase || !isSoapReviewEditable) return;

    const errors = getSoapValidationErrors(reviewCase);
    if (errors.length > 0) {
      setSubmitError(
        `${errors[0].label} has severity ${severityLabels[errors[0].severity]} but no error tag.`
      );
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");

    const metrics = buildTranscriptReviewMetrics(timingRef.current, reviewCase);
    const nextCase: ReviewCase = {
      ...reviewCase,
      status: "completed",
      transcriptReviewStatus: "completed",
      soapReviewStatus: "completed",
      transcript: reviewCase.transcript.map((turn) => ({
        ...turn,
        reviewMetrics: metrics.turnMetrics[turn.id],
      })),
      reviewerComments: soapReview.reviewerNote,
    };

    try {
      const response = await submitReview(
        reviewCase.id,
        buildSubmitPayload(nextCase, metrics.transcriptMetrics)
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

        <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_48px]">
          <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className={panelTitleClassName}>
                    <ClipboardCheck className="h-5 w-5 text-slate-500" />
                    Transcript Review
                  </h2>
                  <p className={helperTextClassName}>
                    Review source transcription, translation, speaker role, tags, and severity.
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
              <div className="flex items-center gap-3">
                <div
                  className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100"
                  aria-label={`Transcript review progress: turn ${activeTurnNumber} of ${turnCount}`}
                >
                  <div
                    className="h-full rounded-full bg-teal-600 transition-all"
                    style={{ width: `${transcriptProgressPercent}%` }}
                  />
                </div>
                <span className="shrink-0 text-[13px] font-medium leading-5 text-slate-500">
                  Turn {activeTurnNumber} of {turnCount}
                </span>
              </div>
            </div>

            <div
              className={`space-y-3 p-3 ${
                isTranscriptReviewComplete ? "bg-slate-50/80" : "bg-sky-50/80"
              }`}
            >
              {reviewCase.transcript.length === 0 ? (
                <div className="rounded-md border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-600 shadow-sm">
                  <h3 className="text-[15px] font-semibold leading-5 text-slate-900">
                    No transcript data available
                  </h3>
                  <p className="mt-2">
                    This review case is waiting for processed transcript and SOAP data.
                  </p>
                </div>
              ) : null}
              {reviewCase.transcript.map((turn, index) => {
                const nextTurn = reviewCase.transcript[index + 1];
                const isCompletedTurn = index < activeTurnIndex;
                const isActiveTurn = index === activeTurnIndex;
                const isLockedNextTurn = index === activeTurnIndex + 1;

                if (isCompletedTurn) {
                  return (
                    <CollapsedTranscriptTurn
                      key={turn.id}
                      turn={turn}
                      disabled={isTranscriptReviewComplete}
                      onClick={() => focusTurn(index)}
                    />
                  );
                }

                if (isLockedNextTurn && !isTranscriptReviewComplete) {
                  return (
                    <LockedTranscriptTurnPreview
                      key={turn.id}
                      turn={turn}
                      activeTurnIndex={activeTurnIndex + 1}
                    />
                  );
                }

                if (!isActiveTurn && !isTranscriptReviewComplete) return null;

                return (
                  <TranscriptTurn
                    key={turn.id}
                    turn={turn}
                    disabled={isTranscriptReviewComplete}
                    onVisibilityChange={recordTurnVisibility}
                    onInteraction={recordTurnInteraction}
                    onSeek={() => seekToTurn(turn)}
                    onNext={nextTurn ? () => focusTurn(index + 1) : undefined}
                    canGoNext={Boolean(turn.preferredModelOutput)}
                    isHighlighted={highlightedTurnId === turn.id}
                    onChange={(nextTurn) => updateTurn(turn.id, () => nextTurn)}
                  />
                );
              })}
            </div>

            <div className="border-t border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="flex-1">
                  <label className={`block ${fieldLabelClassName}`}>
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
                  disabled={
                    isTranscriptReviewComplete ||
                    !hasReachedFinalTurn ||
                    !hasPreferredEveryTurn ||
                    transcriptValidationErrors.length > 0
                  }
                    onClick={completeTranscriptReview}
                  >
                    <Check className="h-4 w-4" />
                    {isTranscriptReviewComplete ? "Transcript Completed" : "Complete Transcript"}
                  </Button>
                  {turnCount === 0 ? (
                    <span className="max-w-xs text-xs text-slate-500">
                      Transcript data is not available for this case.
                    </span>
                  ) : transcriptValidationErrors.length > 0 ? (
                    <span className="max-w-xs text-xs text-red-700">
                      {formatValidationSummary(
                        transcriptValidationErrors,
                        "Select an error tag before completing"
                      )}
                    </span>
                  ) : !hasReachedFinalTurn ? (
                    <span className="max-w-xs text-xs text-slate-500">
                      Review each turn before completing.
                    </span>
                  ) : !hasPreferredEveryTurn ? (
                    <span className="max-w-xs text-xs text-slate-500">
                      Select a preferred turn for every turn before completing.
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="w-full lg:justify-self-end">
            <aside
              className="flex min-h-20 w-full items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-3 text-slate-500 shadow-sm transition-colors lg:h-full lg:w-12 lg:flex-col lg:px-0 lg:py-4"
              aria-label="Collapsed SOAP Review"
              aria-disabled="true"
            >
              <ChevronLeft className="hidden h-4 w-4 text-slate-300 lg:block" />
              <div className="flex min-w-0 flex-1 items-center justify-center gap-3 lg:flex-col">
                <Lock className="h-4 w-4 shrink-0 text-slate-300" />
                <span className="truncate text-xs font-medium tracking-wide text-slate-500 lg:[writing-mode:vertical-rl] lg:rotate-180 lg:truncate-none">
                  SOAP Review
                </span>
                <FileText className="h-4 w-4 shrink-0 text-slate-300" />
              </div>
              <Badge
                variant="outline"
                className="shrink-0 border-slate-200 bg-slate-50 text-slate-600 lg:hidden"
              >
                Locked
              </Badge>
              <div className="hidden h-1 w-1 rounded-full bg-slate-200 lg:block" />
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}

function CollapsedTranscriptTurn({
  turn,
  disabled = false,
  onClick,
}: {
  turn: TranscriptTurnReview;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      id={`review-turn-${turn.id}`}
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:hover:bg-white"
    >
      <span className="flex min-w-0 items-center gap-3">
        <Check className="h-4 w-4 shrink-0 text-teal-700" />
        <span className="truncate text-sm font-medium text-slate-700">
          Turn {turn.turnIndex} - {turnSummaryText(turn)}
        </span>
      </span>
      <span className="shrink-0 text-xs font-medium text-slate-500">
        {preferredTurnOutcomeLabel(turn)}
      </span>
    </button>
  );
}

function LockedTranscriptTurnPreview({
  turn,
  activeTurnIndex,
}: {
  turn: TranscriptTurnReview;
  activeTurnIndex: number;
}) {
  return (
    <div
      id={`review-turn-${turn.id}`}
      className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-500 opacity-50 shadow-sm"
      aria-disabled="true"
    >
      Turn {turn.turnIndex} - locked until Turn {activeTurnIndex} is submitted
    </div>
  );
}

function TranscriptTurn({
  turn,
  disabled = false,
  onVisibilityChange,
  onInteraction,
  onSeek,
  onNext,
  canGoNext,
  isHighlighted,
  onChange,
}: {
  turn: TranscriptTurnReview;
  disabled?: boolean;
  onVisibilityChange: (turnId: string, isVisible: boolean) => void;
  onInteraction: (turnId: string, kind: TurnInteractionKind) => void;
  onSeek: () => void;
  onNext?: () => void;
  canGoNext: boolean;
  isHighlighted: boolean;
  onChange: (turn: TranscriptTurnReview) => void;
}) {
  const turnRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = turnRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => onVisibilityChange(turn.id, entry.isIntersecting),
      { threshold: 0.35 }
    );

    observer.observe(element);
    return () => {
      onVisibilityChange(turn.id, false);
      observer.disconnect();
    };
  }, [onVisibilityChange, turn.id]);

  const reviewedTranslation = turn.correctedTranslation ?? turn.translatedText;
  const sourceTextNeedsCorrection = Boolean(turn.sourceTextNeedsCorrection);
  const reviewedSourceText = turn.correctedSourceText ?? turn.sourceText ?? "";
  const modelOutputs = transcriptModelOutputsForTurn(turn);

  return (
    <div ref={turnRef} id={`review-turn-${turn.id}`} className="scroll-mt-4">
      <div
        className={`rounded-md border bg-white p-4 shadow-sm transition ${
          isHighlighted
            ? "border-teal-300 ring-4 ring-teal-100"
            : "border-slate-200"
        }`}
      >
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className={sectionTitleClassName}>Turn {turn.turnIndex}</h3>
          <button
            type="button"
            onClick={onSeek}
            disabled={turn.startTimeSeconds === undefined}
            className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
            title="Play this audio segment"
          >
            <Play className="h-3 w-3" />
            {formatTimestamp(turn)}
          </button>
        </div>

        <div className="rounded-md border border-slate-200 bg-slate-50/80 p-4">
          <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <p className={fieldLabelClassName}>Source transcription (editable)</p>
            <span className="text-xs font-medium text-slate-400">
              Speaker ID: {turn.speakerId}
            </span>
          </div>
          <Textarea
            value={reviewedSourceText}
            disabled={disabled || !sourceTextNeedsCorrection}
            onChange={(event) => {
              onInteraction(turn.id, "correction");
              onChange({
                ...turn,
                correctedSourceText: event.target.value,
              });
            }}
            placeholder="Source transcription was not provided by this processor."
            className="min-h-12 resize-y border-slate-300 bg-white"
          />
          <label className="mt-2 flex items-center gap-2 text-xs font-medium leading-5 text-slate-500">
            <input
              type="checkbox"
              checked={sourceTextNeedsCorrection}
              disabled={disabled}
              onChange={(event) => {
                const checked = event.target.checked;
                onInteraction(turn.id, "correction");
                onChange({
                  ...turn,
                  sourceTextNeedsCorrection: checked,
                  correctedSourceText: checked ? reviewedSourceText : null,
                });
              }}
              className="h-3.5 w-3.5 accent-teal-700"
            />
            Correction required
          </label>
        </div>

        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          {modelOutputs.map((output) => (
            <ModelOutputReviewPanel
              key={output.modelKey}
              output={output}
              disabled={disabled}
              onTagsChange={(errorTags) => {
                onInteraction(turn.id, "tag");
                onChange({
                  ...turn,
                  modelOutputs: updateModelOutputReview(
                    modelOutputs,
                    output.modelKey,
                    { errorTags }
                  ),
                });
              }}
              onSeverityChange={(severity) => {
                onInteraction(turn.id, "severity");
                onChange({
                  ...turn,
                  modelOutputs: updateModelOutputReview(
                    modelOutputs,
                    output.modelKey,
                    { severity }
                  ),
                });
              }}
            />
          ))}
        </div>

        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50/80 p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(180px,1fr)]">
            <label className="block">
              <span className={fieldLabelClassName}>Reference correction</span>
              <Textarea
                value={reviewedTranslation}
                disabled={disabled}
                onChange={(event) => {
                  onInteraction(turn.id, "correction");
                  onChange({
                    ...turn,
                    correctedTranslation: normalizeReviewedText(
                      event.target.value,
                      turn.translatedText
                    ),
                  });
                }}
                className="mt-2 min-h-14 resize-y border-slate-300 bg-white"
              />
            </label>

            <label className={`block ${fieldLabelClassName}`}>
              Correct role
              <select
                value={turn.reviewedRole}
                disabled={disabled}
                onChange={(event) => {
                  onInteraction(turn.id, "role");
                  onChange({
                    ...turn,
                    reviewedRole: event.target.value as SpeakerRole,
                  });
                }}
                className="mt-2 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-normal normal-case text-slate-900"
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

        <label className={`mt-3 block ${fieldLabelClassName}`}>
          Additional comment
          <Textarea
            value={turn.comment || ""}
            disabled={disabled}
            onChange={(event) => {
              onInteraction(turn.id, "comment");
              onChange({ ...turn, comment: event.target.value });
            }}
            placeholder="Optional notes on this turn"
            className="mt-2 min-h-12 resize-y bg-white"
          />
        </label>

        <PreferredModelControl
          value={turn.preferredModelOutput || ""}
          outputs={modelOutputs}
          disabled={disabled}
          onChange={(preferredModelOutput) => {
            onInteraction(turn.id, "correction");
            onChange({ ...turn, preferredModelOutput });
          }}
        />

        <div className="mt-4 flex justify-end border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={onNext}
            disabled={!onNext || !canGoNext}
            className="inline-flex h-9 w-fit items-center gap-1.5 rounded-md border border-slate-200 bg-slate-950 px-4 text-xs font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            title={
              !onNext
                ? "No next turn"
                : canGoNext
                ? "Go to next turn"
                : "Select a preferred turn before continuing"
            }
          >
            Next
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ModelOutputReviewPanel({
  output,
  disabled,
  onTagsChange,
  onSeverityChange,
}: {
  output: ReturnType<typeof transcriptModelOutputsForTurn>[number];
  disabled?: boolean;
  onTagsChange: (tags: ReviewErrorTag[]) => void;
  onSeverityChange: (severity: ErrorSeverity) => void;
}) {
  const tags = output.errorTags || [];
  const severity = output.severity || "none";
  const validationError = validationMessageForSeverityTags(severity, tags);

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/80 p-4">
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className={fieldLabelClassName}>{output.label} output</p>
        <span className="inline-flex w-fit items-center rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium leading-4 text-slate-600">
          Role: {output.predictedRole || "Unknown"}
        </span>
      </div>
      <Textarea
        value={output.text}
        disabled
        readOnly
        className="min-h-14 resize-y border-slate-200 bg-white text-slate-700"
      />

      <div className="mt-3">
        <div className={`mb-2 ${fieldLabelClassName}`}>Error tags</div>
        <ErrorTagsRail tags={tags} disabled={disabled} onTagsChange={onTagsChange} />
      </div>

      <div className="mt-3">
        <div className={`mb-2 ${fieldLabelClassName}`}>Severity</div>
        <SeverityRail
          severity={severity}
          disabled={disabled}
          onSeverityChange={onSeverityChange}
        />
        {validationError ? (
          <p className="mt-2 text-xs font-medium text-red-700">
            {validationError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PreferredModelControl({
  value,
  outputs,
  disabled,
  onChange,
}: {
  value: string;
  outputs: ReturnType<typeof transcriptModelOutputsForTurn>;
  disabled?: boolean;
  onChange: (preferredModelOutput: string) => void;
}) {
  const options = [
    ...outputs.flatMap((output, index) => [
      ...(index === 1 ? [{ value: "tie", label: "Tie / both ok" }] : []),
      {
        value: output.modelKey,
        label: `${output.label} better`,
      },
    ]),
  ];

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className={fieldLabelClassName}>Preferred turn</span>
      {options.map((option) => {
        const isSelected = value === option.value;

        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(isSelected ? "" : option.value)}
            className={`min-h-9 rounded-md border px-4 text-xs font-medium transition ${
              disabled
                ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                : isSelected
                ? "border-teal-200 bg-teal-50 text-teal-700"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function transcriptModelOutputsForTurn(turn: TranscriptTurnReview) {
  const outputs = turn.modelOutputs?.filter((output) => output.text.trim());
  if (outputs && outputs.length > 0) {
    return outputs.map((output, index) => ({
      ...output,
      modelKey: `model_${index + 1}`,
      label: `Model ${String.fromCharCode(65 + index)}`,
      errorTags: output.errorTags || [],
      severity: output.severity || "none",
    }));
  }

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
      predictedRole: "Speaker" as SpeakerRole,
      errorTags: [],
      severity: "none" as ErrorSeverity,
    },
  ];
}

function updateModelOutputReview(
  outputs: ReturnType<typeof transcriptModelOutputsForTurn>,
  modelKey: string,
  patch: { errorTags?: ReviewErrorTag[]; severity?: ErrorSeverity }
) {
  return outputs.map((output) =>
    output.modelKey === modelKey ? { ...output, ...patch } : output
  );
}

function preferredTurnOutcomeLabel(turn: TranscriptTurnReview) {
  const modelOutputs = transcriptModelOutputsForTurn(turn);

  if (turn.preferredModelOutput === "tie") return "Tie/both ok";

  const preferredOutput = modelOutputs.find(
    (output) => output.modelKey === turn.preferredModelOutput
  );

  return preferredOutput ? `${preferredOutput.label} preferred` : "No preference";
}

function turnSummaryText(turn: TranscriptTurnReview) {
  const text =
    (turn.correctedSourceText || turn.sourceText || turn.translatedText).trim();

  return text || "No transcript text";
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
            className={`inline-flex min-h-7 items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition ${
              disabled
                ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                : isSelected
                ? "border-red-200 bg-red-50 text-red-700"
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

function SeverityRail({
  severity,
  disabled = false,
  onSeverityChange,
}: {
  severity: ErrorSeverity;
  disabled?: boolean;
  onSeverityChange: (severity: ErrorSeverity) => void;
}) {
  return (
    <div className="grid overflow-hidden rounded-md border border-slate-200 bg-white p-1 sm:grid-cols-5">
      {severityOptions.map((option) => {
        const isSelected = option === severity;
        const selectedClassName =
          option === "none"
            ? "bg-teal-50 text-teal-700"
            : "bg-red-50 text-red-700";

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
                ? selectedClassName
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            {severityLabels[option]}
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
  validationError = "",
  onSeverityChange,
  onCommentChange,
}: {
  severity: ErrorSeverity;
  comment: string;
  disabled?: boolean;
  validationError?: string;
  onSeverityChange: (severity: ErrorSeverity) => void;
  onCommentChange: (comment: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <div>
        <div className={`mb-2 ${fieldLabelClassName}`}>
          Severity
        </div>
        <SeverityRail
          severity={severity}
          disabled={disabled}
          onSeverityChange={onSeverityChange}
        />
        {validationError ? (
          <p className="mt-2 text-xs font-medium text-red-700">
            {validationError}
          </p>
        ) : null}
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
        <div className="grid gap-4 2xl:grid-cols-2">
          <div className={`${aiGeneratedBoxClassName} min-h-16`}>
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
            className="min-h-16 border-slate-300 bg-white shadow-[inset_0_1px_0_rgba(15,23,42,0.03)]"
          />
        </div>
      </div>
    );
  }

  const generatedText = typeof generatedValue === "string" ? generatedValue : "";
  const reviewedText = typeof reviewedValue === "string" ? reviewedValue : "";
  const isShortTextField = field.type === "text";
  const textBoxHeightClassName = isShortTextField ? "min-h-10" : "min-h-16";

  return (
    <div>
      <div className={`mb-2 ${labelClassName}`}>
        {field.label}
      </div>
      <div className="grid gap-4 2xl:grid-cols-2">
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
  validationError = "",
  onSeverityChange,
  onTagsChange,
}: {
  severity: ErrorSeverity;
  tags: ReviewErrorTag[];
  disabled?: boolean;
  validationError?: string;
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
        {validationError ? (
          <p className="mt-2 text-xs font-medium text-red-700">
            {validationError}
          </p>
        ) : null}
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

type SeverityTagValidationError = {
  label: string;
  severity: Exclude<ErrorSeverity, "none">;
};

function getTranscriptValidationErrors(
  reviewCase: ReviewCase
): SeverityTagValidationError[] {
  return reviewCase.transcript.flatMap((turn) =>
    transcriptModelOutputsForTurn(turn).flatMap((output) => {
      const severity = tagRequiredSeverity(output.severity || "none");
      const tags = output.errorTags || [];

      return severity && tags.length === 0
        ? [{ label: `Turn ${turn.turnIndex} ${output.label}`, severity }]
        : [];
    })
  );
}

function getSoapValidationErrors(
  reviewCase: ReviewCase
): SeverityTagValidationError[] {
  return Object.values(reviewCase.soap).flatMap((section) => {
    const severity = tagRequiredSeverity(section.severity);

    return severity && section.errorTags.length === 0
      ? [{ label: section.title, severity }]
      : [];
  });
}

function validationMessageForSeverityTags(
  severity: ErrorSeverity,
  tags: ReviewErrorTag[]
) {
  return tagRequiredSeverity(severity) && tags.length === 0
    ? "Select at least one error tag for this severity."
    : "";
}

function formatValidationSummary(
  errors: SeverityTagValidationError[],
  prefix: string
) {
  const visibleLabels = errors.slice(0, 6).map((error) => error.label);
  const hiddenCount = Math.max(0, errors.length - visibleLabels.length);
  const suffix =
    hiddenCount > 0
      ? `${visibleLabels.join(", ")} and ${hiddenCount} more`
      : visibleLabels.join(", ");

  return `${prefix}: ${suffix}.`;
}

function tagRequiredSeverity(severity: ErrorSeverity) {
  return severity === "none" ? null : severity;
}

function createTranscriptTimingState(
  reviewCase: ReviewCase
): TranscriptTimingState {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  return {
    startedAt,
    startedAtMs,
    turns: Object.fromEntries(
      reviewCase.transcript.map((turn) => [
        turn.id,
        createEmptyTurnMetrics(),
      ])
    ),
  };
}

function createEmptyTurnMetrics(): InternalTurnMetrics {
  return {
    visibleDurationMs: 0,
    activeDurationMs: 0,
    correctionEditCount: 0,
    roleChangeCount: 0,
    severityChangeCount: 0,
    tagToggleCount: 0,
    commentEditCount: 0,
    audioReplayCount: 0,
    isVisible: false,
  };
}

function markTurnVisible(timing: TranscriptTimingState, turnId: string) {
  const turnMetrics = ensureTurnMetrics(timing, turnId);
  if (turnMetrics.isVisible) return;

  const now = Date.now();
  turnMetrics.isVisible = true;
  turnMetrics.visibleSinceMs = now;
  turnMetrics.firstSeenAt ||= new Date(now).toISOString();
}

function markTurnHidden(timing: TranscriptTimingState, turnId: string) {
  const turnMetrics = timing.turns[turnId];
  if (!turnMetrics?.isVisible || turnMetrics.visibleSinceMs === undefined) {
    return;
  }

  turnMetrics.visibleDurationMs += Date.now() - turnMetrics.visibleSinceMs;
  turnMetrics.isVisible = false;
  delete turnMetrics.visibleSinceMs;
}

function flushVisibleTurnDurations(timing: TranscriptTimingState) {
  Object.keys(timing.turns).forEach((turnId) => markTurnHidden(timing, turnId));
}

function pauseVisibleTurnDurations(timing: TranscriptTimingState) {
  Object.values(timing.turns).forEach((turnMetrics) => {
    if (!turnMetrics.isVisible || turnMetrics.visibleSinceMs === undefined) {
      return;
    }

    turnMetrics.visibleDurationMs += Date.now() - turnMetrics.visibleSinceMs;
    delete turnMetrics.visibleSinceMs;
  });
}

function resumeVisibleTurnDurations(timing: TranscriptTimingState) {
  const now = Date.now();

  Object.values(timing.turns).forEach((turnMetrics) => {
    if (!turnMetrics.isVisible || turnMetrics.visibleSinceMs !== undefined) {
      return;
    }

    turnMetrics.visibleSinceMs = now;
  });
}

function markTurnInteraction(
  timing: TranscriptTimingState,
  turnId: string,
  kind: TurnInteractionKind
) {
  const now = Date.now();
  const turnMetrics = ensureTurnMetrics(timing, turnId);

  turnMetrics.firstInteractionAt ||= new Date(now).toISOString();
  turnMetrics.lastInteractionAt = new Date(now).toISOString();

  if (kind === "correction") turnMetrics.correctionEditCount += 1;
  if (kind === "role") turnMetrics.roleChangeCount += 1;
  if (kind === "severity") turnMetrics.severityChangeCount += 1;
  if (kind === "tag") turnMetrics.tagToggleCount += 1;
  if (kind === "comment") turnMetrics.commentEditCount += 1;
  if (kind === "audio") turnMetrics.audioReplayCount += 1;
}

function ensureTurnMetrics(timing: TranscriptTimingState, turnId: string) {
  timing.turns[turnId] ||= createEmptyTurnMetrics();
  return timing.turns[turnId];
}

function finalizeTranscriptTiming(
  timing: TranscriptTimingState | null,
  reviewCase: ReviewCase
) {
  if (!timing || timing.completedAt) return;

  flushVisibleTurnDurations(timing);

  const completedAtMs = Date.now();
  timing.completedAtMs = completedAtMs;
  timing.completedAt = new Date(completedAtMs).toISOString();

  reviewCase.transcript.forEach((turn) => finalizeTurnMetrics(timing, turn.id));
}

function buildTranscriptReviewMetrics(
  timing: TranscriptTimingState | null,
  reviewCase: ReviewCase
): {
  transcriptMetrics: TranscriptReviewMetrics;
  turnMetrics: Record<string, ReviewTurnMetrics>;
} {
  const fallbackStartedAtMs = Date.now();
  const activeTiming =
    timing ||
    ({
      startedAt: new Date(fallbackStartedAtMs).toISOString(),
      startedAtMs: fallbackStartedAtMs,
      turns: {},
    } satisfies TranscriptTimingState);

  finalizeTranscriptTiming(activeTiming, reviewCase);

  const turnMetrics = Object.fromEntries(
    reviewCase.transcript.map((turn) => [
      turn.id,
      finalizeTurnMetrics(activeTiming, turn.id),
    ])
  );
  const verifiedPerfectTurnCount = reviewCase.transcript.filter((turn) =>
    isTurnVerifiedPerfect(turn)
  ).length;

  return {
    transcriptMetrics: {
      startedAt: activeTiming.startedAt,
      completedAt: activeTiming.completedAt,
      durationMs:
        (activeTiming.completedAtMs || Date.now()) - activeTiming.startedAtMs,
      turnCount: reviewCase.transcript.length,
      verifiedPerfectTurnCount,
      editedTurnCount: reviewCase.transcript.length - verifiedPerfectTurnCount,
    },
    turnMetrics,
  };
}

function finalizeTurnMetrics(
  timing: TranscriptTimingState,
  turnId: string
): ReviewTurnMetrics {
  const turnMetrics = ensureTurnMetrics(timing, turnId);
  const firstInteractionMs = turnMetrics.firstInteractionAt
    ? Date.parse(turnMetrics.firstInteractionAt)
    : 0;
  const lastInteractionMs = turnMetrics.lastInteractionAt
    ? Date.parse(turnMetrics.lastInteractionAt)
    : 0;

  return {
    visibleDurationMs: Math.max(0, Math.round(turnMetrics.visibleDurationMs)),
    activeDurationMs:
      firstInteractionMs && lastInteractionMs
        ? Math.max(0, lastInteractionMs - firstInteractionMs)
        : 0,
    firstSeenAt: turnMetrics.firstSeenAt,
    firstInteractionAt: turnMetrics.firstInteractionAt,
    lastInteractionAt: turnMetrics.lastInteractionAt,
    correctionEditCount: turnMetrics.correctionEditCount,
    roleChangeCount: turnMetrics.roleChangeCount,
    severityChangeCount: turnMetrics.severityChangeCount,
    tagToggleCount: turnMetrics.tagToggleCount,
    commentEditCount: turnMetrics.commentEditCount,
    audioReplayCount: turnMetrics.audioReplayCount,
  };
}

function isTurnVerifiedPerfect(turn: TranscriptTurnReview) {
  const correctedTranslation = turn.correctedTranslation?.trim();
  const isTextUnchanged =
    !correctedTranslation || correctedTranslation === turn.translatedText.trim();
  const noModelIssues = transcriptModelOutputsForTurn(turn).every(
    (output) =>
      (output.severity || "none") === "none" &&
      (output.errorTags || []).length === 0
  );

  return (
    isTextUnchanged &&
    turn.reviewedRole === turn.predictedRole &&
    noModelIssues
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
