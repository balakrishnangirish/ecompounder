import {
  getAudioFileName,
  getAudioFilePath,
  getReviewCase,
  getReviewCaseSummaries,
} from "@/lib/reviews/fixtures";
import {
  getProcessedReviewCase,
  writeCachedReviewCase,
} from "@/lib/reviews/processor";
import type { ReviewRepository } from "@/lib/reviews/repository";
import type { ReviewCase } from "@/lib/reviews/types";

const submittedReviewCases = new Map<string, ReviewCase>();

export const fixtureReviewRepository: ReviewRepository = {
  async listReviewCases() {
    return getReviewCaseSummaries().map((summary) => {
      const submittedCase = submittedReviewCases.get(summary.id);

      if (!submittedCase) return summary;

      const { transcript, soap, modelMetadata, ...submittedSummary } =
        submittedCase;

      return {
        ...submittedSummary,
        turnCount: transcript.length,
      };
    });
  },

  async getReviewCase(id) {
    const submittedCase = submittedReviewCases.get(id);
    if (submittedCase) return submittedCase;

    try {
      return await getProcessedReviewCase(id);
    } catch (error) {
      if (isMissingLocalFixtureAudioError(error)) {
        console.warn(
          `Review fixture audio is unavailable for ${id}; returning unprocessed fixture case.`
        );
        return getReviewCase(id) ?? null;
      }

      throw error;
    }
  },

  async getReviewAudioSource(id) {
    const filePath = getAudioFilePath(id);
    const fileName = getAudioFileName(id);

    if (!getReviewCase(id) || !filePath || !fileName) return null;

    return {
      fileName,
      filePath,
      contentType: "audio/mpeg",
    };
  },

  async submitReview(id, payload) {
    const reviewCase = await this.getReviewCase(id);
    if (!reviewCase) return null;

    const submittedCase: ReviewCase = {
      ...reviewCase,
      status: "completed",
      transcriptReviewStatus: "completed",
      soapReviewStatus: "completed",
      transcript: payload.transcript,
      transcriptReviewMetrics: payload.transcriptReviewMetrics,
      soap: payload.soap,
      signable: payload.signable,
      reviewerComments: payload.reviewerComments,
      criticalFlagCount: payload.annotations.filter(
        (annotation) => annotation.severity === "critical"
      ).length,
    };

    submittedReviewCases.set(id, submittedCase);
    await writeCachedReviewCase(id, submittedCase);

    console.log("REVIEW SUBMITTED", {
      id,
      caseId: payload.caseId,
      status: payload.status,
      signable: payload.signable,
      annotationCount: payload.annotations.length,
      submittedAt: payload.submittedAt,
    });

    return {
      success: true,
      id,
      receivedAt: new Date().toISOString(),
    };
  },
};

function isMissingLocalFixtureAudioError(error: unknown) {
  if (!(error instanceof Error)) return false;

  return (
    ("code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") ||
    error.message.includes("ENOENT: no such file or directory")
  );
}
