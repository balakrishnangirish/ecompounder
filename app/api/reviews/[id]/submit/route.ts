import { NextResponse } from "next/server";

import { getReviewRepository } from "@/lib/reviews/repository";
import type { SubmitReviewPayload } from "@/lib/reviews/types";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const payload = (await request.json()) as SubmitReviewPayload;

  if (payload.caseId !== id) {
    return NextResponse.json(
      { error: "Submitted case ID does not match route ID" },
      { status: 400 }
    );
  }

  const repository = getReviewRepository();
  const result = await repository.submitReview(id, payload);

  if (!result) {
    return NextResponse.json({ error: "Review case not found" }, { status: 404 });
  }

  return NextResponse.json(result);
}
