"use client";

import { useState, useRef, useEffect } from "react";
import { Mic, Square, AlertCircle } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";

type SoapNote = {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
};

type SoapStatus = "empty" | "draft" | "final";
type EditStatus = "clean" | "unsaved" | "saved";

const EMPTY_SOAP: SoapNote = {
  subjective: "",
  objective: "",
  assessment: "",
  plan: "",
};

export default function MedicalScribe() {
  const [mounted, setMounted] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");

  const [soapNote, setSoapNote] = useState<SoapNote>(EMPTY_SOAP);
  const [soapStatus, setSoapStatus] = useState<SoapStatus>("empty");
  const [editedSoapFields, setEditedSoapFields] = useState<
    Array<keyof SoapNote>
  >([]);
  const [editStatus, setEditStatus] = useState<EditStatus>("clean");
  const [loadingLLM, setLoadingLLM] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);

  const websocketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const flushTimerRef = useRef<NodeJS.Timeout | null>(null);
  const transcriptRef = useRef("");
  const loadingLLMRef = useRef(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    transcriptRef.current = `${finalTranscript} ${interimTranscript}`.trim();
  }, [finalTranscript, interimTranscript]);

  useEffect(() => {
    loadingLLMRef.current = loadingLLM;
  }, [loadingLLM]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      websocketRef.current?.close();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioContextRef.current?.close();
    };
  }, []);

  useEffect(() => {
    let t: NodeJS.Timeout | null = null;

    if (isRecording) {
      t = setInterval(() => setRecordingTime((s) => s + 1), 1000);
    }

    return () => {
      if (t) clearInterval(t);
    };
  }, [isRecording]);

  // =========================
  // START RECORDING
  // =========================
  const startRecording = async () => {
    setError(null);
    setRecordingTime(0);
    setFinalTranscript("");
    setInterimTranscript("");
    setSoapNote(EMPTY_SOAP);
    setSoapStatus("empty");
    setEditedSoapFields([]);
    setEditStatus("clean");

    try {
      // ---------------- WS ----------------
      if (
        !websocketRef.current ||
        websocketRef.current.readyState === WebSocket.CLOSED
      ) {
        websocketRef.current = new WebSocket("ws://localhost:3001");

        websocketRef.current.onopen = () => setSocketConnected(true);
        websocketRef.current.onclose = () => setSocketConnected(false);
        websocketRef.current.onerror = () =>
          setError("WebSocket connection failed");

        websocketRef.current.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);

            if (msg.error) {
              setError(msg.error);
              return;
            }

            const text = (
              msg.transcript ||
              msg.text ||
              msg.partial_transcript ||
              msg.data?.transcript ||
              ""
            ).trim();

            // Sarvam can send empty transcripts on VAD events.
            if (!text) return;

            const isFinal = msg.isFinal ?? msg.type === "data";

            if (isFinal) {
              setFinalTranscript((prev) =>
                prev ? `${prev}\n${text}` : text
              );
              setInterimTranscript("");
            } else {
              setInterimTranscript(text);
            }
          } catch (e) {
            console.error("WS parse error", e);
          }
        };
      }

      // ---------------- AUDIO ----------------
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      await audioContext.audioWorklet.addModule("/pcm-worklet.js");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;

      const source = audioContext.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(
        audioContext,
        "pcm-processor"
      );
      const silentSink = audioContext.createGain();
      silentSink.gain.value = 0;

      source.connect(worklet);
      worklet.connect(silentSink);
      silentSink.connect(audioContext.destination);

      // =========================
      // PCM STREAMING (CORRECT)
      // =========================
      let pcmQueue: ArrayBuffer[] = [];

      worklet.port.onmessage = (event) => {
        pcmQueue.push(event.data);

        if (flushTimerRef.current) return;

        flushTimerRef.current = setTimeout(() => {
          try {
            if (
              websocketRef.current?.readyState !== WebSocket.OPEN
            ) {
              pcmQueue = [];
              flushTimerRef.current = null;
              return;
            }

            const total = pcmQueue.reduce(
              (s, b) => s + b.byteLength,
              0
            );

            const merged = new Uint8Array(total);

            let offset = 0;
            for (const chunk of pcmQueue) {
              merged.set(new Uint8Array(chunk), offset);
              offset += chunk.byteLength;
            }

            websocketRef.current.send(merged.buffer);

            pcmQueue = [];
            flushTimerRef.current = null;
          } catch (e) {
            console.error(e);
            pcmQueue = [];
            flushTimerRef.current = null;
          }
        }, 200); // lower latency = more "live feel"
      };

      setIsRecording(true);
    } catch (err) {
      console.error(err);
      setError("Microphone access denied or unavailable.");
    }
  };

  // =========================
  // STOP
  // =========================
  const stopRecording = () => {
    setIsRecording(false);

    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    websocketRef.current?.close();
    websocketRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    audioContextRef.current?.close();
    audioContextRef.current = null;

    setSocketConnected(false);
  };

  const generateSOAP = async () => {
    const transcript = transcriptRef.current;

    if (!transcript) {
      setError("No English translation available to generate SOAP notes.");
      return false;
    }

    if (soapStatus === "final") return false;
    if (loadingLLMRef.current) return false;

    setError(null);
    setLoadingLLM(true);

    try {
      const res = await fetch("/api/generate-soap-stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ transcript }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to generate SOAP note");
      }

      setSoapNote((prev) => ({
        subjective: editedSoapFields.includes("subjective")
          ? prev.subjective
          : data.subjective || "",
        objective: editedSoapFields.includes("objective")
          ? prev.objective
          : data.objective || "",
        assessment: editedSoapFields.includes("assessment")
          ? prev.assessment
          : data.assessment || "",
        plan: editedSoapFields.includes("plan")
          ? prev.plan
          : data.plan || "",
      }));
      setSoapStatus("draft");
      setEditStatus("clean");
      return true;
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Failed to generate SOAP note.");
      return false;
    } finally {
      setLoadingLLM(false);
    }
  };

  const handleSOAPFieldChange = (
    field: keyof SoapNote,
    value: string
  ) => {
    if (soapStatus === "final") return;

    setSoapNote((prev) => ({
      ...prev,
      [field]: value,
    }));
    setSoapStatus("draft");
    setEditStatus("unsaved");
    setEditedSoapFields((prev) =>
      prev.includes(field) ? prev : [...prev, field]
    );
  };

  const handleSaveEdits = () => {
    const hasSoapText = Object.values(soapNote).some((value) =>
      value.trim()
    );

    if (!hasSoapText || soapStatus === "final") return;

    setError(null);
    setEditStatus("saved");
  };

  const handleFinalizeSOAP = () => {
    const hasSoapText = Object.values(soapNote).some((value) =>
      value.trim()
    );

    if (!hasSoapText) {
      setError("Generate or enter a SOAP note before finalizing.");
      return;
    }

    setError(null);
    setEditStatus("saved");
    setSoapStatus("final");
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m.toString().padStart(2, "0")}:${r
      .toString()
      .padStart(2, "0")}`;
  };

  if (!mounted) return null;

  const currentTranscript = `${finalTranscript} ${interimTranscript}`.trim();
  const soapStatusLabel =
    soapStatus === "final"
      ? "Final"
      : soapStatus === "draft"
      ? editStatus === "unsaved"
        ? "Unsaved edits"
        : editStatus === "saved"
        ? "Edits saved"
        : "Draft"
      : "Not started";
  const hasSoapText = Object.values(soapNote).some((value) =>
    value.trim()
  );

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10">
      <header className="flex justify-between mb-6">
        <h1 className="text-xl font-bold text-blue-600">
          E-Compounder AI Scribe
        </h1>

        <Badge variant={socketConnected ? "default" : "secondary"}>
          {socketConnected ? "Live" : "Offline"}
        </Badge>
      </header>

      {error && (
        <Alert className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ================= RECORDER ================= */}
      <Card className="mb-6">
        <CardHeader className="py-2">
          <CardTitle>Recorder</CardTitle>
          <CardDescription>
            Live patient consultation capture
          </CardDescription>
        </CardHeader>

        <CardContent className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Button
              onClick={
                isRecording ? stopRecording : startRecording
              }
              variant={isRecording ? "destructive" : "default"}
              size="lg"
              className="h-14 w-14 rounded-full"
            >
              {isRecording ? <Square /> : <Mic />}
            </Button>

            <div className="text-sm text-slate-600">
              {isRecording
                ? `Live • ${formatTime(recordingTime)}`
                : "Ready"}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ================= 2 COLUMN UI (RESTORED) ================= */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* LEFT: TRANSCRIPT */}
        <Card>
          <CardHeader>
            <CardTitle>English Translation</CardTitle>
            <CardDescription>
              Live speech translated to English
            </CardDescription>
          </CardHeader>

          <CardContent>
            <Textarea
              className="h-[520px]"
              value={[finalTranscript, interimTranscript]
                .filter(Boolean)
                .join("\n")
                .trim()}
              readOnly
              placeholder="Live English translation will appear here..."
            />
          </CardContent>
        </Card>

        {/* RIGHT: SOAP */}
        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>SOAP Note</CardTitle>
              <CardDescription>
                Structured clinical documentation
              </CardDescription>
            </div>

            <div className="flex w-full flex-col gap-2 sm:w-auto">
              <Badge
                variant={soapStatus === "final" ? "default" : "secondary"}
                className="w-fit"
              >
                {loadingLLM ? "Updating..." : soapStatusLabel}
              </Badge>

              <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  onClick={() => generateSOAP()}
                  disabled={
                    !currentTranscript || loadingLLM || soapStatus === "final"
                  }
                  className="w-full sm:w-auto"
                >
                  {loadingLLM ? "Generating..." : "Generate SOAP"}
                </Button>

                <Button
                  onClick={handleSaveEdits}
                  disabled={
                    !hasSoapText ||
                    editStatus !== "unsaved" ||
                    soapStatus === "final"
                  }
                  variant="secondary"
                  className="w-full sm:w-auto"
                >
                  Save Edits
                </Button>

                <Button
                  onClick={handleFinalizeSOAP}
                  disabled={
                    !hasSoapText ||
                    loadingLLM ||
                    editStatus === "unsaved" ||
                    soapStatus === "final"
                  }
                  variant="secondary"
                  className="w-full sm:w-auto"
                >
                  Finalize
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            <div className="h-[520px] overflow-y-auto border rounded-md p-4 text-sm space-y-4 bg-white">

              <div>
                <div className="font-bold text-blue-600">
                  Subjective
                </div>
                <Textarea
                  className="mt-2 min-h-24 resize-y"
                  value={soapNote.subjective}
                  onChange={(e) =>
                    handleSOAPFieldChange("subjective", e.target.value)
                  }
                  readOnly={soapStatus === "final"}
                  placeholder="Subjective notes..."
                />
              </div>

              <div>
                <div className="font-bold text-blue-600">
                  Objective
                </div>
                <Textarea
                  className="mt-2 min-h-24 resize-y"
                  value={soapNote.objective}
                  onChange={(e) =>
                    handleSOAPFieldChange("objective", e.target.value)
                  }
                  readOnly={soapStatus === "final"}
                  placeholder="Objective findings..."
                />
              </div>

              <div>
                <div className="font-bold text-blue-600">
                  Assessment
                </div>
                <Textarea
                  className="mt-2 min-h-24 resize-y"
                  value={soapNote.assessment}
                  onChange={(e) =>
                    handleSOAPFieldChange("assessment", e.target.value)
                  }
                  readOnly={soapStatus === "final"}
                  placeholder="Assessment..."
                />
              </div>

              <div>
                <div className="font-bold text-blue-600">
                  Plan
                </div>
                <Textarea
                  className="mt-2 min-h-24 resize-y"
                  value={soapNote.plan}
                  onChange={(e) =>
                    handleSOAPFieldChange("plan", e.target.value)
                  }
                  readOnly={soapStatus === "final"}
                  placeholder="Plan..."
                />
              </div>

            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
