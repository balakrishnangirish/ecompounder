import primaryCareSoapTemplate from "@/lib/soap/templates/primary-care-soap.v1.json";

export type SoapProvider = "groq" | "medgemma";

export const SOAP_PROMPT_VERSION = "soap-json-v1";

type SoapTemplate = typeof primaryCareSoapTemplate;

type GenerateSoapOptions = {
  transcript: string;
  patient?: unknown;
  provider?: SoapProvider;
};

const GROQ_MODEL = process.env.SOAP_GROQ_MODEL || "llama-3.3-70b-versatile";
const MEDGEMMA_MODEL = process.env.SOAP_MEDGEMMA_MODEL || "google/medgemma-4b-it";
const activeSoapTemplate = primaryCareSoapTemplate as SoapTemplate;

export async function generateSoap({
  transcript,
  patient,
  provider = getConfiguredSoapProvider(),
}: GenerateSoapOptions) {
  if (provider === "medgemma") {
    return generateSoapWithMedGemma({ transcript, patient });
  }

  return generateSoapWithGroq({ transcript, patient });
}

export function getConfiguredSoapProvider(): SoapProvider {
  return process.env.SOAP_MODEL_PROVIDER?.toLowerCase() === "medgemma"
    ? "medgemma"
    : "groq";
}

export function getActiveSoapTemplate() {
  return activeSoapTemplate;
}

export function getActiveSoapTemplateMetadata() {
  return {
    templateKey: activeSoapTemplate.templateKey,
    templateName: activeSoapTemplate.name,
    templateVersion: activeSoapTemplate.version,
    promptVersion: SOAP_PROMPT_VERSION,
  };
}

async function generateSoapWithGroq({
  transcript,
  patient,
}: Required<Pick<GenerateSoapOptions, "transcript">> &
  Pick<GenerateSoapOptions, "patient">) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("Missing GROQ_API_KEY");
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
        model: GROQ_MODEL,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: buildSystemPrompt(),
          },
          {
            role: "user",
            content: buildUserPrompt(transcript, patient),
          },
        ],
      }),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "SOAP generation failed");
  }

  const content = data?.choices?.[0]?.message?.content || "";
  return normalizeSoapJson(extractJson(content), patient);
}

async function generateSoapWithMedGemma({
  transcript,
  patient,
}: Required<Pick<GenerateSoapOptions, "transcript">> &
  Pick<GenerateSoapOptions, "patient">) {
  if (!process.env.HF_TOKEN) {
    throw new Error("Missing HF_TOKEN");
  }

  const response = await fetch(
    `https://api-inference.huggingface.co/models/${MEDGEMMA_MODEL}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: `${buildSystemPrompt()}\n\n${buildUserPrompt(
          transcript,
          patient
        )}`,
        parameters: {
          max_new_tokens: 1400,
          temperature: 0.1,
          return_full_text: false,
        },
      }),
      signal: AbortSignal.timeout(60000),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || "MedGemma SOAP generation failed");
  }

  const content =
    data?.[0]?.generated_text ||
    data?.generated_text ||
    data?.[0]?.summary_text ||
    "";

  return normalizeSoapJson(extractJson(content), patient);
}

function buildSystemPrompt() {
  return `
You are a clinical documentation engine.

OUTPUT RULES (STRICT):
- Output ONLY valid JSON
- No markdown
- No commentary
- No extra text

Return EXACTLY this format:

${JSON.stringify(activeSoapTemplate.outputShape, null, 2)}

If a text field is unknown, use "".
If an array field has no supported items, use [].
For every checkbox field, use true only when explicitly supported by the transcript; otherwise use false.
Do not invent normal findings. Populate patientInformation from the patient metadata when available.
  `.trim();
}

function buildUserPrompt(transcript: string, patient: unknown) {
  return `PATIENT METADATA:\n${JSON.stringify(
    patient || {},
    null,
    2
  )}\n\nTRANSCRIPT:\n${transcript}\n\nReturn ONLY JSON.`;
}

function normalizeSoapJson(json: any, patient: unknown) {
  const normalized = coerceToTemplateShape(json, activeSoapTemplate.outputShape);
  const patientValue = patient as
    | { fullName?: string; dob?: string; dateOfBirth?: string }
    | undefined;

  if (
    normalized &&
    typeof normalized === "object" &&
    "patientInformation" in normalized
  ) {
    const soap = normalized as {
      patientInformation?: {
        patientName?: string;
        dateOfBirth?: string;
      };
    };

    soap.patientInformation = {
      ...soap.patientInformation,
      patientName:
        soap.patientInformation?.patientName || patientValue?.fullName || "",
      dateOfBirth:
        soap.patientInformation?.dateOfBirth ||
        patientValue?.dob ||
        patientValue?.dateOfBirth ||
        "",
    };
  }

  return normalized;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function arrayValue(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/\n|;/)
      .map((item) => item.replace(/^\s*\d+[\).:-]?\s*/, "").trim())
      .filter(Boolean);
  }

  return [];
}

function booleanValue(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return [
      "true",
      "yes",
      "y",
      "present",
      "positive",
      "checked",
      "1",
    ].includes(normalized);
  }

  return false;
}

function coerceToTemplateShape(value: unknown, shape: unknown): unknown {
  if (typeof shape === "string") return stringValue(value);
  if (typeof shape === "boolean") return booleanValue(value);
  if (Array.isArray(shape)) return arrayValue(value);

  if (!shape || typeof shape !== "object") return value ?? null;

  const source =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return Object.fromEntries(
    Object.entries(shape).map(([key, nestedShape]) => [
      key,
      coerceToTemplateShape(source[key], nestedShape),
    ])
  );
}

function extractJson(content: string) {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    }

    if (character === "}") {
      depth -= 1;

      if (depth === 0 && start !== -1) {
        candidates.push(content.slice(start, index + 1));
        start = -1;
      }
    }
  }

  for (const candidate of candidates.reverse()) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error("Model returned invalid SOAP JSON");
}
