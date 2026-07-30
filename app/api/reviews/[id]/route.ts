import { NextResponse } from "next/server";

import { getReviewRepository } from "@/lib/reviews/repository";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const repository = getReviewRepository();
    const reviewCase = await repository.getReviewCase(id);

    if (!reviewCase) {
      return NextResponse.json(
        { error: "Review case not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(reviewCase);
  } catch (error) {
    console.error(`Review processing failed for ${id}`, error);

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Review processing failed",
      },
      { status: 500 }
    );
  }
}
