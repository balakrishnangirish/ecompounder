import WebSocket, { WebSocketServer } from "ws";
import dotenv from "dotenv";
import { createServer } from "http";
import { randomUUID } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { SarvamAIClient } from "sarvamai";

dotenv.config();

const PORT = Number(process.env.PORT || 3001);
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error("Missing API_KEY");
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    ...corsHeaders,
    "Content-Type": "application/json",
  });
  res.end(JSON.stringify(body));
}

function logSarvamMessage(message) {
  try {
    const parsed = JSON.parse(message.toString());
    console.log("RAW SARVAM RESPONSE:", parsed);
    return parsed;
  } catch (err) {
    console.error("Sarvam parse error:", err);
    return null;
  }
}

function getEntries(value) {
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

function getTranscript(value) {
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

function formatDiarizedTranscript(entries) {
  const lines = [];

  for (const entry of entries) {
    const text = entry.transcript?.trim();
    if (!text) continue;

    const speaker = entry.speaker_id || "Speaker";
    const lastLine = lines[lines.length - 1];
    const prefix = `${speaker}:`;

    if (lastLine?.startsWith(prefix)) {
      lines[lines.length - 1] = `${lastLine} ${text}`;
    } else {
      lines.push(`${prefix} ${text}`);
    }
  }

  return lines.join("\n");
}

function requestToFormData(req) {
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      value.forEach((item) => headers.append(key, item));
    } else if (value) {
      headers.set(key, value);
    }
  }

  return new Request(`http://localhost${req.url}`, {
    method: req.method,
    headers,
    body: req,
    duplex: "half",
  }).formData();
}

async function handleDiarizeTranslation(req, res) {
  const workDir = path.join(os.tmpdir(), `sarvam-diarize-${randomUUID()}`);

  try {
    const formData = await requestToFormData(req);
    const audio = formData.get("audio");
    const numSpeakersValue = formData.get("numSpeakers");
    const numSpeakers =
      typeof numSpeakersValue === "string"
        ? Number.parseInt(numSpeakersValue, 10)
        : 2;

    if (!audio || typeof audio.arrayBuffer !== "function") {
      sendJson(res, 400, { error: "Missing audio file" });
      return;
    }

    await mkdir(workDir, { recursive: true });

    const inputFileName = "encounter.wav";
    const inputPath = path.join(workDir, inputFileName);
    const audioBuffer = Buffer.from(await audio.arrayBuffer());

    await writeFile(inputPath, audioBuffer);

    const client = new SarvamAIClient({
      apiSubscriptionKey: API_KEY,
      timeoutInSeconds: 120,
    });

    const job = await client.speechToTextTranslateJob.createJob({
      withDiarization: true,
      numSpeakers: Number.isFinite(numSpeakers) ? numSpeakers : 2,
    });

    const uploadLinks =
      await client.speechToTextTranslateJob.getUploadLinks({
        body: {
          job_id: job.jobId,
          files: [inputFileName],
        },
      });

    const uploadUrl = uploadLinks.upload_urls[inputFileName]?.file_url;
    if (!uploadUrl) {
      throw new Error("Sarvam did not return an upload URL");
    }

    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      body: audioBuffer,
      headers: {
        "Content-Type": "audio/wav",
        "x-ms-blob-type": "BlockBlob",
      },
    });

    if (!uploadResponse.ok) {
      throw new Error(`Audio upload failed: ${uploadResponse.status}`);
    }

    await job.start();

    const status = await job.waitUntilComplete(5, 240);
    if (status.job_state.toLowerCase() !== "completed") {
      sendJson(res, 502, {
        error: "Diarization job failed",
        status,
      });
      return;
    }

    const outputDir = path.join(workDir, "outputs");
    await job.downloadOutputs(outputDir);

    const outputPath = path.join(outputDir, `${inputFileName}.json`);
    const output = JSON.parse(await readFile(outputPath, "utf8"));
    const entries = getEntries(output);
    const diarizedTranscript = formatDiarizedTranscript(entries);
    const transcript = diarizedTranscript || getTranscript(output);

    if (!transcript) {
      sendJson(res, 502, {
        error: "No diarized transcript returned",
        raw: output,
      });
      return;
    }

    sendJson(res, 200, {
      success: true,
      jobId: job.jobId,
      transcript,
      entries,
      raw: output,
    });
  } catch (err) {
    console.error("DIARIZATION ERROR", err);
    sendJson(res, 500, {
      success: false,
      error: err?.message || "Diarization failed",
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (req.url === "/healthz") {
    res.writeHead(200, {
      ...corsHeaders,
      "Content-Type": "application/json",
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.url === "/diarize-translation" && req.method === "POST") {
    await handleDiarizeTranslation(req, res);
    return;
  }

  res.writeHead(200, {
    ...corsHeaders,
    "Content-Type": "text/plain",
  });
  res.end("E-Compounder live translation websocket server");
});

const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
  console.log(`🎙 Live translation server running on port ${PORT}`);
});

wss.on("connection", (clientSocket) => {
  console.log("Frontend connected");

  let audioBuffer = [];
  let flushInterval = null;

  const sarvamSocket = new WebSocket(
    "wss://api.sarvam.ai/speech-to-text-translate/ws" +
      "?model=saaras:v3" +
      "&sample_rate=16000" +
      "&input_audio_codec=pcm_s16le" +
      "&high_vad_sensitivity=true" +
      "&vad_signals=true",
    [`api-subscription-key.${API_KEY}`],
    {
      headers: {
        "Api-Subscription-Key": API_KEY,
      },
    }
  );

  sarvamSocket.on("open", () => {
    console.log("Connected to Sarvam translation websocket");
  });

  sarvamSocket.on("message", (message) => {
    const parsed = logSarvamMessage(message);
    if (!parsed) return;

    if (parsed.type === "error") {
      const errorMessage =
        parsed.data?.message || parsed.error?.message || "Sarvam websocket failed";

      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(JSON.stringify({ error: errorMessage }));
      }

      return;
    }

    const transcript =
      parsed.transcript ||
      parsed.text ||
      parsed.partial_transcript ||
      parsed.data?.transcript ||
      "";

    if (!transcript || transcript.trim().length === 0) return;
    if (/^[.,!?]+$/.test(transcript.trim())) return;

    clientSocket.send(
      JSON.stringify({
        transcript: transcript.trim(),
        isFinal: parsed.type === "data" || !parsed.partial_transcript,
        rawType: parsed.type,
      })
    );
  });

  // RECEIVE AUDIO FROM FRONTEND
  clientSocket.on("message", (audioChunk) => {
    if (sarvamSocket.readyState !== WebSocket.OPEN) return;
    audioBuffer.push(audioChunk);
  });

  // PERIODIC FLUSH TO SARVAM
  flushInterval = setInterval(() => {
    if (sarvamSocket.readyState !== WebSocket.OPEN) return;
    if (audioBuffer.length === 0) return;

    const mergedBuffer = Buffer.concat(audioBuffer);
    audioBuffer = [];

    sarvamSocket.send(
      JSON.stringify({
        audio: {
          data: mergedBuffer.toString("base64"),
          encoding: "audio/wav",
          sample_rate: 16000,
        },
      })
    );
  }, 100);

  clientSocket.on("close", () => {
    console.log("Frontend disconnected");

    if (flushInterval) clearInterval(flushInterval);

    if (sarvamSocket.readyState === WebSocket.OPEN) {
      sarvamSocket.close();
    }
  });

  sarvamSocket.on("close", () => {
    console.log("Sarvam websocket closed");

    if (flushInterval) clearInterval(flushInterval);

    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.close();
    }
  });

  sarvamSocket.on("error", (err) => {
    console.error("Sarvam websocket error:", err);

    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.send(
        JSON.stringify({ error: "Sarvam websocket failed" })
      );
    }
  });
});
