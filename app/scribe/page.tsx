"use client";

import { useState, useRef, useEffect, type ChangeEvent } from "react";
import {
  Mic,
  Square,
  AlertCircle,
  UserPlus,
  User,
  Upload,
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

import primaryCareSoapTemplate from "@/lib/soap/templates/primary-care-soap.v1.json";

type SoapNote = Record<string, unknown>;
type SoapFieldPath = string;
type SoapArrayFieldPath = string;
type SoapCheckboxFieldPath = string;
type SoapTemplateField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "checkbox" | "group" | "array";
  fields?: SoapTemplateField[];
  item?: {
    type: "text" | "textarea";
    label: string;
  };
  minItems?: number;
  maxItems?: number;
};
type SoapTemplateSection = {
  key: string;
  title: string;
  fields: SoapTemplateField[];
};

type SoapEditablePath = SoapFieldPath | SoapArrayFieldPath | SoapCheckboxFieldPath;

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

const SOAP_TEMPLATE = primaryCareSoapTemplate as {
  outputShape: SoapNote;
  sections: SoapTemplateSection[];
};
const EMPTY_SOAP: SoapNote = SOAP_TEMPLATE.outputShape;
const SOAP_TEXT_FIELD_PATHS = getSoapTemplateFieldPaths(SOAP_TEMPLATE.sections, [
  "text",
  "textarea",
]);
const SOAP_ARRAY_FIELD_PATHS = getSoapTemplateFieldPaths(SOAP_TEMPLATE.sections, [
  "array",
]);
const SOAP_CHECKBOX_PATHS = getSoapTemplateFieldPaths(SOAP_TEMPLATE.sections, [
  "checkbox",
]);

const LIVE_WS_URL =
  process.env.NEXT_PUBLIC_LIVE_WS_URL || "ws://localhost:3001";

function getDiarizationApiUrl() {
  if (process.env.NEXT_PUBLIC_DIARIZATION_API_URL) {
    return process.env.NEXT_PUBLIC_DIARIZATION_API_URL;
  }

  try {
    const url = new URL(LIVE_WS_URL);
    const isLocal =
      url.hostname === "localhost" || url.hostname === "127.0.0.1";

    if (isLocal) return "/api/diarize-translation";

    if (url.protocol === "wss:") url.protocol = "https:";
    if (url.protocol === "ws:") url.protocol = "http:";

    url.pathname = "/diarize-translation";
    url.search = "";
    url.hash = "";

    return url.toString();
  } catch {
    return "/api/diarize-translation";
  }
}

const DIARIZATION_API_URL = getDiarizationApiUrl();
const pageTitleClassName = "text-[22px] font-semibold leading-7 tracking-normal";
const panelTitleClassName = "text-[17px] font-semibold leading-6 text-slate-900";
const sectionTitleClassName = "text-[15px] font-semibold leading-5 text-slate-900";
const groupTitleClassName = "text-[14px] font-semibold leading-5 text-slate-700";
const fieldLabelClassName = "text-[13px] font-medium leading-5 text-slate-500";
const helperTextClassName = "text-[13px] leading-5 text-slate-500";
const editableBoxClassName =
  "border-slate-300 bg-white shadow-[inset_0_1px_0_rgba(15,23,42,0.03)]";

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

function getSoapTemplateFieldPaths(
  sections: SoapTemplateSection[],
  fieldTypes: SoapTemplateField["type"][]
) {
  return sections.flatMap((section) =>
    getSoapTemplateFieldPathsFromFields(section.fields, section.key, fieldTypes)
  );
}

function getSoapTemplateFieldPathsFromFields(
  fields: SoapTemplateField[],
  prefix: string,
  fieldTypes: SoapTemplateField["type"][]
): string[] {
  return fields.flatMap((field) => {
    const path = `${prefix}.${field.key}`;

    if (field.type === "group") {
      return getSoapTemplateFieldPathsFromFields(
        field.fields || [],
        path,
        fieldTypes
      );
    }

    return fieldTypes.includes(field.type) ? [path] : [];
  });
}

function cloneSoapNote(note: SoapNote) {
  return JSON.parse(JSON.stringify(note)) as SoapNote;
}

function getSoapField(note: SoapNote, path: SoapFieldPath) {
  const value = path
    .split(".")
    .reduce<unknown>((current, key) => {
      if (!current || typeof current !== "object") return "";
      return (current as Record<string, unknown>)[key];
    }, note);

  return typeof value === "string" ? value : "";
}

function getSoapArrayField(note: SoapNote, path: SoapFieldPath) {
  const value = path
    .split(".")
    .reduce<unknown>((current, key) => {
      if (!current || typeof current !== "object") return [];
      return (current as Record<string, unknown>)[key];
    }, note);

  return Array.isArray(value)
    ? value.map((item) => (typeof item === "string" ? item : ""))
    : [];
}

function arrayToNumberedText(items: string[]) {
  const visibleItems = items.length > 0 ? items : [""];
  return visibleItems.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function numberedTextToArray(value: string) {
  return value
    .split("\n")
    .map((line) => line.replace(/^\s*\d+[\).:-]?\s*/, ""));
}

function getSoapCheckboxField(note: SoapNote, path: SoapCheckboxFieldPath) {
  const value = path
    .split(".")
    .reduce<unknown>((current, key) => {
      if (!current || typeof current !== "object") return false;
      return (current as Record<string, unknown>)[key];
    }, note);

  return value === true;
}

function setSoapField(
  note: SoapNote,
  path: SoapFieldPath,
  value: string | string[]
) {
  const next = cloneSoapNote(note);
  const keys = path.split(".");
  let current: Record<string, unknown> = next as unknown as Record<
    string,
    unknown
  >;

  for (const key of keys.slice(0, -1)) {
    current = current[key] as Record<string, unknown>;
  }

  current[keys[keys.length - 1]] = value;
  return next;
}

function setSoapCheckboxField(
  note: SoapNote,
  path: SoapCheckboxFieldPath,
  value: boolean
) {
  const next = cloneSoapNote(note);
  const keys = path.split(".");
  let current: Record<string, unknown> = next as unknown as Record<
    string,
    unknown
  >;

  for (const key of keys.slice(0, -1)) {
    current = current[key] as Record<string, unknown>;
  }

  current[keys[keys.length - 1]] = value;
  return next;
}

function normalizeSoapNote(data: Partial<SoapNote>) {
  let next = cloneSoapNote(EMPTY_SOAP);

  for (const path of SOAP_TEXT_FIELD_PATHS) {
    const value = getSoapField(data as SoapNote, path);
    if (typeof value === "string") {
      next = setSoapField(next, path, value);
    }
  }

  for (const path of SOAP_ARRAY_FIELD_PATHS) {
    next = setSoapField(next, path, getSoapArrayField(data as SoapNote, path));
  }

  for (const path of SOAP_CHECKBOX_PATHS) {
    const value = getSoapCheckboxField(data as SoapNote, path);
    if (typeof value === "boolean") {
      next = setSoapCheckboxField(next, path, value);
    }
  }

  return next;
}

function mergeGeneratedSoapNote(
  current: SoapNote,
  generated: Partial<SoapNote>,
  editedFields: SoapEditablePath[]
) {
  let next = normalizeSoapNote(generated);

  for (const path of editedFields) {
    if (isSoapCheckboxPath(path)) {
      next = setSoapCheckboxField(
        next,
        path,
        getSoapCheckboxField(current, path)
      );
    } else if (isSoapArrayPath(path)) {
      next = setSoapField(next, path, getSoapArrayField(current, path));
    } else {
      next = setSoapField(next, path, getSoapField(current, path) || "");
    }
  }

  return next;
}

function soapHasText(note: SoapNote) {
  return (
    SOAP_TEXT_FIELD_PATHS.some((path) => getSoapField(note, path).trim()) ||
    SOAP_ARRAY_FIELD_PATHS.some((path) =>
      getSoapArrayField(note, path).some((item) => item.trim())
    ) ||
    SOAP_CHECKBOX_PATHS.some((path) => getSoapCheckboxField(note, path))
  );
}

function isSoapCheckboxPath(path: SoapEditablePath): path is SoapCheckboxFieldPath {
  return SOAP_CHECKBOX_PATHS.includes(path as SoapCheckboxFieldPath);
}

function isSoapArrayPath(path: SoapEditablePath): path is SoapArrayFieldPath {
  return SOAP_ARRAY_FIELD_PATHS.includes(path as SoapArrayFieldPath);
}

function isSupportedAudioFile(file: File) {
  if (file.type.startsWith("audio/")) return true;
  return /\.(aac|aiff|flac|m4a|mp3|mp4|ogg|wav|webm)$/i.test(file.name);
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
    SoapEditablePath[]
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
  const audioUploadInputRef = useRef<HTMLInputElement | null>(null);

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

  const resetEncounterCapture = () => {
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
  };

  // =========================
  // START RECORDING
  // =========================
  const startRecording = async () => {
    setError(null);

    if (!patient || !encounter) {
      setError("Please add a patient before starting recording.");
      return;
    }

    resetEncounterCapture();

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
  const processDiarizedTranscript = async (
    audioBlob: Blob,
    fileName = "encounter.wav",
    source: "recording" | "upload" = "recording"
  ) => {
    if (audioBlob.size === 0) return;

    setDiarizationStatus("processing");
    setDiarizationMessage(
      source === "upload"
        ? "Uploading audio and finalizing speaker-separated transcript..."
        : "Finalizing speaker-separated transcript..."
    );

    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, fileName || "encounter.wav");
      formData.append("numSpeakers", "2");

      const res = await fetch(DIARIZATION_API_URL, {
        method: "POST",
        body: formData,
      });

      const isJson = res.headers
        .get("content-type")
        ?.includes("application/json");
      const data = isJson
        ? await res.json()
        : { error: await res.text() };

      if (!res.ok) {
        if (res.status === 413) {
          throw new Error(
            "The recording is too large for the current diarization endpoint. Please use the Render diarization endpoint for longer recordings."
          );
        }

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

  const handleAudioFileSelected = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    if (!patient || !encounter) {
      setError("Please add a patient before uploading audio.");
      return;
    }

    if (isRecording) {
      setError("Stop the current recording before uploading audio.");
      return;
    }

    if (!isSupportedAudioFile(file)) {
      setError("Please upload a supported audio file.");
      return;
    }

    setError(null);
    resetEncounterCapture();
    void processDiarizedTranscript(file, file.name || "uploaded-audio", "upload");
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

      setSoapNote((prev) =>
        mergeGeneratedSoapNote(prev, data, editedSoapFields)
      );
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
    field: SoapFieldPath,
    value: string | string[]
  ) => {
    if (soapStatus === "final") return;

    setSoapNote((prev) => setSoapField(prev, field, value));
    setSoapStatus("draft");
    setEditStatus("unsaved");
    setEditedSoapFields((prev) =>
      prev.includes(field) ? prev : [...prev, field]
    );
  };

  const handleSOAPCheckboxChange = (
    field: SoapCheckboxFieldPath,
    value: boolean
  ) => {
    if (soapStatus === "final") return;

    setSoapNote((prev) => setSoapCheckboxField(prev, field, value));
    setSoapStatus("draft");
    setEditStatus("unsaved");
    setEditedSoapFields((prev) =>
      prev.includes(field) ? prev : [...prev, field]
    );
  };

  const handleSaveEdits = () => {
    const hasSoapText = soapHasText(soapNote);

    if (!hasSoapText || soapStatus === "final") return;

    setError(null);
    setEditStatus("saved");
  };

  const handleFinalizeSOAP = () => {
    const hasSoapText = soapHasText(soapNote);

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
  const hasSoapText = soapHasText(soapNote);
  const renderSoapInput = (
    label: string,
    path: SoapFieldPath,
    placeholder = ""
  ) => (
    <div className="space-y-1">
      <Label className={fieldLabelClassName}>
        {label}
      </Label>
      <Textarea
        className={`min-h-12 resize-y ${editableBoxClassName}`}
        value={getSoapField(soapNote, path)}
        onChange={(e) => handleSOAPFieldChange(path, e.target.value)}
        readOnly={soapStatus === "final"}
        placeholder={placeholder}
      />
    </div>
  );
  const renderSoapTextarea = (
    label: string,
    path: SoapFieldPath,
    placeholder = ""
  ) => (
    <div className="space-y-1">
      <Label className={fieldLabelClassName}>
        {label}
      </Label>
      <Textarea
        className={`min-h-24 resize-y ${editableBoxClassName}`}
        value={getSoapField(soapNote, path)}
        onChange={(e) => handleSOAPFieldChange(path, e.target.value)}
        readOnly={soapStatus === "final"}
        placeholder={placeholder}
      />
    </div>
  );
  const renderSoapCheckbox = (
    label: string,
    path: SoapCheckboxFieldPath
  ) => (
    <label className="flex min-h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-5 text-slate-800">
      <input
        type="checkbox"
        checked={getSoapCheckboxField(soapNote, path)}
        onChange={(e) => handleSOAPCheckboxChange(path, e.target.checked)}
        disabled={soapStatus === "final"}
        className="h-4 w-4 accent-teal-700"
      />
      <span>{label}</span>
    </label>
  );
  const renderSoapTemplateField = (
    field: SoapTemplateField,
    pathPrefix: string
  ) => {
    const path = `${pathPrefix}.${field.key}`;

    if (field.type === "group") {
      const hasCheckboxes = field.fields?.some((item) => item.type === "checkbox");

      return (
        <div key={path} className="space-y-3">
          <div className={groupTitleClassName}>
            {field.label}
          </div>
          <div
            className={
              hasCheckboxes
                ? "grid gap-3 lg:grid-cols-2"
                : "grid gap-3"
            }
          >
            {(field.fields || []).map((child) => {
              const shouldSpanFullRow = hasCheckboxes && child.type !== "checkbox";

              return (
                <div
                  key={`${path}.${child.key}`}
                  className={shouldSpanFullRow ? "lg:col-span-2" : ""}
                >
                  {renderSoapTemplateField(child, path)}
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    if (field.type === "checkbox") {
      return renderSoapCheckbox(field.label, path);
    }

    if (field.type === "text") {
      return renderSoapInput(field.label, path);
    }

    if (field.type === "array") {
      const values = getSoapArrayField(soapNote, path);

      return (
        <div className="space-y-2">
          <Label className={fieldLabelClassName}>
            {field.label}
          </Label>
          <Textarea
            className={`min-h-24 resize-y ${editableBoxClassName}`}
            value={arrayToNumberedText(values)}
            onChange={(event) =>
              handleSOAPFieldChange(path, numberedTextToArray(event.target.value))
            }
            readOnly={soapStatus === "final"}
            placeholder={`1. ${field.item?.label || field.label}`}
          />
        </div>
      );
    }

    return renderSoapTextarea(field.label, path);
  };

  return (
    <div className="min-h-screen bg-slate-100 p-4 text-slate-950 md:p-6">
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

      <header className="mb-4 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className={fieldLabelClassName}>
              E-Compounder
            </p>
            <h1 className={pageTitleClassName}>
              AI Scribe
            </h1>
            <p className={helperTextClassName}>
              Ambient clinical documentation workspace
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() => setPatientDialogOpen(true)}
              className="gap-2 rounded-md"
            >
              <UserPlus className="h-4 w-4" />
              {patient ? "Switch Patient" : "Add Patient"}
            </Button>

            <Badge variant={socketConnected ? "default" : "secondary"}>
              {socketConnected ? "Live" : "Offline"}
            </Badge>
          </div>
        </div>
      </header>

      {error && (
        <Alert className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {patient && encounter && (
        <Card className="mb-4 rounded-md border-slate-200 bg-white shadow-sm">
          <CardContent className="flex flex-col gap-4 py-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-slate-100 p-2">
                <User className="h-5 w-5 text-slate-600" />
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

      <input
        ref={audioUploadInputRef}
        type="file"
        accept="audio/*,.aac,.aiff,.flac,.m4a,.mp3,.mp4,.ogg,.wav,.webm"
        className="hidden"
        onChange={handleAudioFileSelected}
      />

      {/* ================= CAPTURE OPTIONS ================= */}
      <Card className="mb-4 overflow-hidden rounded-md border-slate-200 bg-white shadow-sm">
        <CardHeader className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className={panelTitleClassName}>
              Create a Compliant Note Automatically
            </CardTitle>
            <CardDescription className={helperTextClassName}>
              Choose how to capture the consultation
            </CardDescription>
          </div>

          <Badge
            variant={
              isRecording || diarizationStatus === "processing"
                ? "default"
                : "secondary"
            }
            className="w-fit"
          >
            {diarizationStatus === "processing"
              ? "Processing audio"
              : isRecording
              ? `Live • ${formatTime(recordingTime)}`
              : "Ready"}
          </Badge>
        </CardHeader>

        <CardContent className="bg-sky-50/80 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={
                isRecording ? stopRecording : startRecording
              }
              disabled={
                !isRecording &&
                (diarizationStatus === "processing" || loadingLLM)
              }
              className={`flex items-center rounded-md border bg-white p-4 text-left shadow-sm transition ${
                isRecording
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-slate-200 text-slate-900 hover:border-sky-200 hover:bg-sky-50"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <div
                className={`mr-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${
                  isRecording
                    ? "bg-red-100"
                    : "bg-sky-100 text-sky-700"
                }`}
              >
                {isRecording ? (
                  <Square className="h-5 w-5" />
                ) : (
                  <Mic className="h-5 w-5" />
                )}
              </div>
              <div>
                <div className={sectionTitleClassName}>
                  {isRecording ? "Stop recording" : "Record session"}
                </div>
                <div className={helperTextClassName}>
                  Live in-person capture
                </div>
              </div>
            </button>

            <button
              type="button"
              disabled={
                isRecording ||
                diarizationStatus === "processing" ||
                loadingLLM
              }
              onClick={() => audioUploadInputRef.current?.click()}
              className="flex items-center rounded-md border border-slate-200 bg-white p-4 text-left text-slate-900 shadow-sm transition hover:border-sky-200 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <div className="mr-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-sky-100 text-sky-700">
                <Upload className="h-5 w-5" />
              </div>
              <div>
                <div className={sectionTitleClassName}>Upload audio</div>
                <div className={helperTextClassName}>
                  Process a recorded file
                </div>
              </div>
            </button>
          </div>
        </CardContent>
      </Card>

      {/* ================= 2 COLUMN UI (RESTORED) ================= */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">

        {/* LEFT: TRANSCRIPT */}
        <Card className="overflow-hidden rounded-md border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-200 p-4">
            <CardTitle className={panelTitleClassName}>English Translation</CardTitle>
            <CardDescription className={helperTextClassName}>
              Live speech translated to English
            </CardDescription>
          </CardHeader>

          <CardContent className="bg-sky-50/80 p-3">
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
                <div className={helperTextClassName}>
                  Patient: {patient.fullName}
                </div>
              )}
            </div>
            {diarizationMessage && (
              <div className={`mb-3 ${helperTextClassName}`}>
                {diarizationMessage}
              </div>
            )}
            {speakerIds.length > 0 &&
              roleStatus !== "idle" &&
              roleStatus !== "confirmed" && (
                <div className="mb-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className={sectionTitleClassName}>
                        Confirm Speaker Roles
                      </div>
                      <div className={helperTextClassName}>
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
                        className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2"
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
              <div className="mb-3 flex items-center justify-between rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-700">
                <span>Speaker roles confirmed</span>
                <Badge variant="secondary">Doctor / Patient</Badge>
              </div>
            )}
            <Textarea
              className="h-[520px] resize-y border-slate-200 bg-white shadow-sm"
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
        <Card className="overflow-hidden rounded-md border-slate-200 bg-white shadow-sm">
          <CardHeader className="flex flex-col gap-4 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className={panelTitleClassName}>SOAP Note</CardTitle>
              <CardDescription className={helperTextClassName}>
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

          <CardContent className="bg-sky-50/80 p-3">
            <div className="h-[520px] overflow-y-auto rounded-md border border-slate-200 bg-white p-4 text-sm shadow-sm">
              <div className="space-y-4">
                {SOAP_TEMPLATE.sections.map((section) => (
                  <section
                    key={section.key}
                    className="space-y-4 rounded-md border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className={sectionTitleClassName}>
                      {section.title}
                    </div>
                    <div
                      className={
                        section.fields.every((field) => field.type === "text")
                          ? "grid gap-3 md:grid-cols-3"
                          : "space-y-4"
                      }
                    >
                      {section.fields.map((field) => (
                        <div key={`${section.key}.${field.key}`}>
                          {renderSoapTemplateField(field, section.key)}
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
