import { readFile } from "fs/promises";

import { NextResponse } from "next/server";

import { getReviewRepository } from "@/lib/reviews/repository";
import type { ReviewAudioSource } from "@/lib/reviews/repository";

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

  if ("remoteUrl" in audioSource) {
    return proxyRemoteAudio(request, audioSource);
  }

  try {
    const audio = await readFile(audioSource.filePath);
    const range = request.headers.get("range");
    const contentType = audioSource.contentType ?? "audio/mpeg";

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
          "Content-Type": contentType,
        },
      });
    }

    return new Response(audio, {
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Type": contentType,
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

async function proxyRemoteAudio(
  request: Request,
  audioSource: Extract<ReviewAudioSource, { remoteUrl: string }>
) {
  const range = request.headers.get("range");
  const response = await fetch(audioSource.remoteUrl, {
    headers: {
      ...audioSource.headers,
      ...(range ? { range } : {}),
    },
    cache: "no-store",
  });

  if (!response.ok && response.status !== 206) {
    return NextResponse.json(
      { error: `${audioSource.fileName} was not found` },
      { status: response.status === 404 ? 404 : 502 }
    );
  }

  const headers = new Headers();
  const contentType =
    response.headers.get("content-type") ??
    audioSource.contentType ??
    "audio/mpeg";

  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "no-store");

  copyHeader(response.headers, headers, "accept-ranges");
  copyHeader(response.headers, headers, "content-length");
  copyHeader(response.headers, headers, "content-range");

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

function copyHeader(source: Headers, target: Headers, name: string) {
  const value = source.get(name);
  if (value) target.set(name, value);
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
