import {
  getAudioFileName,
  getAudioFilePath,
  getReviewCase,
  getReviewCaseSummaries,
} from "@/lib/reviews/fixtures";
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
    return getReviewCaseSummaries();
  },

  async getReviewCase(id) {
    return getReviewCase(id) ?? null;
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
    if (!getReviewCase(id)) return null;

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

export function getReviewRepository(): ReviewRepository {
  return fixtureReviewRepository;
}
