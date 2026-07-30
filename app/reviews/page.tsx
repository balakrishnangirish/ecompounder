"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ClipboardCheck,
  Search,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getReviewCases } from "@/lib/reviews/client";
import {
  countReviewStatuses,
  reviewStatusBadgeClassName,
  reviewStatusLabel,
  soapReviewStatuses,
  transcriptReviewStatuses,
} from "@/lib/reviews/status";
import type { ReviewCaseSummary, ReviewStatus } from "@/lib/reviews/types";

const pageTitleClassName = "text-[22px] font-semibold leading-7 tracking-normal";
const panelTitleClassName = "text-[17px] font-semibold leading-6 text-slate-900";
const fieldLabelClassName = "text-[13px] font-medium leading-5 text-slate-500";

export default function ReviewsPage() {
  const [cases, setCases] = useState<ReviewCaseSummary[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getReviewCases()
      .then(setCases)
      .finally(() => setIsLoading(false));
  }, []);

  const filteredCases = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return cases.filter((reviewCase) => {
      const matchesQuery =
        !normalizedQuery ||
        reviewCase.id.toLowerCase().includes(normalizedQuery) ||
        reviewCase.audioFileName.toLowerCase().includes(normalizedQuery) ||
        reviewCase.sourceLanguage?.toLowerCase().includes(normalizedQuery);

      return matchesQuery;
    });
  }, [cases, query]);

  const transcriptStatusCounts = useMemo(
    () => countReviewStatuses(cases, "transcriptReviewStatus"),
    [cases]
  );
  const soapStatusCounts = useMemo(
    () => countReviewStatuses(cases, "soapReviewStatus"),
    [cases]
  );

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 md:px-8">
        <header className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-950 text-white">
              <ClipboardCheck className="h-5 w-5" />
            </div>
            <div>
              <p className={fieldLabelClassName}>
                AI quality evaluation
              </p>
              <h1 className={pageTitleClassName}>
                Clinician Review Queue
              </h1>
            </div>
          </div>
        </header>

        <div className="grid gap-3 lg:grid-cols-2">
          <ReviewStatusSummary
            title="Transcript Review"
            counts={transcriptStatusCounts}
            statuses={transcriptReviewStatuses}
          />
          <ReviewStatusSummary
            title="SOAP Review"
            counts={soapStatusCounts}
            statuses={soapReviewStatuses}
          />
        </div>

        <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 bg-white p-4 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search case"
                className="h-10 max-w-md rounded-md border-slate-200 bg-slate-50"
              />
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Case</TableHead>
                <TableHead>Transcript Review</TableHead>
                <TableHead>SOAP Review</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center">
                    Loading review cases...
                  </TableCell>
                </TableRow>
              ) : filteredCases.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center">
                    No review cases match the current search.
                  </TableCell>
                </TableRow>
              ) : (
                filteredCases.map((reviewCase) => (
                  <TableRow key={reviewCase.id} className="hover:bg-slate-50">
                    <TableCell>
                      <div className="font-medium">{reviewCase.id}</div>
                    </TableCell>
                    <TableCell>
                      <ReviewStatusBadge status={reviewCase.transcriptReviewStatus} />
                    </TableCell>
                    <TableCell>
                      <ReviewStatusBadge status={reviewCase.soapReviewStatus} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline" className="rounded-md">
                        <Link href={`/reviews/${reviewCase.id}`}>
                          Review
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </main>
  );
}

function ReviewStatusSummary({
  title,
  counts,
  statuses,
}: {
  title: string;
  counts: Record<ReviewStatus, number>;
  statuses: ReviewStatus[];
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`mb-3 ${panelTitleClassName}`}>{title}</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {statuses.map((status) => (
          <div
            key={status}
            className="rounded-md bg-slate-100/70 px-3 py-2"
          >
            <div className={fieldLabelClassName}>
              {reviewStatusLabel(status)}
            </div>
            <div className="mt-1 text-xl font-semibold text-slate-950">
              {counts[status]}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  return (
    <Badge variant="outline" className={reviewStatusBadgeClassName(status)}>
      {reviewStatusLabel(status)}
    </Badge>
  );
}
