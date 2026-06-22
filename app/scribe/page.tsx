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

// Tabs removed (UI simplified to 2-column layout)
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function MedicalScribe() {
  const [mounted, setMounted] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);

  const [transcript, setTranscript] = useState("");
  const [soapNote, setSoapNote] = useState<any>(null);

  const [loadingSTT, setLoadingSTT] = useState(false);
  const [loadingLLM, setLoadingLLM] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<any>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // =========================
  // RECORDING
  // =========================

  const startRecording = async () => {
    setError(null);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, {
          type: "audio/wav",
        });
        setAudioBlob(blob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      setError("Microphone access denied or unavailable.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);

      mediaRecorderRef.current.stream
        .getTracks()
        .forEach((track: any) => track.stop());
    }
  };

  // =========================
  // TRANSCRIPTION (SARVAM)
  // =========================

  const handleTranscribe = async () => {
    if (!audioBlob) return;

    setLoadingSTT(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "encounter.wav");

      const res = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to transcribe");
      }

      setTranscript(data.transcript || "");
    } catch (err: any) {
      setError(`Transcription Error: ${err.message}`);
    } finally {
      setLoadingSTT(false);
    }
  };

  // =========================
  // SOAP GENERATION (GROQ API)
  // =========================

  const handleGenerateSOAP = async () => {
    if (!transcript) return;

    setSoapNote(null);
    setLoadingLLM(true);

    try {
      const res = await fetch("/api/generate-soap-stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ transcript }),
      });

      if (!res.body) {
        throw new Error("No stream received");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let fullText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        fullText += decoder.decode(value, { stream: true });
      }

      // Extract JSON if model returns extra text
      const jsonStart = fullText.indexOf("{");
      const jsonEnd = fullText.lastIndexOf("}");

      if (jsonStart === -1 || jsonEnd === -1) {
        throw new Error("Invalid SOAP JSON returned by model");
      }

      const jsonString = fullText.slice(jsonStart, jsonEnd + 1);
      const parsed = JSON.parse(jsonString);

      setSoapNote(parsed);
    } catch (err: any) {
      console.error(err);
      setSoapNote({
        subjective: "Error generating SOAP",
        objective: "",
        assessment: "",
        plan: "",
      });
    } finally {
      setLoadingLLM(false);
    }
  };

  // =========================
  // LOADING STATE
  // =========================

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-400 font-mono">
          Initializing scribe dashboard...
        </p>
      </div>
    );
  }

  // =========================
  // UI
  // =========================

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-6 md:p-12">
      <header className="max-w-7xl mx-auto mb-8 flex justify-between border-b pb-5">
        <h1 className="text-3xl font-bold text-blue-600">
          E-Compounder AI Scribe
        </h1>

        <Badge variant="secondary">AI Active</Badge>
      </header>

      {error && (
        <Alert variant="destructive" className="max-w-7xl mx-auto mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <main className="max-w-6xl mx-auto space-y-6">
        {/* Recorder section */}
        <Card>
          <CardHeader>
            <CardTitle>Recorder</CardTitle>
            <CardDescription>
              Capture patient consultation audio
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="flex justify-center">
              <Button
                onClick={isRecording ? stopRecording : startRecording}
                size="lg"
                variant={isRecording ? "destructive" : "default"}
                className="h-16 w-16 rounded-full"
              >
                {isRecording ? <Square /> : <Mic />}
              </Button>
            </div>

            {audioBlob && (
              <div className="flex justify-end mb-2">
                <Button
                  onClick={handleTranscribe}
                  disabled={loadingSTT}
                  className="gap-2"
                >
                  {loadingSTT ? "Transcribing..." : "Generate Transcript"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Two-column layout for Transcript and SOAP */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* LEFT COLUMN — Transcript */}
          <Card>
            <CardHeader>
              <CardTitle>Transcript</CardTitle>
              <CardDescription>
                Editable clinical transcript
              </CardDescription>
            </CardHeader>

            <CardContent>
              <Textarea
                className="min-h-[500px]"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Transcript will appear here..."
              />
            </CardContent>
          </Card>

          {/* RIGHT COLUMN — SOAP */}
          <Card>
            <CardHeader className="flex flex-row justify-between items-center">
              <div>
                <CardTitle>SOAP Note</CardTitle>
                <CardDescription>
                  AI-generated structured clinical documentation
                </CardDescription>
              </div>

              <Button
                onClick={handleGenerateSOAP}
                disabled={!transcript || loadingLLM}
              >
                {loadingLLM ? "Generating..." : "Generate SOAP"}
              </Button>
            </CardHeader>

            <CardContent>
              <div className="space-y-4 h-[500px] overflow-y-auto border p-4 rounded-md text-sm font-mono">

                <div>
                  <h3 className="font-bold text-blue-600">Subjective</h3>
                  <p>{soapNote?.subjective || "—"}</p>
                </div>

                <div>
                  <h3 className="font-bold text-blue-600">Objective</h3>
                  <p>{soapNote?.objective || "—"}</p>
                </div>

                <div>
                  <h3 className="font-bold text-blue-600">Assessment</h3>
                  <p>{soapNote?.assessment || "—"}</p>
                </div>

                <div>
                  <h3 className="font-bold text-blue-600">Plan</h3>
                  <p>{soapNote?.plan || "—"}</p>
                </div>

              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}