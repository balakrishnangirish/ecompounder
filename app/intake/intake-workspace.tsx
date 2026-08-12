"use client";

import Link from "next/link";
import type React from "react";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  ClipboardList,
  Copy,
  HeartPulse,
  Mail,
  Phone,
  ShieldCheck,
  Stethoscope,
  UserRound,
  UsersRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type IntakeMode = "internal" | "patient";
type InternalPersona = "assistant" | "doctor";
type SectionKey = "demographics" | "insurance" | "consent" | "history";

type IntakeForm = {
  demographics: {
    fullName: string;
    dateOfBirth: string;
    sexAtBirth: string;
    phone: string;
    email: string;
    address: string;
    emergencyContact: string;
    preferredLanguage: string;
  };
  insurance: {
    provider: string;
    memberId: string;
    groupNumber: string;
    policyHolder: string;
    relationship: string;
    pharmacy: string;
  };
  consent: {
    treatment: boolean;
    telehealth: boolean;
    smsEmail: boolean;
    privacy: boolean;
    signature: string;
  };
  history: {
    chiefConcern: string;
    medications: string;
    allergies: string;
    conditions: string[];
    surgeries: string;
    familyHistory: string;
    socialHistory: string;
  };
};

const EMPTY_FORM: IntakeForm = {
  demographics: {
    fullName: "",
    dateOfBirth: "",
    sexAtBirth: "",
    phone: "",
    email: "",
    address: "",
    emergencyContact: "",
    preferredLanguage: "",
  },
  insurance: {
    provider: "",
    memberId: "",
    groupNumber: "",
    policyHolder: "",
    relationship: "",
    pharmacy: "",
  },
  consent: {
    treatment: false,
    telehealth: false,
    smsEmail: false,
    privacy: false,
    signature: "",
  },
  history: {
    chiefConcern: "",
    medications: "",
    allergies: "",
    conditions: [],
    surgeries: "",
    familyHistory: "",
    socialHistory: "",
  },
};

const sections: Array<{ key: SectionKey; title: string; icon: typeof UserRound }> = [
  { key: "demographics", title: "Demographic", icon: UserRound },
  { key: "insurance", title: "Insurance", icon: ShieldCheck },
  { key: "consent", title: "Consent", icon: ClipboardList },
  { key: "history", title: "Past History", icon: HeartPulse },
];

const conditions = [
  "Hypertension",
  "Diabetes",
  "Asthma/COPD",
  "Heart disease",
  "Stroke",
  "Kidney disease",
  "Liver disease",
  "Thyroid disease",
  "Tuberculosis",
];

export function IntakeWorkspace({
  mode,
  token,
}: {
  mode: IntakeMode;
  token?: string;
}) {
  const [persona, setPersona] = useState<InternalPersona>("assistant");
  const [activeSection, setActiveSection] = useState<SectionKey>("demographics");
  const [form, setForm] = useState<IntakeForm>(EMPTY_FORM);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [shareChannel, setShareChannel] = useState<"sms" | "email">("sms");

  const isPatientMode = mode === "patient";
  const completion = useMemo(() => getCompletion(form), [form]);
  const shareToken = useMemo(
    () => token || createShareToken(form.demographics.fullName || "patient"),
    [form.demographics.fullName, token]
  );
  const shareLink = `/intake/patient/${shareToken}`;

  const updateSection = <K extends SectionKey>(
    section: K,
    field: keyof IntakeForm[K],
    value: IntakeForm[K][keyof IntakeForm[K]]
  ) => {
    setForm((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [field]: value,
      },
    }));
  };

  const toggleCondition = (condition: string) => {
    setForm((current) => {
      const currentConditions = current.history.conditions;
      const nextConditions = currentConditions.includes(condition)
        ? currentConditions.filter((item) => item !== condition)
        : [...currentConditions, condition];

      return {
        ...current,
        history: {
          ...current.history,
          conditions: nextConditions,
        },
      };
    });
  };

  const saveDraft = () => {
    setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  };

  const copyShareLink = async () => {
    if (typeof window === "undefined" || !navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(`${window.location.origin}${shareLink}`);
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 md:px-8">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-teal-700 text-white">
              {isPatientMode ? (
                <UserRound className="h-5 w-5" />
              ) : (
                <ClipboardList className="h-5 w-5" />
              )}
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-normal text-slate-500">
                Patient intake
              </p>
              <h1 className="text-2xl font-semibold tracking-normal">
                {isPatientMode ? "Complete Intake Form" : "Intake Workbench"}
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!isPatientMode && (
              <>
                <Button
                  type="button"
                  variant={persona === "assistant" ? "default" : "outline"}
                  onClick={() => setPersona("assistant")}
                >
                  <UsersRound className="h-4 w-4" />
                  Staff
                </Button>
                <Button
                  type="button"
                  variant={persona === "doctor" ? "default" : "outline"}
                  onClick={() => setPersona("doctor")}
                >
                  <Stethoscope className="h-4 w-4" />
                  Doctor
                </Button>
                <Button asChild variant="outline">
                  <Link href="/scribe">Scribe</Link>
                </Button>
              </>
            )}
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[280px_1fr_320px]">
          <aside className="space-y-3">
            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle>Sections</CardTitle>
                <CardDescription>
                  {completion.completed} of {sections.length} complete
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="h-2 rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-teal-700"
                    style={{ width: `${completion.percent}%` }}
                  />
                </div>
                <div className="space-y-1 pt-2">
                  {sections.map((section) => {
                    const Icon = section.icon;
                    const complete = completion.bySection[section.key];

                    return (
                      <button
                        key={section.key}
                        type="button"
                        onClick={() => setActiveSection(section.key)}
                        className={`flex h-10 w-full items-center justify-between rounded-md border px-3 text-left text-sm transition ${
                          activeSection === section.key
                            ? "border-teal-200 bg-teal-50 text-teal-800"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{section.title}</span>
                        </span>
                        {complete && <Check className="h-4 w-4 text-teal-700" />}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {!isPatientMode && (
              <Card className="border-slate-200 bg-white">
                <CardHeader>
                  <CardTitle>Share Link</CardTitle>
                  <CardDescription>
                    Send the same form to the patient.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={shareChannel === "sms" ? "default" : "outline"}
                      onClick={() => setShareChannel("sms")}
                    >
                      <Phone className="h-4 w-4" />
                      SMS
                    </Button>
                    <Button
                      type="button"
                      variant={shareChannel === "email" ? "default" : "outline"}
                      onClick={() => setShareChannel("email")}
                    >
                      <Mail className="h-4 w-4" />
                      Email
                    </Button>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                    {shareLink}
                  </div>
                  <Button type="button" variant="outline" onClick={copyShareLink} className="w-full">
                    <Copy className="h-4 w-4" />
                    Copy Link
                  </Button>
                </CardContent>
              </Card>
            )}
          </aside>

          <Card className="border-slate-200 bg-white">
            <CardHeader className="border-b border-slate-200">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <CardTitle>{sectionTitle(activeSection)}</CardTitle>
                  <CardDescription>
                    {isPatientMode
                      ? "Fill in what you know. The care team can review the rest."
                      : persona === "assistant"
                      ? "Capture registration-ready details before the consultation."
                      : "Review or complete clinical context during the visit."}
                  </CardDescription>
                </div>
                <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-700">
                  {isPatientMode ? "Patient" : persona === "assistant" ? "Staff" : "Doctor"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 pt-4">
              {activeSection === "demographics" && (
                <DemographicsSection form={form} updateSection={updateSection} />
              )}
              {activeSection === "insurance" && (
                <InsuranceSection form={form} updateSection={updateSection} />
              )}
              {activeSection === "consent" && (
                <ConsentSection form={form} updateSection={updateSection} />
              )}
              {activeSection === "history" && (
                <HistorySection
                  form={form}
                  updateSection={updateSection}
                  toggleCondition={toggleCondition}
                />
              )}
            </CardContent>
          </Card>

          <aside className="space-y-3">
            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle>Patient Summary</CardTitle>
                <CardDescription>Ready for encounter handoff</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <SummaryLine label="Name" value={form.demographics.fullName} />
                <SummaryLine label="DOB" value={form.demographics.dateOfBirth} />
                <SummaryLine label="Phone" value={form.demographics.phone} />
                <SummaryLine label="Language" value={form.demographics.preferredLanguage} />
                <SummaryLine label="Insurance" value={form.insurance.provider} />
                <SummaryLine label="Concern" value={form.history.chiefConcern} />
                {savedAt && (
                  <div className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-teal-800">
                    Saved at {savedAt}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-slate-200 bg-white">
              <CardHeader>
                <CardTitle>Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button type="button" onClick={saveDraft} className="w-full">
                  <Check className="h-4 w-4" />
                  {isPatientMode ? "Submit Intake" : "Save Intake"}
                </Button>
                {!isPatientMode && (
                  <>
                    <Button asChild type="button" variant="outline" className="w-full">
                      <Link href="/scribe">
                        Start Encounter
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button asChild type="button" variant="outline" className="w-full">
                      <Link href="/reviews">Review Queue</Link>
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </aside>
        </section>
      </div>
    </main>
  );
}

function DemographicsSection({
  form,
  updateSection,
}: {
  form: IntakeForm;
  updateSection: <K extends SectionKey>(
    section: K,
    field: keyof IntakeForm[K],
    value: IntakeForm[K][keyof IntakeForm[K]]
  ) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Full Name" id="full-name">
        <Input
          id="full-name"
          value={form.demographics.fullName}
          onChange={(event) => updateSection("demographics", "fullName", event.target.value)}
          placeholder="Jane Doe"
        />
      </Field>
      <Field label="Date of Birth" id="dob">
        <Input
          id="dob"
          type="date"
          value={form.demographics.dateOfBirth}
          onChange={(event) => updateSection("demographics", "dateOfBirth", event.target.value)}
        />
      </Field>
      <Field label="Sex at Birth" id="sex">
        <select
          id="sex"
          value={form.demographics.sexAtBirth}
          onChange={(event) => updateSection("demographics", "sexAtBirth", event.target.value)}
          className="h-8 w-full rounded-lg border border-input bg-white px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">Select</option>
          <option>Female</option>
          <option>Male</option>
          <option>Intersex</option>
          <option>Prefer not to say</option>
        </select>
      </Field>
      <Field label="Preferred Language" id="language">
        <Input
          id="language"
          value={form.demographics.preferredLanguage}
          onChange={(event) => updateSection("demographics", "preferredLanguage", event.target.value)}
          placeholder="English, Hindi, Tamil..."
        />
      </Field>
      <Field label="Phone" id="phone">
        <Input
          id="phone"
          value={form.demographics.phone}
          onChange={(event) => updateSection("demographics", "phone", event.target.value)}
          placeholder="+1..."
        />
      </Field>
      <Field label="Email" id="email">
        <Input
          id="email"
          type="email"
          value={form.demographics.email}
          onChange={(event) => updateSection("demographics", "email", event.target.value)}
          placeholder="patient@example.com"
        />
      </Field>
      <Field label="Address" id="address" className="md:col-span-2">
        <Textarea
          id="address"
          value={form.demographics.address}
          onChange={(event) => updateSection("demographics", "address", event.target.value)}
          placeholder="Street, city, state, postal code"
        />
      </Field>
      <Field label="Emergency Contact" id="emergency" className="md:col-span-2">
        <Input
          id="emergency"
          value={form.demographics.emergencyContact}
          onChange={(event) => updateSection("demographics", "emergencyContact", event.target.value)}
          placeholder="Name, relationship, phone"
        />
      </Field>
    </div>
  );
}

function InsuranceSection({
  form,
  updateSection,
}: {
  form: IntakeForm;
  updateSection: <K extends SectionKey>(
    section: K,
    field: keyof IntakeForm[K],
    value: IntakeForm[K][keyof IntakeForm[K]]
  ) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Insurance Provider" id="provider">
        <Input
          id="provider"
          value={form.insurance.provider}
          onChange={(event) => updateSection("insurance", "provider", event.target.value)}
          placeholder="Provider name"
        />
      </Field>
      <Field label="Member ID" id="member-id">
        <Input
          id="member-id"
          value={form.insurance.memberId}
          onChange={(event) => updateSection("insurance", "memberId", event.target.value)}
          placeholder="Policy or member number"
        />
      </Field>
      <Field label="Group Number" id="group-number">
        <Input
          id="group-number"
          value={form.insurance.groupNumber}
          onChange={(event) => updateSection("insurance", "groupNumber", event.target.value)}
          placeholder="Optional"
        />
      </Field>
      <Field label="Policy Holder" id="policy-holder">
        <Input
          id="policy-holder"
          value={form.insurance.policyHolder}
          onChange={(event) => updateSection("insurance", "policyHolder", event.target.value)}
          placeholder="Self, parent, spouse..."
        />
      </Field>
      <Field label="Relationship to Patient" id="relationship">
        <Input
          id="relationship"
          value={form.insurance.relationship}
          onChange={(event) => updateSection("insurance", "relationship", event.target.value)}
          placeholder="Self"
        />
      </Field>
      <Field label="Preferred Pharmacy" id="pharmacy">
        <Input
          id="pharmacy"
          value={form.insurance.pharmacy}
          onChange={(event) => updateSection("insurance", "pharmacy", event.target.value)}
          placeholder="Pharmacy name and location"
        />
      </Field>
    </div>
  );
}

function ConsentSection({
  form,
  updateSection,
}: {
  form: IntakeForm;
  updateSection: <K extends SectionKey>(
    section: K,
    field: keyof IntakeForm[K],
    value: IntakeForm[K][keyof IntakeForm[K]]
  ) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <ConsentCheck
          label="Consent to treatment"
          checked={form.consent.treatment}
          onChange={(checked) => updateSection("consent", "treatment", checked)}
        />
        <ConsentCheck
          label="Consent to telehealth"
          checked={form.consent.telehealth}
          onChange={(checked) => updateSection("consent", "telehealth", checked)}
        />
        <ConsentCheck
          label="SMS/email communication allowed"
          checked={form.consent.smsEmail}
          onChange={(checked) => updateSection("consent", "smsEmail", checked)}
        />
        <ConsentCheck
          label="Privacy notice acknowledged"
          checked={form.consent.privacy}
          onChange={(checked) => updateSection("consent", "privacy", checked)}
        />
      </div>
      <Field label="Signature" id="signature">
        <Input
          id="signature"
          value={form.consent.signature}
          onChange={(event) => updateSection("consent", "signature", event.target.value)}
          placeholder="Type full legal name"
        />
      </Field>
    </div>
  );
}

function HistorySection({
  form,
  updateSection,
  toggleCondition,
}: {
  form: IntakeForm;
  updateSection: <K extends SectionKey>(
    section: K,
    field: keyof IntakeForm[K],
    value: IntakeForm[K][keyof IntakeForm[K]]
  ) => void;
  toggleCondition: (condition: string) => void;
}) {
  return (
    <div className="space-y-4">
      <Field label="Chief Concern" id="chief-concern">
        <Textarea
          id="chief-concern"
          value={form.history.chiefConcern}
          onChange={(event) => updateSection("history", "chiefConcern", event.target.value)}
          placeholder="What brings the patient in today?"
        />
      </Field>
      <div>
        <Label>Past Conditions</Label>
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          {conditions.map((condition) => (
            <label
              key={condition}
              className="flex min-h-10 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
            >
              <input
                type="checkbox"
                checked={form.history.conditions.includes(condition)}
                onChange={() => toggleCondition(condition)}
                className="h-4 w-4"
              />
              <span>{condition}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Current Medications" id="medications">
          <Textarea
            id="medications"
            value={form.history.medications}
            onChange={(event) => updateSection("history", "medications", event.target.value)}
            placeholder="Medication, dose, frequency"
          />
        </Field>
        <Field label="Allergies" id="allergies">
          <Textarea
            id="allergies"
            value={form.history.allergies}
            onChange={(event) => updateSection("history", "allergies", event.target.value)}
            placeholder="Drug, food, environmental allergies"
          />
        </Field>
        <Field label="Surgeries or Hospitalizations" id="surgeries">
          <Textarea
            id="surgeries"
            value={form.history.surgeries}
            onChange={(event) => updateSection("history", "surgeries", event.target.value)}
            placeholder="Include dates if known"
          />
        </Field>
        <Field label="Family History" id="family-history">
          <Textarea
            id="family-history"
            value={form.history.familyHistory}
            onChange={(event) => updateSection("history", "familyHistory", event.target.value)}
            placeholder="Relevant family medical history"
          />
        </Field>
        <Field label="Social History" id="social-history" className="md:col-span-2">
          <Textarea
            id="social-history"
            value={form.history.socialHistory}
            onChange={(event) => updateSection("history", "socialHistory", event.target.value)}
            placeholder="Smoking, alcohol, work, home context"
          />
        </Field>
      </div>
    </div>
  );
}

function Field({
  label,
  id,
  className,
  children,
}: {
  label: string;
  id: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-2 ${className || ""}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function ConsentCheck({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4"
      />
      <span>{label}</span>
    </label>
  );
}

function SummaryLine({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="max-w-40 text-right font-medium text-slate-900">
        {value || "Not added"}
      </span>
    </div>
  );
}

function getCompletion(form: IntakeForm) {
  const bySection: Record<SectionKey, boolean> = {
    demographics:
      Boolean(form.demographics.fullName) &&
      Boolean(form.demographics.dateOfBirth) &&
      Boolean(form.demographics.phone || form.demographics.email),
    insurance:
      Boolean(form.insurance.provider) &&
      Boolean(form.insurance.memberId || form.insurance.policyHolder),
    consent:
      form.consent.treatment &&
      form.consent.privacy &&
      Boolean(form.consent.signature),
    history:
      Boolean(form.history.chiefConcern) ||
      Boolean(form.history.medications) ||
      Boolean(form.history.allergies) ||
      form.history.conditions.length > 0,
  };
  const completed = Object.values(bySection).filter(Boolean).length;

  return {
    bySection,
    completed,
    percent: Math.round((completed / sections.length) * 100),
  };
}

function createShareToken(seed: string) {
  return seed
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || "new-patient";
}

function sectionTitle(section: SectionKey) {
  return sections.find((item) => item.key === section)?.title || "Intake";
}
