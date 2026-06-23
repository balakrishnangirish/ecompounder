import WebSocket, { WebSocketServer } from "ws";
import dotenv from "dotenv";

dotenv.config();

const PORT = 3001;
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error("Missing API_KEY");
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

const wss = new WebSocketServer({ port: PORT });
console.log(`🎙 Live translation server running on ws://localhost:${PORT}`);

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
