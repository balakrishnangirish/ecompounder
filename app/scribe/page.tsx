"use client";

import { useState, useRef, useEffect } from "react";
import {
  Mic,
  Square,
  AlertCircle,
  UserPlus,
  User,
} from "lucide-react";

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

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SoapNote = {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
};

type SoapStatus = "empty" | "draft" | "final";
type EditStatus = "clean" | "unsaved" | "saved";
type DiarizationStatus = "idle" | "processing" | "ready" | "error";
type SpeakerRole = "Doctor" | "Patient" | "Speaker";
type RoleStatus =
  | "idle"
  | "suggesting"
  | "needs-confirmation"
  | "confirmed";

type DiarizedEntry = {
  speaker_id?: string;
  transcript?: string;
};

type Patient = {
  id: string;
  fullName: string;
  dob?: string;
  phone?: string;
};

type Encounter = {
  id: string;
  startedAt: string;
  patientId: string;
};

const EMPTY_SOAP: SoapNote = {
  subjective: "",
  objective: "",
  assessment: "",
  plan: "",
};

const LIVE_WS_URL =
  process.env.NEXT_PUBLIC_LIVE_WS_URL || "ws://localhost:3001";

function mergeArrayBuffers(chunks: ArrayBuffer[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  return merged;
}

function createWavBlob(chunks: ArrayBuffer[], sampleRate = 16000) {
  const pcm = mergeArrayBuffers(chunks);
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, pcm.byteLength, true);

  return new Blob([header, pcm], { type: "audio/wav" });
}

function getSpeakerIds(entries: DiarizedEntry[], transcript: string) {
  const ids = new Set<string>();

  for (const entry of entries) {
    if (entry.speaker_id) ids.add(entry.speaker_id);
  }

  for (const line of transcript.split("\n")) {
    const speaker = line.match(/^([^:]+):/)?.[1]?.trim();
    if (speaker) ids.add(speaker);
  }

  return Array.from(ids);
}

function buildDefaultRoleMap(speakers: string[]) {
  return speakers.reduce<Record<string, SpeakerRole>>((roles, speaker, index) => {
    roles[speaker] =
      index === 0 ? "Doctor" : index === 1 ? "Patient" : "Speaker";
    return roles;
  }, {});
}

function applySpeakerRoles(
  transcript: string,
  roles: Record<string, SpeakerRole>
) {
  return transcript
    .split("\n")
    .map((line) => {
      const match = line.match(/^([^:]+):(.*)$/);
      if (!match) return line;

      const speaker = match[1].trim();
      const text = match[2].trim();
      const role = roles[speaker] || speaker;

      return `${role}: ${text}`;
    })
    .join("\n");
}

export default function MedicalScribe() {
  const [mounted, setMounted] = useState(false);

  const [patientDialogOpen, setPatientDialogOpen] =
    useState(false);

  const [patientName, setPatientName] = useState("");
  const [patientDOB, setPatientDOB] = useState("");
  const [patientPhone, setPatientPhone] = useState("");

  const [patient, setPatient] = useState<Patient | null>(null);
  const [encounter, setEncounter] = useState<Encounter | null>(null);

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
  const [diarizationStatus, setDiarizationStatus] =
    useState<DiarizationStatus>("idle");
  const [diarizationMessage, setDiarizationMessage] = useState("");
  const [rawDiarizedTranscript, setRawDiarizedTranscript] = useState("");
  const [speakerIds, setSpeakerIds] = useState<string[]>([]);
  const [speakerRoles, setSpeakerRoles] = useState<
    Record<string, SpeakerRole>
  >({});
  const [roleStatus, setRoleStatus] = useState<RoleStatus>("idle");

  const [error, setError] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);

  const websocketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const flushTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pcmRecordingChunksRef = useRef<ArrayBuffer[]>([]);
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

  const handleCreatePatient = () => {
    if (!patientName.trim()) {
      setError("Patient name is required.");
      return;
    }

    const newPatient: Patient = {
      id: crypto.randomUUID(),
      fullName: patientName,
      dob: patientDOB,
      phone: patientPhone,
    };

    const newEncounter: Encounter = {
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      patientId: newPatient.id,
    };

    setPatient(newPatient);
    setEncounter(newEncounter);

    setPatientDialogOpen(false);

    setPatientName("");
    setPatientDOB("");
    setPatientPhone("");

    setError(null);
  };

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
    setDiarizationStatus("idle");
    setDiarizationMessage("");
    setRawDiarizedTranscript("");
    setSpeakerIds([]);
    setSpeakerRoles({});
    setRoleStatus("idle");
    pcmRecordingChunksRef.current = [];

    if (!patient || !encounter) {
      setError("Please add a patient before starting recording.");
      return;
    }

    try {
      // ---------------- WS ----------------
      if (
        !websocketRef.current ||
        websocketRef.current.readyState === WebSocket.CLOSED
      ) {
        websocketRef.current = new WebSocket(LIVE_WS_URL);

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
        pcmRecordingChunksRef.current.push(event.data.slice(0));

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
  const processDiarizedTranscript = async (audioBlob: Blob) => {
    if (audioBlob.size === 0) return;

    setDiarizationStatus("processing");
    setDiarizationMessage("Finalizing speaker-separated transcript...");

    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "encounter.wav");
      formData.append("numSpeakers", "2");

      const res = await fetch("/api/diarize-translation", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Diarization failed");
      }

      const rawTranscript = data.transcript || "";
      const speakers = getSpeakerIds(data.entries || [], rawTranscript);
      const fallbackRoles = buildDefaultRoleMap(speakers);

      setRawDiarizedTranscript(rawTranscript);
      setSpeakerIds(speakers);
      setSpeakerRoles(fallbackRoles);
      setRoleStatus(speakers.length > 0 ? "suggesting" : "idle");
      setFinalTranscript(
        speakers.length > 0
          ? applySpeakerRoles(rawTranscript, fallbackRoles)
          : rawTranscript
      );
      setInterimTranscript("");
      setDiarizationStatus("ready");
      setDiarizationMessage(
        speakers.length > 0
          ? "Speaker-separated transcript ready. Confirm speaker roles before generating SOAP."
          : "Speaker-separated transcript ready."
      );

      if (speakers.length > 0) {
        void inferSpeakerRoles(rawTranscript, speakers, fallbackRoles);
      }

      if (soapStatus !== "final") {
        setSoapNote(EMPTY_SOAP);
        setSoapStatus("empty");
        setEditedSoapFields([]);
        setEditStatus("clean");
      }
    } catch (err: any) {
      console.error(err);
      setDiarizationStatus("error");
      setDiarizationMessage(
        err?.message || "Could not finalize speaker-separated transcript."
      );
    }
  };

  const inferSpeakerRoles = async (
    transcript: string,
    speakers: string[],
    fallbackRoles: Record<string, SpeakerRole>
  ) => {
    try {
      const res = await fetch("/api/infer-speaker-roles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transcript,
          speakers,
          patientName: patient?.fullName || "",
        }),
      });

      const data = await res.json();
      const roles = res.ok ? data.roles || fallbackRoles : fallbackRoles;

      setSpeakerRoles(roles);
      setFinalTranscript(applySpeakerRoles(transcript, roles));
      setRoleStatus("needs-confirmation");
      setDiarizationMessage("Suggested speaker roles. Confirm or swap before generating SOAP.");
    } catch (err) {
      console.error(err);
      setSpeakerRoles(fallbackRoles);
      setFinalTranscript(applySpeakerRoles(transcript, fallbackRoles));
      setRoleStatus("needs-confirmation");
      setDiarizationMessage("Default speaker roles applied. Confirm or swap before generating SOAP.");
    }
  };

  const handleSwapSpeakerRoles = () => {
    if (speakerIds.length < 2 || !rawDiarizedTranscript) return;

    const [firstSpeaker, secondSpeaker] = speakerIds;
    const nextRoles = {
      ...speakerRoles,
      [firstSpeaker]: speakerRoles[secondSpeaker] || "Patient",
      [secondSpeaker]: speakerRoles[firstSpeaker] || "Doctor",
    };

    setSpeakerRoles(nextRoles);
    setFinalTranscript(applySpeakerRoles(rawDiarizedTranscript, nextRoles));
    setRoleStatus("needs-confirmation");
    setDiarizationMessage("Speaker roles swapped. Confirm when correct.");
  };

  const handleConfirmSpeakerRoles = () => {
    if (!rawDiarizedTranscript) return;

    setFinalTranscript(
      applySpeakerRoles(rawDiarizedTranscript, speakerRoles)
    );
    setRoleStatus("confirmed");
    setDiarizationMessage("Speaker roles confirmed.");
  };

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

    if (pcmRecordingChunksRef.current.length > 0) {
      const wavBlob = createWavBlob(pcmRecordingChunksRef.current);
      void processDiarizedTranscript(wavBlob);
    }
  };

  const generateSOAP = async () => {
    const transcript = transcriptRef.current;

    if (!transcript) {
      setError("No English translation available to generate SOAP notes.");
      return false;
    }

    if (soapStatus === "final") return false;
    if (loadingLLMRef.current) return false;

    if (
      speakerIds.length > 0 &&
      roleStatus !== "confirmed"
    ) {
      setError("Please confirm speaker roles before generating SOAP notes.");
      return false;
    }

    setError(null);
    setLoadingLLM(true);

    try {
      const res = await fetch("/api/generate-soap-stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transcript,
          patient,
          encounter,
        }),
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
      <Dialog
        open={patientDialogOpen}
        onOpenChange={setPatientDialogOpen}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Start New Encounter</DialogTitle>

            <DialogDescription>
              Add lightweight patient details before recording.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="patient-name">Patient Name</Label>

              <Input
                id="patient-name"
                placeholder="Jane Doe"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="patient-dob">Date of Birth</Label>

              <Input
                id="patient-dob"
                type="date"
                value={patientDOB}
                onChange={(e) => setPatientDOB(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="patient-phone">
                Phone (Optional)
              </Label>

              <Input
                id="patient-phone"
                placeholder="+91..."
                value={patientPhone}
                onChange={(e) => setPatientPhone(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button onClick={handleCreatePatient}>
              Create & Start Encounter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <header className="flex flex-col gap-4 mb-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-bold text-blue-600">
            E-Compounder AI Scribe
          </h1>

          <p className="text-sm text-slate-500 mt-1">
            Ambient clinical documentation workspace
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => setPatientDialogOpen(true)}
            className="gap-2"
          >
            <UserPlus className="h-4 w-4" />
            {patient ? "Switch Patient" : "Add Patient"}
          </Button>

          <Badge variant={socketConnected ? "default" : "secondary"}>
            {socketConnected ? "Live" : "Offline"}
          </Badge>
        </div>
      </header>

      {error && (
        <Alert className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {patient && encounter && (
        <Card className="mb-6 border-blue-100 bg-blue-50/40">
          <CardContent className="flex flex-col gap-4 py-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-blue-100 p-2">
                <User className="h-5 w-5 text-blue-600" />
              </div>

              <div>
                <p className="font-semibold text-slate-900">
                  {patient.fullName}
                </p>

                <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-600">
                  {patient.dob && <span>DOB: {patient.dob}</span>}

                  {patient.phone && (
                    <span>Phone: {patient.phone}</span>
                  )}
                </div>
              </div>
            </div>

            <div className="text-left md:text-right">
              <Badge variant="outline">Encounter Active</Badge>

              <p className="mt-2 text-xs font-mono text-slate-500">
                Encounter ID: {encounter.id.slice(0, 8)}
              </p>
            </div>
          </CardContent>
        </Card>
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
            <div className="mb-3 flex items-center justify-between">
              <Badge
                variant={
                  diarizationStatus === "ready" ? "default" : "secondary"
                }
              >
                {diarizationStatus === "processing"
                  ? "Finalizing speakers..."
                  : diarizationStatus === "ready"
                  ? "Speaker-separated"
                  : "Live English Translation"}
              </Badge>

              {patient && (
                <div className="text-xs text-slate-500">
                  Patient: {patient.fullName}
                </div>
              )}
            </div>
            {diarizationMessage && (
              <div className="mb-3 text-xs text-slate-500">
                {diarizationMessage}
              </div>
            )}
            {speakerIds.length > 0 &&
              roleStatus !== "idle" &&
              roleStatus !== "confirmed" && (
                <div className="mb-3 rounded-md border bg-slate-50 p-3">
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        Confirm Speaker Roles
                      </div>
                      <div className="text-xs text-slate-500">
                        Suggested from the diarized transcript.
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={handleSwapSpeakerRoles}
                        disabled={speakerIds.length < 2}
                      >
                        Swap Roles
                      </Button>

                      <Button
                        size="sm"
                        onClick={handleConfirmSpeakerRoles}
                        disabled={roleStatus === "suggesting"}
                      >
                        Confirm Roles
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {speakerIds.map((speaker) => (
                      <div
                        key={speaker}
                        className="flex items-center justify-between rounded border bg-white px-3 py-2"
                      >
                        <span className="font-mono text-xs text-slate-500">
                          {speaker}
                        </span>
                        <Badge variant="secondary">
                          {speakerRoles[speaker] || "Speaker"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            {roleStatus === "confirmed" && speakerIds.length > 0 && (
              <div className="mb-3 flex items-center justify-between rounded-md border bg-green-50 px-3 py-2 text-xs text-green-700">
                <span>Speaker roles confirmed</span>
                <Badge variant="secondary">Doctor / Patient</Badge>
              </div>
            )}
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
                    !currentTranscript ||
                    loadingLLM ||
                    soapStatus === "final" ||
                    diarizationStatus === "processing" ||
                    roleStatus === "suggesting" ||
                    roleStatus === "needs-confirmation"
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
