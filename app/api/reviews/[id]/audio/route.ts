import { readFile } from "fs/promises";

import { NextResponse } from "next/server";

import { getReviewRepository } from "@/lib/reviews/repository";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const repository = getReviewRepository();
  const audioSource = await repository.getReviewAudioSource(id);

  if (!audioSource) {
    return NextResponse.json({ error: "Review case not found" }, { status: 404 });
  }

  try {
    const audio = await readFile(audioSource.filePath);
    const range = request.headers.get("range");

    if (range) {
      const parsedRange = parseRange(range, audio.byteLength);

      if (!parsedRange) {
        return new Response(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${audio.byteLength}`,
            "Accept-Ranges": "bytes",
          },
        });
      }

      const { start, end } = parsedRange;
      const chunk = audio.subarray(start, end + 1);

      return new Response(chunk, {
        status: 206,
        headers: {
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
          "Content-Length": String(chunk.byteLength),
          "Content-Range": `bytes ${start}-${end}/${audio.byteLength}`,
          "Content-Type": "audio/mpeg",
        },
      });
    }

    return new Response(audio, {
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: `${audioSource.fileName} was not found` },
      { status: 404 }
    );
  }
}

function parseRange(rangeHeader: string, size: number) {
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  const [, startValue, endValue] = match;
  let start = startValue ? Number.parseInt(startValue, 10) : 0;
  let end = endValue ? Number.parseInt(endValue, 10) : size - 1;

  if (!startValue && endValue) {
    const suffixLength = Number.parseInt(endValue, 10);
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return null;
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
}
