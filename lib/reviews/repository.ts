import { createAwsReviewRepository } from "@/lib/reviews/repositories/aws";
import { fixtureReviewRepository } from "@/lib/reviews/repositories/fixture";
import type {
  ReviewCase,
  ReviewCaseSummary,
  SubmitReviewPayload,
} from "@/lib/reviews/types";

export type LocalReviewAudioSource = {
  fileName: string;
  filePath: string;
  contentType?: string;
};

export type RemoteReviewAudioSource = {
  fileName: string;
  remoteUrl: string;
  headers?: Record<string, string>;
  contentType?: string;
};

export type ReviewAudioSource = LocalReviewAudioSource | RemoteReviewAudioSource;

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

const reviewRepositoryMode = process.env.REVIEW_BACKEND_MODE ?? "fixture";

export function getReviewRepository(): ReviewRepository {
  if (reviewRepositoryMode === "aws") {
    return createAwsReviewRepository();
  }

  return fixtureReviewRepository;
}
