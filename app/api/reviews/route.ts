import { NextResponse } from "next/server";

import { getReviewRepository } from "@/lib/reviews/repository";

export const runtime = "nodejs";

export async function GET() {
  const repository = getReviewRepository();

  return NextResponse.json(await repository.listReviewCases());
}
