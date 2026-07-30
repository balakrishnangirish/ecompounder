import type {
  ReviewCase,
  ReviewCaseSummary,
  SubmitReviewPayload,
} from "@/lib/reviews/types";

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function getReviewCases(): Promise<ReviewCaseSummary[]> {
  return readJson<ReviewCaseSummary[]>(await fetch("/api/reviews"));
}

export async function getReviewCaseById(id: string): Promise<ReviewCase> {
  return readJson<ReviewCase>(await fetch(`/api/reviews/${id}`));
}

export async function submitReview(
  id: string,
  payload: SubmitReviewPayload
): Promise<{ success: true; id: string; receivedAt: string }> {
  return readJson(await fetch(`/api/reviews/${id}/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }));
}
