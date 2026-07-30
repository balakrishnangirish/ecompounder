import { randomUUID } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";

import { SarvamAIClient } from "sarvamai";

import {
  buildEmptySoapReview,
  emptySoapSection,
  getAudioFixture,
  getAudioFilePath,
  getReviewCase,
  soapSectionOrder,
} from "@/lib/reviews/fixtures";
import { getActiveSoapTemplate } from "@/lib/soap/generate";
import {
  generateSoap as generateSoapJson,
  getActiveSoapTemplateMetadata,
  getConfiguredSoapProvider,
} from "@/lib/soap/generate";
import type {
  ReviewCase,
  SoapSectionKey,
  SpeakerRole,
  TranscriptTurnReview,
} from "@/lib/reviews/types";

type DiarizedEntry = {
  speaker_id?: string;
  transcript?: string;
  start_time_seconds?: number;
  end_time_seconds?: number;
  language?: string;
  language_code?: string;
  detected_language?: string;
  source_language?: string;
  confidence?: number;
  confidence_score?: number;
  transcript_confidence?: number;
};

type DiarizationResult = {
  jobId: string;
  transcript: string;
  entries: DiarizedEntry[];
};

type CachedDiarizationResult = DiarizationResult & {
  cachedAt?: string;
  raw?: unknown;
};

type ProcessedCache = {
  caseData?: ReviewCase;
  promise?: Promise<ReviewCase>;
};

const processedCases = new Map<string, ProcessedCache>();
const cachedDiarizationCaseIds = new Set(["rev-mp3-004"]);
const localCacheDir = path.join(process.cwd(), "lib", "reviews", "cache");

export async function getProcessedReviewCase(id: string) {
  const baseCase = getReviewCase(id);
  if (!baseCase) return null;

  const cached = processedCases.get(id);
  if (cached?.caseData) return cached.caseData;
  if (cached?.promise) return cached.promise;

  const promise = processReviewCase(baseCase)
    .then((caseData) => {
      processedCases.set(id, { caseData });
      return caseData;
    })
    .catch((error) => {
      processedCases.delete(id);
      throw error;
    });

  processedCases.set(id, { promise });
  return promise;
}

async function processReviewCase(baseCase: ReviewCase): Promise<ReviewCase> {
  const audioPath = getAudioFilePath(baseCase.id);
  if (!audioPath) {
    throw new Error("Audio fixture not found");
  }

  const { transcript, entries, jobId } = await runStage(
    "Sarvam diarization/translation",
    () =>
      diarizeAndTranslateMp3({
        audioPath,
        fileName: path.basename(audioPath),
        reviewCaseId: baseCase.id,
        numSpeakers: getAudioFixture(baseCase.id)?.numSpeakers,
      })
  );
  const speakers = Array.from(
    new Set(entries.map((entry) => entry.speaker_id).filter(Boolean))
  ) as string[];
  const roles = await runStage("speaker role inference", () =>
    inferSpeakerRoles(transcript, speakers)
  );
  const turns = entriesToTurns(entries, roles);
  const soap = await generateSoap(transcript, baseCase);
  const soapProvider = getConfiguredSoapProvider();
  const soapTemplateMetadata = getActiveSoapTemplateMetadata();

  return {
    ...baseCase,
    model: `saaras:v3 -> ${soapProvider}`,
    status: "ready_for_review",
    turnCount: turns.length,
    modelMetadata: {
      translationModel: "Sarvam saarAs v3",
      diarizationModel: `Sarvam speech-to-text-translate job ${jobId} (${getSpeakerCountLabel(
        getAudioFixture(baseCase.id)?.numSpeakers
      )})`,
      roleModel: "Groq llama-3.3-70b-versatile",
      soapModel:
        soapProvider === "medgemma"
          ? "Hugging Face google/medgemma-4b-it"
          : "Groq llama-3.3-70b-versatile",
      templateName: soapTemplateMetadata.templateName,
      templateVersion: soapTemplateMetadata.templateVersion,
      promptVersion: soapTemplateMetadata.promptVersion,
    },
    transcript: turns,
    soap,
    overallRating: 1,
    signable: false,
    reviewerComments: "",
  };
}

async function diarizeAndTranslateMp3({
  audioPath,
  fileName,
  reviewCaseId,
  numSpeakers,
}: {
  audioPath: string;
  fileName: string;
  reviewCaseId: string;
  numSpeakers?: number;
}): Promise<DiarizationResult> {
  const cached = await readCachedDiarization(reviewCaseId);
  if (cached) return cached;

  const apiKey = process.env.API_KEY || process.env.SARVAM_API_KEY;
  if (!apiKey) {
    throw new Error("Missing API_KEY or SARVAM_API_KEY");
  }

  const workDir = path.join(os.tmpdir(), `review-diarize-${randomUUID()}`);

  try {
    await mkdir(workDir, { recursive: true });
    const audioBuffer = await readFile(audioPath);

    const client = new SarvamAIClient({
      apiSubscriptionKey: apiKey,
      timeoutInSeconds: 120,
    });

    const job = await client.speechToTextTranslateJob.createJob({
      withDiarization: true,
      ...(Number.isFinite(numSpeakers) ? { numSpeakers } : {}),
    });

    const uploadLinks =
      await client.speechToTextTranslateJob.getUploadLinks({
        body: {
          job_id: job.jobId,
          files: [fileName],
        },
      });

    const uploadUrl = uploadLinks.upload_urls[fileName]?.file_url;
    if (!uploadUrl) {
      throw new Error("Sarvam did not return an upload URL");
    }

    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      body: audioBuffer,
      headers: {
        "Content-Type": "audio/mpeg",
        "x-ms-blob-type": "BlockBlob",
      },
    });

    if (!uploadResponse.ok) {
      throw new Error(`Audio upload failed: ${uploadResponse.status}`);
    }

    await job.start();

    const status = await job.waitUntilComplete(5, 240);
    if (status.job_state.toLowerCase() !== "completed") {
      throw new Error(`Diarization job failed: ${status.job_state}`);
    }

    const outputDir = path.join(workDir, "outputs");
    await job.downloadOutputs(outputDir);

    const outputPath = path.join(outputDir, `${fileName}.json`);
    const output = JSON.parse(await readFile(outputPath, "utf8"));
    const entries = getEntries(output);
    const transcript = formatDiarizedTranscript(entries) || getTranscript(output);

    if (!transcript) {
      throw new Error("No diarized transcript returned");
    }

    const result = {
      jobId: job.jobId,
      transcript,
      entries:
        entries.length > 0
          ? entries
          : transcriptToFallbackEntries(transcript),
    };

    await writeCachedDiarization(reviewCaseId, {
      ...result,
      cachedAt: new Date().toISOString(),
      raw: output,
    });

    return result;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function getSpeakerCountLabel(numSpeakers?: number) {
  return Number.isFinite(numSpeakers)
    ? `${numSpeakers} speakers requested`
    : "speaker count inferred";
}

async function readCachedDiarization(
  reviewCaseId: string
): Promise<DiarizationResult | null> {
  if (!cachedDiarizationCaseIds.has(reviewCaseId)) return null;

  try {
    const cached = JSON.parse(
      await readFile(getDiarizationCachePath(reviewCaseId), "utf8")
    ) as CachedDiarizationResult;

    if (!cached.transcript || !Array.isArray(cached.entries)) {
      return null;
    }

    return {
      jobId: cached.jobId || `local-cache-${reviewCaseId}`,
      transcript: cached.transcript,
      entries: cached.entries,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writeCachedDiarization(
  reviewCaseId: string,
  result: CachedDiarizationResult
) {
  if (!cachedDiarizationCaseIds.has(reviewCaseId)) return;

  await mkdir(localCacheDir, { recursive: true });
  await writeFile(
    getDiarizationCachePath(reviewCaseId),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8"
  );
}

function getDiarizationCachePath(reviewCaseId: string) {
  return path.join(localCacheDir, `${reviewCaseId}.sarvam.json`);
}

async function inferSpeakerRoles(
  transcript: string,
  speakers: string[]
) {
  if (!process.env.GROQ_API_KEY || speakers.length === 0) {
    return Object.fromEntries(
      speakers.map((speaker) => [speaker, "Speaker" as SpeakerRole])
    );
  }

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              'Infer clinical speaker roles. Output only JSON shaped as {"roles":{"SPEAKER_ID":"Doctor"}}. Use only Doctor, Patient, or Speaker.',
          },
          {
            role: "user",
            content: JSON.stringify({ speakers, transcript }),
          },
        ],
      }),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "Role inference failed");
  }

  const content = data?.choices?.[0]?.message?.content || "";
  const parsed = extractJson(content);

  return Object.fromEntries(
    speakers.map((speaker) => {
      const role = parsed?.roles?.[speaker];
      return [
        speaker,
        role === "Doctor" || role === "Patient" || role === "Speaker"
          ? role
          : "Speaker",
      ];
    })
  ) as Record<string, SpeakerRole>;
}

async function generateSoap(
  transcript: string,
  reviewCase: ReviewCase
): Promise<ReviewCase["soap"]> {
  let parsed: any;

  try {
    parsed = await generateSoapJson({
      transcript,
    });
  } catch (error) {
    console.error("Review SOAP generation failed", error);

    const soap = buildEmptySoapReview();
    const firstSectionKey = soapSectionOrder[0];

    if (firstSectionKey && soap[firstSectionKey]) {
      soap[firstSectionKey] = {
        ...soap[firstSectionKey],
        comment:
          error instanceof Error
            ? `SOAP generation failed: ${error.message}`
            : "SOAP generation failed.",
      };
    }

    return soap;
  }

  return Object.fromEntries(
    getActiveSoapTemplate().sections.map((section) => [
      section.key,
      soapSection(section.key, section.title, parsed?.[section.key]),
    ])
  );
}

async function runStage<T>(stage: string, action: () => Promise<T>) {
  try {
    return await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${stage} failed: ${message}`);
  }
}

function entriesToTurns(
  entries: DiarizedEntry[],
  roles: Record<string, SpeakerRole>
): TranscriptTurnReview[] {
  return entries
    .filter((entry) => entry.transcript?.trim())
    .map((entry, index) => {
      const speakerId = entry.speaker_id || "SPEAKER";
      const role = roles[speakerId] || "Speaker";
      const text = entry.transcript?.trim() || "";

      return {
        id: `turn-${index + 1}`,
        turnIndex: index + 1,
        startTimeSeconds: entry.start_time_seconds,
        endTimeSeconds: entry.end_time_seconds,
        speakerId,
        predictedRole: role,
        reviewedRole: role,
        translatedText: text,
        correctedTranslation: null,
        errorTags: [],
        severity: "none",
      };
    });
}

function soapSection(
  key: SoapSectionKey,
  title: string,
  value: unknown
) {
  const text = soapSectionText(value);

  return {
    key,
    title,
    generatedText: text,
    reviewedText: null,
    generatedJson: value,
    reviewedJson: null,
    errorTags: [],
    severity: "none" as const,
  };
}

function soapSectionText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";

  return Object.entries(value)
    .flatMap(([key, entry]) => flattenSoapValue(formatSoapLabel(key), entry))
    .filter(Boolean)
    .join("\n");
}

function flattenSoapValue(label: string, value: unknown): string[] {
  if (typeof value === "string") {
    return value ? [`${label}: ${value}`] : [];
  }

  if (typeof value === "boolean") {
    return value ? [`${label}: Yes`] : [];
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const nested = Object.entries(value).flatMap(([key, entry]) =>
    flattenSoapValue(formatSoapLabel(key), entry)
  );

  return nested.length > 0 ? [`${label}:`, ...nested.map((line) => `  ${line}`)] : [];
}

function formatSoapLabel(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getEntries(value: any): DiarizedEntry[] {
  const candidates = [
    value?.diarized_transcript?.entries,
    value?.diarizedTranscript?.entries,
    value?.data?.diarized_transcript?.entries,
    value?.data?.diarizedTranscript?.entries,
    value?.results?.[0]?.diarized_transcript?.entries,
    value?.results?.[0]?.diarizedTranscript?.entries,
  ];

  return candidates.find(Array.isArray) || [];
}

function getTranscript(value: any) {
  return (
    value?.transcript ||
    value?.text ||
    value?.data?.transcript ||
    value?.data?.text ||
    value?.results?.[0]?.transcript ||
    value?.results?.[0]?.text ||
    ""
  );
}

function formatDiarizedTranscript(entries: DiarizedEntry[]) {
  const lines: string[] = [];

  for (const entry of entries) {
    const text = entry.transcript?.trim();
    if (!text) continue;

    const speaker = entry.speaker_id || "Speaker";
    lines.push(`${speaker}: ${text}`);
  }

  return lines.join("\n");
}

function transcriptToFallbackEntries(transcript: string): DiarizedEntry[] {
  return transcript
    .split("\n")
    .map((line, index) => ({
      speaker_id: "SPEAKER",
      transcript: line.trim(),
      start_time_seconds: index,
      end_time_seconds: index + 1,
    }))
    .filter((entry) => entry.transcript);
}

function extractJson(content: string) {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  if (start === -1 || end === -1) {
    throw new Error("Model returned invalid JSON");
  }

  return JSON.parse(content.slice(start, end + 1));
}
