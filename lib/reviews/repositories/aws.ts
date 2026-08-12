import type { ReviewRepository } from "@/lib/reviews/repository";
import type {
  ReviewCase,
  ReviewCaseSummary,
  SubmitReviewPayload,
} from "@/lib/reviews/types";

type AwsReviewRepositoryOptions = {
  baseUrl: string;
  apiKey?: string;
  authHeader: string;
};

export function createAwsReviewRepository(): ReviewRepository {
  const baseUrl = process.env.REVIEW_API_BASE_URL;

  if (!baseUrl) {
    throw new Error(
      "REVIEW_API_BASE_URL is required when REVIEW_BACKEND_MODE=aws"
    );
  }

  const options: AwsReviewRepositoryOptions = {
    baseUrl,
    apiKey: process.env.REVIEW_API_KEY,
    authHeader: process.env.REVIEW_API_AUTH_HEADER ?? "Authorization",
  };

  return {
    async listReviewCases() {
      return fetchAwsJson<ReviewCaseSummary[]>(options, "/reviews");
    },

    async getReviewCase(id) {
      return fetchAwsJson<ReviewCase | null>(
        options,
        `/reviews/${encodeURIComponent(id)}`,
        undefined,
        [404]
      );
    },

    async getReviewAudioSource(id) {
      const reviewCase = await this.getReviewCase(id);
      if (!reviewCase) return null;
      const audioPath = `/reviews/${encodeURIComponent(id)}/audio`;
      const remoteUrl = reviewCase.audioUrl
        ? buildAwsUrl(options.baseUrl, reviewCase.audioUrl)
        : buildAwsUrl(options.baseUrl, audioPath);

      return {
        fileName: reviewCase.audioFileName,
        remoteUrl,
        headers: reviewCase.audioUrl ? undefined : buildAwsHeaders(options),
        contentType: "audio/mpeg",
      };
    },

    async submitReview(id, payload) {
      return fetchAwsJson(
        options,
        `/reviews/${encodeURIComponent(id)}/submit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload satisfies SubmitReviewPayload),
        },
        [404]
      );
    },
  };
}

async function fetchAwsJson<T>(
  options: AwsReviewRepositoryOptions,
  path: string,
  init?: RequestInit,
  nullStatuses: number[] = []
): Promise<T> {
  const response = await fetch(buildAwsUrl(options.baseUrl, path), {
    ...init,
    headers: {
      ...buildAwsHeaders(options),
      ...init?.headers,
    },
    cache: "no-store",
  });

  if (nullStatuses.includes(response.status)) {
    return null as T;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `AWS review API failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function buildAwsUrl(baseUrl: string, path: string) {
  if (/^https?:\/\//i.test(path)) return path;

  return new URL(path.replace(/^\//, ""), ensureTrailingSlash(baseUrl)).toString();
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function buildAwsHeaders(options: AwsReviewRepositoryOptions) {
  if (!options.apiKey) return {};

  const value =
    options.authHeader.toLowerCase() === "authorization"
      ? `Bearer ${options.apiKey}`
      : options.apiKey;

  return {
    [options.authHeader]: value,
  };
}
