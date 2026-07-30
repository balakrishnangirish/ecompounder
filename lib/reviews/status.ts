import type { ReviewCaseSummary, ReviewStatus } from "@/lib/reviews/types";

export const reviewStatuses: ReviewStatus[] = [
  "locked",
  "ready_for_review",
  "in_review",
  "completed",
];

export const transcriptReviewStatuses: ReviewStatus[] = [
  "ready_for_review",
  "in_review",
  "completed",
];

export const soapReviewStatuses: ReviewStatus[] = [
  "locked",
  "ready_for_review",
  "in_review",
  "completed",
];

export function reviewStatusLabel(status: ReviewStatus) {
  if (status === "locked") return "Locked";

  return status
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export function emptyReviewStatusCounts() {
  return reviewStatuses.reduce<Record<ReviewStatus, number>>((counts, status) => {
    counts[status] = 0;
    return counts;
  }, {} as Record<ReviewStatus, number>);
}

export function countReviewStatuses(
  cases: ReviewCaseSummary[],
  key: "transcriptReviewStatus" | "soapReviewStatus"
) {
  return cases.reduce<Record<ReviewStatus, number>>((counts, reviewCase) => {
    counts[reviewCase[key]] += 1;
    return counts;
  }, emptyReviewStatusCounts());
}

export function reviewStatusBadgeClassName(status: ReviewStatus) {
  if (status === "completed") {
    return "border-teal-200 bg-teal-50 text-teal-700";
  }

  if (status === "in_review" || status === "ready_for_review") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-600";
}
