"use client";

import { useState, useRef, useEffect } from "react";
import {
  Mic,
  Square,
  AlertCircle,
  Play,
  Pause,
  Sparkles,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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

  const startRecording = async () => {
    setError(null);
    audioChunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/wav" });
        setAudioBlob(audioBlob);
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
      mediaRecorderRef.current.stream.getTracks().forEach((track: any) => track.stop());
    }
  };

  const handleTranscribe = async () => {
    if (!audioBlob) return;
    setLoadingSTT(true);
    setError(null);

    const formData = new FormData();
    formData.append("audio", audioBlob, "encounter.wav");

    try {
      const res = await fetch("/api/transcribe", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to transcribe");
      setTranscript(data.transcript);
    } catch (err: any) {
      setError(`Sarvam Processing Error: ${err.message}`);
    } finally {
      setLoadingSTT(false);
    }
  };

  const handleGenerateSOAP = async () => {
    if (!transcript) return;
    setLoadingLLM(true);
    setError(null);

    try {
      const res = await fetch("/api/generate-soap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate clinical note");
      setSoapNote(data.soapNote);
    } catch (err: any) {
      setError(`Local Ollama Inference Error: ${err.message}`);
    } finally {
      setLoadingLLM(false);
    }
  };

  if (!mounted) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-sm text-slate-400 font-mono">Initializing scribe dashboard...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-6 md:p-12" style={{ display: 'block' }}>
      <header className="max-w-7xl mx-auto mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-blue-600" style={{ color: '#2563eb' }}>E-Compounder AI Scribe</h1>
        </div>
        <div className="mt-4 sm:mt-0 flex items-center space-x-2 text-xs bg-slate-200 px-3 py-1.5 rounded-full font-mono text-slate-600" style={{ backgroundColor: '#e2e8f0' }}>
          <span className="w-2 h-2 rounded-full bg-green-500"></span>
        </div>
      </header>

      {error && (
        <div className="max-w-7xl mx-auto mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start space-x-3 text-red-700 shadow-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="text-sm font-medium">{error}</div>
        </div>
      )}

<main className="max-w-6xl mx-auto space-y-6">

  {error && (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  )}

  <div className="flex items-center justify-between">
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">
        Clinical Encounter Workspace
      </h2>
      <p className="text-sm text-muted-foreground">
        Record, transcribe, and generate structured SOAP notes.
      </p>
    </div>

    <Badge variant="secondary">Local AI Active</Badge>
  </div>

  <Tabs defaultValue="record" className="w-full">

    {/* NAV */}
    <TabsList className="grid w-full grid-cols-3">
      <TabsTrigger value="record">Record</TabsTrigger>
      <TabsTrigger value="transcript">Transcript</TabsTrigger>
      <TabsTrigger value="soap">SOAP Note</TabsTrigger>
    </TabsList>

    {/* ================= RECORD TAB ================= */}
    <TabsContent value="record">
      <Card>
        <CardHeader>
          <CardTitle>Recorder</CardTitle>
          <CardDescription>
            Capture patient consultation audio
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">

          <div className="flex items-center justify-center">
            <Button
              onClick={isRecording ? stopRecording : startRecording}
              size="lg"
              variant={isRecording ? "destructive" : "default"}
              className="h-16 w-16 rounded-full"
            >
              {isRecording ? <Square /> : <Mic />}
            </Button>
          </div>

          <div className="flex justify-center">
            <div className="flex gap-1 items-end h-10">
              {Array.from({ length: 24 }).map((_, i) => (
                <div
                  key={i}
                  className={`w-1 rounded-full transition-all ${
                    isRecording ? "bg-primary animate-pulse h-6" : "bg-muted h-3"
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{isRecording ? "Recording..." : "Idle"}</span>
            <span className="font-mono">{isRecording ? "REC" : "00:00"}</span>
          </div>

          {audioBlob && (
            <Button onClick={handleTranscribe} disabled={loadingSTT}>
              {loadingSTT ? "Transcribing..." : "Generate Transcript"}
            </Button>
          )}

        </CardContent>
      </Card>
    </TabsContent>

    {/* ================= TRANSCRIPT TAB ================= */}
    <TabsContent value="transcript">
      <Card>
        <CardHeader>
          <CardTitle>Transcript</CardTitle>
          <CardDescription>
            Review and edit the consultation transcript
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

    {/* ================= SOAP TAB ================= */}
    <TabsContent value="soap">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
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
          <ScrollArea className="h-[350px] rounded-md border p-4">
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