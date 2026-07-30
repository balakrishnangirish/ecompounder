import Link from "next/link";

import { Button } from "@/components/ui/button";

export default async function ReviewCasePage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 md:px-8">
        <div className="rounded-md border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-normal text-slate-500">
            Review case
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">
            {caseId}
          </h1>
          <p className="mt-3 text-sm text-slate-600">
            The detailed clinician workbench for this case is not part of this
            queue commit yet.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/reviews">Back to Queue</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
