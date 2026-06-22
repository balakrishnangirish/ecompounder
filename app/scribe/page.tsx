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

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function MedicalScribe() {
  const [mounted, setMounted] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);

  const [transcript, setTranscript] = useState("");
  const [soapNote, setSoapNote] = useState("");

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
  // SOAP GENERATION (HF API)
  // =========================

  const handleGenerateSOAP = async () => {
    if (!transcript) return;

    setLoadingLLM(true);
    setError(null);

    try {
      const res = await fetch("/api/generate-soap", {
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

      // IMPORTANT: HF route returns `soap`
      setSoapNote(data.soap || "");
    } catch (err: any) {
      setError(`SOAP Generation Error: ${err.message}`);
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
        <Tabs defaultValue="record">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="record">Record</TabsTrigger>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
            <TabsTrigger value="soap">SOAP Note</TabsTrigger>
          </TabsList>

          {/* RECORD */}
          <TabsContent value="record">
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
                  <Button
                    onClick={handleTranscribe}
                    disabled={loadingSTT}
                  >
                    {loadingSTT
                      ? "Transcribing..."
                      : "Generate Transcript"}
                  </Button>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TRANSCRIPT */}
          <TabsContent value="transcript">
            <Card>
              <CardHeader>
                <CardTitle>Transcript</CardTitle>
                <CardDescription>
                  Review and edit transcript
                </CardDescription>
              </CardHeader>

              <CardContent>
                <Textarea
                  className="min-h-[300px]"
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder="Transcript will appear here..."
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* SOAP */}
          <TabsContent value="soap">
            <Card>
              <CardHeader className="flex flex-row justify-between">
                <div>
                  <CardTitle>SOAP Note</CardTitle>
                  <CardDescription>
                    AI-generated clinical documentation
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
                <ScrollArea className="h-[350px] border p-4 rounded-md">
                  <pre className="whitespace-pre-wrap text-sm">
                    {soapNote || "SOAP note will appear here..."}
                  </pre>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}