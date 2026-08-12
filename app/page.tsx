import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FileText,
  Languages,
  Mic,
  BarChart3,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const workflow = [
  {
    icon: Mic,
    title: "Capture",
    copy: "Live consultation audio streams into English translation.",
  },
  {
    icon: Languages,
    title: "Separate",
    copy: "Post-recording diarization labels speaker turns for review.",
  },
  {
    icon: FileText,
    title: "Document",
    copy: "Editable SOAP notes stay in draft until the clinician finalizes.",
  },
];

const checks = [
  "Live translation bridge",
  "Shared patient intake",
  "Doctor and patient role confirmation",
  "Editable SOAP draft workflow",
];

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="relative min-h-[88vh] overflow-hidden">
        <Image
          src="/clinical-scribe-hero.png"
          alt="Modern clinical consultation workspace"
          fill
          priority
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-slate-950/45" />

        <div className="relative mx-auto flex min-h-[88vh] max-w-7xl flex-col px-6 py-6 md:px-10">
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-white">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-white/15 ring-1 ring-white/25">
                <Stethoscope className="h-5 w-5" />
              </div>
              <span className="text-base font-semibold tracking-normal">
                E-Compounder
              </span>
            </div>

            <Button asChild variant="secondary">
              <Link href="/scribe">
                Open Scribe
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </header>

          <div className="flex flex-1 items-center py-12">
            <div className="max-w-2xl text-white">
              <Badge className="mb-5 bg-white text-slate-900 hover:bg-white">
                AI clinical documentation
              </Badge>

              <h1 className="text-4xl font-semibold leading-tight tracking-normal md:text-6xl">
                E-Compounder AI Scribe
              </h1>

              <p className="mt-5 max-w-xl text-base leading-7 text-slate-100 md:text-lg">
                Turn multilingual consultations into structured, editable
                clinical notes with live translation, speaker review, and a
                controlled SOAP finalization workflow.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="h-11">
                  <Link href="/scribe">
                    Start Scribing
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>

                <Button
                  asChild
                  size="lg"
                  variant="secondary"
                  className="h-11"
                >
                  <Link href="/intake">
                    <ClipboardList className="h-4 w-4" />
                    Intake
                  </Link>
                </Button>

                <Button
                  asChild
                  size="lg"
                  variant="secondary"
                  className="h-11"
                >
                  <Link href="/reviews">Review Queue</Link>
                </Button>

                <Button
                  asChild
                  size="lg"
                  variant="secondary"
                  className="h-11"
                >
                  <Link href="/quality">
                    <BarChart3 className="h-4 w-4" />
                    Quality
                  </Link>
                </Button>

              </div>
            </div>
          </div>

          <div className="grid gap-3 pb-4 md:grid-cols-4">
            {checks.map((item) => (
              <div
                key={item}
                className="flex items-center gap-2 rounded-md bg-white/90 px-3 py-2 text-sm text-slate-800 shadow-sm"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-4 px-6 py-8 md:grid-cols-3 md:px-10">
        {workflow.map((item) => {
          const Icon = item.icon;

          return (
            <div
              key={item.title}
              className="rounded-md border border-slate-200 bg-white p-5"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-teal-50 text-teal-700">
                <Icon className="h-5 w-5" />
              </div>
              <h2 className="text-base font-semibold text-slate-950">
                {item.title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {item.copy}
              </p>
            </div>
          );
        })}

        <div className="rounded-md border border-slate-200 bg-slate-900 p-5 text-white">
          <ShieldCheck className="mb-4 h-6 w-6 text-emerald-300" />
          <h2 className="text-base font-semibold">Clinician controlled</h2>
          <p className="mt-2 text-sm leading-6 text-slate-200">
            Drafts remain editable, role labels require confirmation, and SOAP
            notes lock only when finalized.
          </p>
        </div>
      </div>
    </main>
  );
}
