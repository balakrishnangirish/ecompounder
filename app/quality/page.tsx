"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  ClipboardCheck,
  FileText,
  Languages,
  MessageSquareText,
  ShieldCheck,
  Tags,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getReviewCaseById, getReviewCases } from "@/lib/reviews/client";
import {
  reviewErrorTagLabels,
  severityLabels,
} from "@/lib/reviews/constants";
import {
  soapSectionOrder,
} from "@/lib/reviews/fixtures";
import type {
  ErrorSeverity,
  ReviewCase,
  ReviewCaseSummary,
  ReviewErrorTag,
} from "@/lib/reviews/types";

type QualityMetrics = {
  labeledCases: number;
  labeledTurns: number;
  transcriptCorrections: number;
  roleCorrections: number;
  soapSections: number;
  soapCorrections: number;
  criticalErrors: number;
  signableCases: number;
  translationAcceptRate: number;
  roleAccuracyRate: number;
  soapAcceptRate: number;
  criticalErrorRate: number;
  signableRate: number;
  severityRows: DistributionRowData[];
  tagRows: DistributionRowData[];
  languageRows: ModelQualityRow[];
  modelRows: ModelQualityRow[];
};

type DistributionRowData = {
  label: string;
  value: number;
  percent: number;
};

type ModelQualityRow = {
  label: string;
  cases: number;
  translationAcceptRate: number;
  roleAccuracyRate: number;
  soapAcceptRate: number;
  criticalErrors: number;
};

const severityOrder: ErrorSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "none",
];

export default function QualityPage() {
  const [summaries, setSummaries] = useState<ReviewCaseSummary[]>([]);
  const [reviewedCases, setReviewedCases] = useState<ReviewCase[]>([]);
  const [hasMounted, setHasMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    setHasMounted(true);

    async function loadQualityData() {
      const caseSummaries = await getReviewCases();
      const completedSummaries = caseSummaries.filter(
        (reviewCase) => reviewCase.status === "completed"
      );
      const completedCases = await Promise.all(
        completedSummaries.map((reviewCase) => getReviewCaseById(reviewCase.id))
      );

      setSummaries(caseSummaries);
      setReviewedCases(completedCases);
    }

    loadQualityData()
      .catch((error) =>
        setLoadError(
          error instanceof Error ? error.message : "Quality data failed to load"
        )
      )
      .finally(() => setIsLoading(false));
  }, []);

  const metrics = useMemo(
    () => buildQualityMetrics(reviewedCases),
    [reviewedCases]
  );

  if (!hasMounted) {
    return (
      <main
        suppressHydrationWarning
        className="min-h-screen bg-slate-50 text-slate-950"
      />
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 md:px-8">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-teal-700 text-white">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-normal text-slate-500">
                Model quality evaluation
              </p>
              <h1 className="text-2xl font-semibold tracking-normal">
                Quality Dashboard
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/reviews">
                <ClipboardCheck className="h-4 w-4" />
                Review Queue
              </Link>
            </Button>
          </div>
        </header>

        {loadError ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {loadError}
          </div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-4">
          <Metric
            icon={ClipboardCheck}
            label="Labeled cases"
            value={metrics.labeledCases}
            detail={`${summaries.length} total cases in queue`}
          />
          <Metric
            icon={MessageSquareText}
            label="Translation accept"
            value={`${metrics.translationAcceptRate}%`}
            detail={`${metrics.transcriptCorrections} corrected turns`}
          />
          <Metric
            icon={FileText}
            label="SOAP accept"
            value={`${metrics.soapAcceptRate}%`}
            detail={`${metrics.soapCorrections} corrected sections`}
          />
          <Metric
            icon={AlertTriangle}
            label="Critical errors"
            value={metrics.criticalErrors}
            detail={`${metrics.criticalErrorRate} per case`}
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <QualityPanel
            title="Translation And Speaker Quality"
            description="Turn-level clinician corrections to translated text and inferred speaker roles."
          >
            <RateRow
              label="Translation accept rate"
              value={metrics.translationAcceptRate}
              detail={`${metrics.labeledTurns} labeled turns`}
            />
            <RateRow
              label="Speaker role accuracy"
              value={metrics.roleAccuracyRate}
              detail={`${metrics.roleCorrections} role corrections`}
            />
          </QualityPanel>

          <QualityPanel
            title="SOAP Note Quality"
            description="Section-level edits and signability for generated SOAP notes."
          >
            <RateRow
              label="SOAP section accept rate"
              value={metrics.soapAcceptRate}
              detail={`${metrics.soapSections} reviewed sections`}
            />
            <RateRow
              label="Clinician signable rate"
              value={metrics.signableRate}
              detail={`${metrics.signableCases} signable cases`}
            />
          </QualityPanel>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <DistributionTable
            icon={ShieldCheck}
            title="Severity Distribution"
            description="All transcript, role, and SOAP issues grouped by clinician severity."
            rows={metrics.severityRows}
            isLoading={isLoading}
          />
          <DistributionTable
            icon={Tags}
            title="Error Taxonomy"
            description="Most common clinician-selected model error tags."
            rows={metrics.tagRows}
            isLoading={isLoading}
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <QualityBreakdownTable
            title="Quality By Language"
            description="Translation, speaker, and SOAP quality grouped by source language."
            rows={metrics.languageRows}
            isLoading={isLoading}
          />
          <QualityBreakdownTable
            title="Quality By Model"
            description="Model-path comparison from clinician-reviewed cases."
            rows={metrics.modelRows}
            isLoading={isLoading}
          />
        </section>
      </div>
    </main>
  );
}

function buildQualityMetrics(cases: ReviewCase[]): QualityMetrics {
  const labeledCases = cases.length;
  const labeledTurns = cases.reduce(
    (sum, reviewCase) => sum + reviewCase.transcript.length,
    0
  );
  const transcriptCorrections = cases.reduce(
    (sum, reviewCase) =>
      sum + reviewCase.transcript.filter(hasTranslationIssue).length,
    0
  );
  const roleCorrections = cases.reduce(
    (sum, reviewCase) =>
      sum +
      reviewCase.transcript.filter(
        (turn) => turn.reviewedRole !== turn.predictedRole
      ).length,
    0
  );
  const soapSections = cases.reduce(
    (sum, reviewCase) => sum + soapSectionOrder.length,
    0
  );
  const soapCorrections = cases.reduce(
    (sum, reviewCase) =>
      sum +
      soapSectionOrder.filter((sectionKey) =>
        hasSoapIssue(reviewCase.soap[sectionKey])
      ).length,
    0
  );
  const criticalErrors = cases.reduce(
    (sum, reviewCase) => sum + countSeverity(reviewCase, "critical"),
    0
  );
  const signableCases = cases.filter((reviewCase) => reviewCase.signable).length;
  return {
    labeledCases,
    labeledTurns,
    transcriptCorrections,
    roleCorrections,
    soapSections,
    soapCorrections,
    criticalErrors,
    signableCases,
    translationAcceptRate: rate(labeledTurns - transcriptCorrections, labeledTurns),
    roleAccuracyRate: rate(labeledTurns - roleCorrections, labeledTurns),
    soapAcceptRate: rate(soapSections - soapCorrections, soapSections),
    criticalErrorRate: labeledCases
      ? Number((criticalErrors / labeledCases).toFixed(1))
      : 0,
    signableRate: rate(signableCases, labeledCases),
    severityRows: buildSeverityRows(cases),
    tagRows: buildTagRows(cases),
    languageRows: buildQualityRows(
      cases,
      (reviewCase) => reviewCase.sourceLanguage || "Unknown"
    ),
    modelRows: buildQualityRows(cases, (reviewCase) => reviewCase.model),
  };
}

function buildSeverityRows(cases: ReviewCase[]) {
  const totalIssues = cases.reduce((sum, reviewCase) => {
    return (
      sum +
      reviewCase.transcript.filter((turn) => turn.severity !== "none").length +
      soapSectionOrder.filter(
        (sectionKey) => reviewCase.soap[sectionKey]?.severity !== "none"
      ).length
    );
  }, 0);

  return severityOrder
    .filter((severity) => severity !== "none")
    .map((severity) => {
      const value = cases.reduce(
        (sum, reviewCase) => sum + countSeverity(reviewCase, severity),
        0
      );

      return {
        label: severityLabels[severity],
        value,
        percent: rate(value, totalIssues),
      };
    });
}

function buildTagRows(cases: ReviewCase[]) {
  const tagCounts = new Map<ReviewErrorTag, number>();

  cases.forEach((reviewCase) => {
    reviewCase.transcript.forEach((turn) => {
      turn.errorTags.forEach((tag) => {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      });
    });

    soapSectionOrder.forEach((sectionKey) => {
      reviewCase.soap[sectionKey]?.errorTags.forEach((tag) => {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      });
    });
  });

  const totalTags = Array.from(tagCounts.values()).reduce(
    (sum, value) => sum + value,
    0
  );

  return Array.from(tagCounts.entries())
    .map(([tag, value]) => ({
      label: reviewErrorTagLabels[tag],
      value,
      percent: rate(value, totalTags),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}

function buildQualityRows(
  cases: ReviewCase[],
  getLabel: (reviewCase: ReviewCase) => string
) {
  const groups = new Map<string, ReviewCase[]>();

  cases.forEach((reviewCase) => {
    const label = getLabel(reviewCase);
    groups.set(label, [...(groups.get(label) || []), reviewCase]);
  });

  return Array.from(groups.entries())
    .map(([label, groupCases]) => {
      const groupMetrics = buildQualityMetricsWithoutBreakdowns(groupCases);

      return {
        label,
        cases: groupCases.length,
        translationAcceptRate: groupMetrics.translationAcceptRate,
        roleAccuracyRate: groupMetrics.roleAccuracyRate,
        soapAcceptRate: groupMetrics.soapAcceptRate,
        criticalErrors: groupMetrics.criticalErrors,
      };
    })
    .sort((a, b) => b.cases - a.cases);
}

function buildQualityMetricsWithoutBreakdowns(cases: ReviewCase[]) {
  const labeledTurns = cases.reduce(
    (sum, reviewCase) => sum + reviewCase.transcript.length,
    0
  );
  const transcriptCorrections = cases.reduce(
    (sum, reviewCase) =>
      sum + reviewCase.transcript.filter(hasTranslationIssue).length,
    0
  );
  const roleCorrections = cases.reduce(
    (sum, reviewCase) =>
      sum +
      reviewCase.transcript.filter(
        (turn) => turn.reviewedRole !== turn.predictedRole
      ).length,
    0
  );
  const soapSections = cases.reduce(
    (sum) => sum + soapSectionOrder.length,
    0
  );
  const soapCorrections = cases.reduce(
    (sum, reviewCase) =>
      sum +
      soapSectionOrder.filter((sectionKey) =>
        hasSoapIssue(reviewCase.soap[sectionKey])
      ).length,
    0
  );
  const criticalErrors = cases.reduce(
    (sum, reviewCase) => sum + countSeverity(reviewCase, "critical"),
    0
  );

  return {
    translationAcceptRate: rate(labeledTurns - transcriptCorrections, labeledTurns),
    roleAccuracyRate: rate(labeledTurns - roleCorrections, labeledTurns),
    soapAcceptRate: rate(soapSections - soapCorrections, soapSections),
    criticalErrors,
  };
}

function hasTranslationIssue(turn: ReviewCase["transcript"][number]) {
  const corrected = turn.correctedTranslation?.trim();

  return Boolean(
    corrected ||
      turn.errorTags.length > 0 ||
      (turn.severity && turn.severity !== "none")
  );
}

function hasSoapIssue(section?: ReviewCase["soap"][string]) {
  if (!section) return false;

  const reviewedText = section.reviewedText?.trim();

  return Boolean(
    reviewedText ||
      section.errorTags.length > 0 ||
      (section.severity && section.severity !== "none")
  );
}

function countSeverity(reviewCase: ReviewCase, severity: ErrorSeverity) {
  return (
    reviewCase.transcript.filter((turn) => turn.severity === severity).length +
    soapSectionOrder.filter(
      (sectionKey) => reviewCase.soap[sectionKey]?.severity === severity
    ).length
  );
}

function rate(numerator: number, denominator: number) {
  return denominator ? Math.round((numerator / denominator) * 100) : 0;
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof BarChart3;
  label: string;
  value: number | string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-slate-500">{label}</div>
        <Icon className="h-4 w-4 text-teal-700" />
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{detail}</div>
    </div>
  );
}

function QualityPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="mb-4">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-slate-500">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function RateRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-slate-500">
          {value}% · {detail}
        </span>
      </div>
      <Progress value={value} className="h-2 bg-slate-100" />
    </div>
  );
}

function DistributionTable({
  icon: Icon,
  title,
  description,
  rows,
  isLoading,
}: {
  icon: typeof BarChart3;
  title: string;
  description: string;
  rows: DistributionRowData[];
  isLoading: boolean;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <div className="flex items-start gap-3 border-b border-slate-200 p-4">
        <Icon className="mt-0.5 h-4 w-4 text-teal-700" />
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-sm text-slate-500">{description}</p>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Signal</TableHead>
            <TableHead>Count</TableHead>
            <TableHead>Share</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <EmptyRow colSpan={3} label="Loading quality labels..." />
          ) : rows.length === 0 ? (
            <EmptyRow colSpan={3} label="No completed review labels yet." />
          ) : (
            rows.map((row) => (
              <TableRow key={row.label}>
                <TableCell className="font-medium">{row.label}</TableCell>
                <TableCell>{row.value}</TableCell>
                <TableCell>
                  <Badge variant="outline">{row.percent}%</Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function QualityBreakdownTable({
  title,
  description,
  rows,
  isLoading,
}: {
  title: string;
  description: string;
  rows: ModelQualityRow[];
  isLoading: boolean;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-4">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-slate-500">{description}</p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Group</TableHead>
            <TableHead>Cases</TableHead>
            <TableHead>Translation</TableHead>
            <TableHead>Roles</TableHead>
            <TableHead>SOAP</TableHead>
            <TableHead>Critical</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <EmptyRow colSpan={6} label="Loading model quality..." />
          ) : rows.length === 0 ? (
            <EmptyRow colSpan={6} label="Complete reviews to populate model metrics." />
          ) : (
            rows.map((row) => (
              <TableRow key={row.label}>
                <TableCell className="max-w-[220px] font-medium">
                  <span className="line-clamp-2">{row.label}</span>
                </TableCell>
                <TableCell>{row.cases}</TableCell>
                <TableCell>{row.translationAcceptRate}%</TableCell>
                <TableCell>{row.roleAccuracyRate}%</TableCell>
                <TableCell>{row.soapAcceptRate}%</TableCell>
                <TableCell>{row.criticalErrors}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="h-20 text-center text-slate-500">
        {label}
      </TableCell>
    </TableRow>
  );
}
