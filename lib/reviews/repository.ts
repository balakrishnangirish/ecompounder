import {
  getAudioFileName,
  getAudioFilePath,
  getReviewCase,
  getReviewCaseSummaries,
} from "@/lib/reviews/fixtures";
import { getProcessedReviewCase } from "@/lib/reviews/processor";
import type {
  ReviewCase,
  ReviewCaseSummary,
  SubmitReviewPayload,
} from "@/lib/reviews/types";

export type ReviewAudioSource = {
  fileName: string;
  filePath: string;
};

export type ReviewSubmitResult = {
  success: true;
  id: string;
  receivedAt: string;
};

export type ReviewRepository = {
  listReviewCases: () => Promise<ReviewCaseSummary[]>;
  getReviewCase: (id: string) => Promise<ReviewCase | null>;
  getReviewAudioSource: (id: string) => Promise<ReviewAudioSource | null>;
  submitReview: (
    id: string,
    payload: SubmitReviewPayload
  ) => Promise<ReviewSubmitResult | null>;
};

const fixtureReviewRepository: ReviewRepository = {
  async listReviewCases() {
    return getReviewCaseSummaries().map((summary) => {
      const submittedCase = submittedReviewCases.get(summary.id);

      if (!submittedCase) return summary;

      const {
        transcript,
        soap,
        modelMetadata,
        ...submittedSummary
      } = submittedCase;

      return {
        ...submittedSummary,
        turnCount: transcript.length,
      };
    });
  },

  async getReviewCase(id) {
    return submittedReviewCases.get(id) ?? getProcessedReviewCase(id);
  },

  async getReviewAudioSource(id) {
    const filePath = getAudioFilePath(id);
    const fileName = getAudioFileName(id);

    if (!getReviewCase(id) || !filePath || !fileName) return null;

    return {
      fileName,
      filePath,
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
      soap: payload.soap,
      signable: payload.signable,
      overallRating: payload.overallRating,
      reviewerComments: payload.reviewerComments,
      criticalFlagCount: payload.annotations.filter(
        (annotation) => annotation.severity === "critical"
      ).length,
    };

    submittedReviewCases.set(id, submittedCase);

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

const submittedReviewCases = new Map<string, ReviewCase>();

export function getReviewRepository(): ReviewRepository {
  return fixtureReviewRepository;
}
