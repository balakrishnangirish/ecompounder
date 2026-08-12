import { randomUUID } from "crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
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
  sourceTranscript?: string;
  translatedText?: string;
  source_transcript?: string;
  original_transcript?: string;
  input_transcript?: string;
  transcription?: string;
  translated_text?: string;
  translated_transcript?: string;
  translation?: string;
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
  mode?: "codemix" | "transcribe" | "translate";
  raw?: unknown;
};

type CachedReviewCase = {
  cacheVersion: 1;
  cachedAt: string;
  caseData: ReviewCase;
};

type ProcessedCache = {
  caseData?: ReviewCase;
  promise?: Promise<ReviewCase>;
};

const processedCases = new Map<string, ProcessedCache>();
const localCacheDir = path.join(process.cwd(), "lib", "reviews", "cache");
const SOURCE_TRANSCRIPT_MODE = "codemix" as const;
const SOURCE_ALIGNMENT_VERSION = "timestamp-v1";

export async function getProcessedReviewCase(id: string) {
  const baseCase = getReviewCase(id);
  if (!baseCase) return null;

  const cached = processedCases.get(id);
  if (cached?.caseData) return cached.caseData;
  if (cached?.promise) return cached.promise;

  const cachedCase = await readCachedReviewCase(id);
  if (cachedCase) {
    const repairedCase = await repairKnownSourceOffsetIfNeeded(
      cachedCase,
      baseCase.id
    );
    const refreshedCase = await refreshCachedSourceTranscriptIfNeeded(
      repairedCase,
      baseCase
    );
    processedCases.set(id, { caseData: refreshedCase });
    return refreshedCase;
  }

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
  const transcriptionResult = await runStage("Sarvam transcription", () =>
    transcribeMp3({
      audioPath,
      fileName: path.basename(audioPath),
      reviewCaseId: baseCase.id,
      numSpeakers: getAudioFixture(baseCase.id)?.numSpeakers,
    })
  );
  const mergedEntries = mergeDiarizedEntries(
    entries,
    transcriptionResult.entries
  );
  const speakers = Array.from(
    new Set(mergedEntries.map((entry) => entry.speaker_id).filter(Boolean))
  ) as string[];
  const roles = await runStage("speaker role inference", () =>
    inferSpeakerRoles(transcript, speakers)
  );
  const turns = entriesToTurns(mergedEntries, roles);
  const soap = await generateSoap(transcript, baseCase);
  const soapProvider = getConfiguredSoapProvider();
  const soapTemplateMetadata = getActiveSoapTemplateMetadata();

  const caseData: ReviewCase = {
    ...baseCase,
    model: `saaras:v3 -> ${soapProvider}`,
    status: "ready_for_review",
    translationLanguage: baseCase.translationLanguage ?? baseCase.targetLanguage,
    turnCount: turns.length,
    modelMetadata: {
      processingProvider: "sarvam",
      transcriptionModel: `Sarvam saarAs v3 ${SOURCE_TRANSCRIPT_MODE} ${SOURCE_ALIGNMENT_VERSION} job ${transcriptionResult.jobId}`,
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
    signable: false,
    reviewerComments: "",
  };

  await writeCachedReviewCase(baseCase.id, caseData);

  return caseData;
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

async function transcribeMp3({
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
  const cached = await readCachedTranscription(reviewCaseId);
  if (cached) return cached;

  const apiKey = process.env.API_KEY || process.env.SARVAM_API_KEY;
  if (!apiKey) {
    throw new Error("Missing API_KEY or SARVAM_API_KEY");
  }

  const workDir = path.join(os.tmpdir(), `review-transcribe-${randomUUID()}`);

  try {
    await mkdir(workDir, { recursive: true });

    const client = new SarvamAIClient({
      apiSubscriptionKey: apiKey,
      timeoutInSeconds: 120,
    });

    const job = await client.speechToTextJob.createJob({
      model: "saaras:v3",
      mode: SOURCE_TRANSCRIPT_MODE,
      withDiarization: true,
      withTimestamps: true,
      ...(Number.isFinite(numSpeakers) ? { numSpeakers } : {}),
    });

    await job.uploadFiles([audioPath]);
    await job.start();

    const status = await job.waitUntilComplete(5, 240);
    if (status.job_state.toLowerCase() !== "completed") {
      throw new Error(`Transcription job failed: ${status.job_state}`);
    }

    const outputDir = path.join(workDir, "outputs");
    await job.downloadOutputs(outputDir);

    const output = await readSarvamOutputJson(outputDir, fileName);
    const entries = getEntries(output);
    const transcript = formatDiarizedTranscript(entries) || getTranscript(output);

    if (!transcript) {
      throw new Error("No source transcript returned");
    }

    const result = {
      jobId: job.jobId,
      transcript,
      entries:
        entries.length > 0
          ? entries
          : transcriptToFallbackEntries(transcript),
    };

    await writeCachedTranscription(reviewCaseId, {
      ...result,
      cachedAt: new Date().toISOString(),
      mode: SOURCE_TRANSCRIPT_MODE,
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

async function readCachedTranscription(
  reviewCaseId: string
): Promise<DiarizationResult | null> {
  try {
    const cached = JSON.parse(
      await readFile(getTranscriptionCachePath(reviewCaseId), "utf8")
    ) as CachedDiarizationResult;

    if (!cached.transcript || !Array.isArray(cached.entries)) {
      return null;
    }

    return {
      jobId: cached.jobId || `local-transcribe-cache-${reviewCaseId}`,
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

async function writeCachedTranscription(
  reviewCaseId: string,
  result: CachedDiarizationResult
) {
  await mkdir(localCacheDir, { recursive: true });
  await writeFile(
    getTranscriptionCachePath(reviewCaseId),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8"
  );
}

function getTranscriptionCachePath(reviewCaseId: string) {
  return path.join(localCacheDir, `${reviewCaseId}.sarvam-transcribe.json`);
}

async function readCachedReviewCase(
  reviewCaseId: string
): Promise<ReviewCase | null> {
  try {
    const cached = JSON.parse(
      await readFile(getReviewCaseCachePath(reviewCaseId), "utf8")
    ) as CachedReviewCase;

    if (cached.cacheVersion !== 1 || !cached.caseData?.id) {
      return null;
    }

    return cached.caseData;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function writeCachedReviewCase(
  reviewCaseId: string,
  caseData: ReviewCase
) {
  await mkdir(localCacheDir, { recursive: true });
  await writeFile(
    getReviewCaseCachePath(reviewCaseId),
    `${JSON.stringify(
      {
        cacheVersion: 1,
        cachedAt: new Date().toISOString(),
        caseData,
      } satisfies CachedReviewCase,
      null,
      2
    )}\n`,
    "utf8"
  );
}

function getReviewCaseCachePath(reviewCaseId: string) {
  return path.join(localCacheDir, `${reviewCaseId}.review-case.json`);
}

async function refreshCachedSourceTranscriptIfNeeded(
  cachedCase: ReviewCase,
  baseCase: ReviewCase
) {
  if (isCurrentSourceCache(cachedCase)) {
    return cachedCase;
  }

  const audioPath = getAudioFilePath(baseCase.id);
  if (!audioPath) {
    return cachedCase;
  }

  const transcriptionResult = await readCachedTranscription(baseCase.id);
  if (!transcriptionResult) {
    return cachedCase;
  }

  const refreshedCase: ReviewCase = {
    ...cachedCase,
    modelMetadata: {
      ...cachedCase.modelMetadata,
      transcriptionModel: `Sarvam saarAs v3 ${SOURCE_TRANSCRIPT_MODE} ${SOURCE_ALIGNMENT_VERSION} job ${transcriptionResult.jobId}`,
    },
    transcript: cachedCase.transcript.map((turn) => ({
      ...turn,
      sourceText: sourceTextForTurn(turn, transcriptionResult.entries),
    })),
  };

  await writeCachedReviewCase(baseCase.id, refreshedCase);
  return refreshedCase;
}

async function repairKnownSourceOffsetIfNeeded(
  cachedCase: ReviewCase,
  reviewCaseId: string
) {
  if (
    cachedCase.id !== "rev-mp3-001" ||
    isCurrentSourceCache(cachedCase) ||
    !cachedCase.modelMetadata.transcriptionModel?.includes(
      `saarAs v3 ${SOURCE_TRANSCRIPT_MODE}`
    )
  ) {
    return cachedCase;
  }

  const offsetStartIndex = 45;
  if (cachedCase.transcript.length <= offsetStartIndex) {
    return cachedCase;
  }

  const repairedCase: ReviewCase = {
    ...cachedCase,
    modelMetadata: {
      ...cachedCase.modelMetadata,
      transcriptionModel: `${cachedCase.modelMetadata.transcriptionModel} ${SOURCE_ALIGNMENT_VERSION}`,
    },
    transcript: cachedCase.transcript.map((turn, index, turns) => {
      if (index < offsetStartIndex) return turn;

      return {
        ...turn,
        sourceText: turns[index - 1]?.sourceText || turn.sourceText || "",
      };
    }),
  };

  await writeCachedReviewCase(reviewCaseId, repairedCase);
  return repairedCase;
}

function isCurrentSourceCache(reviewCase: ReviewCase) {
  return reviewCase.modelMetadata.transcriptionModel?.includes(
    SOURCE_ALIGNMENT_VERSION
  );
}

async function readSarvamOutputJson(outputDir: string, inputFileName: string) {
  const preferredPath = path.join(outputDir, `${inputFileName}.json`);

  try {
    return JSON.parse(await readFile(preferredPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const outputFiles = (await readdir(outputDir)).filter((fileName) =>
    fileName.endsWith(".json")
  );
  if (outputFiles.length === 0) {
    throw new Error("Sarvam did not return a JSON output file");
  }

  return JSON.parse(
    await readFile(path.join(outputDir, outputFiles[0]), "utf8")
  );
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
    .filter((entry) => getSourceTranscript(entry) || getTranslatedText(entry))
    .map((entry, index) => {
      const speakerId = entry.speaker_id || "SPEAKER";
      const role = roles[speakerId] || "Speaker";
      const sourceText = getSourceTranscript(entry);
      const translatedText = getTranslatedText(entry);

      return {
        id: `turn-${index + 1}`,
        turnIndex: index + 1,
        startTimeSeconds: entry.start_time_seconds,
        endTimeSeconds: entry.end_time_seconds,
        speakerId,
        predictedRole: role,
        reviewedRole: role,
        sourceText,
        sourceTextNeedsCorrection: false,
        correctedSourceText: null,
        translatedText,
        correctedTranslation: null,
        modelOutputs: [
          {
            modelKey: "model_1",
            label: "Model A",
            text: translatedText,
            predictedRole: role,
            errorTags: [],
            severity: "none",
          },
          {
            modelKey: "model_2",
            label: "Model B",
            text: sourceText,
            predictedRole: "Speaker",
            errorTags: [],
            severity: "none",
          },
        ],
        preferredModelOutput: null,
        errorTags: [],
        severity: "none",
      };
    });
}

function mergeDiarizedEntries(
  translatedEntries: DiarizedEntry[],
  transcribedEntries: DiarizedEntry[]
) {
  if (translatedEntries.length === 0) {
    return transcribedEntries.map((entry) => ({
      ...entry,
      sourceTranscript: getTranslatedText(entry),
    }));
  }

  return translatedEntries.map((entry) => {
    const sourceTranscript = sourceTextForTurn(
      {
        startTimeSeconds: entry.start_time_seconds,
        endTimeSeconds: entry.end_time_seconds,
        speakerId: entry.speaker_id || "",
      },
      transcribedEntries
    );

    return {
      ...entry,
      sourceTranscript,
      translatedText: getTranslatedText(entry),
    };
  });
}

function sourceTextForTurn(
  turn: Pick<TranscriptTurnReview, "startTimeSeconds" | "endTimeSeconds" | "speakerId">,
  sourceEntries: DiarizedEntry[]
) {
  const sourceEntry = findBestSourceEntry(turn, sourceEntries);
  return sourceEntry ? getTranslatedText(sourceEntry) : "";
}

function findBestSourceEntry(
  turn: Pick<TranscriptTurnReview, "startTimeSeconds" | "endTimeSeconds" | "speakerId">,
  sourceEntries: DiarizedEntry[]
) {
  if (
    turn.startTimeSeconds === undefined ||
    turn.endTimeSeconds === undefined
  ) {
    return null;
  }

  let bestEntry: DiarizedEntry | null = null;
  let bestScore = 0;

  for (const entry of sourceEntries) {
    const overlap = timeOverlapSeconds(
      turn.startTimeSeconds,
      turn.endTimeSeconds,
      entry.start_time_seconds,
      entry.end_time_seconds
    );
    if (overlap <= 0) continue;

    const speakerBoost = speakersMatch(turn.speakerId, entry.speaker_id)
      ? 0.25
      : 0;
    const score = overlap + speakerBoost;

    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  return bestEntry;
}

function timeOverlapSeconds(
  startA: number,
  endA: number,
  startB?: number,
  endB?: number
) {
  if (startB === undefined || endB === undefined) return 0;
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function speakersMatch(left: string, right?: string) {
  return normalizeSpeakerId(left) === normalizeSpeakerId(right || "");
}

function normalizeSpeakerId(value: string) {
  return value.replace(/^speaker_/i, "");
}

function getSourceTranscript(entry: DiarizedEntry) {
  return (
    entry.sourceTranscript ||
    entry.source_transcript ||
    entry.original_transcript ||
    entry.input_transcript ||
    entry.transcription ||
    ""
  ).trim();
}

function getTranslatedText(entry: DiarizedEntry) {
  return (
    entry.translatedText ||
    entry.translated_text ||
    entry.translated_transcript ||
    entry.translation ||
    entry.transcript ||
    ""
  ).trim();
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
