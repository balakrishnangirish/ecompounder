import { ReviewWorkbench } from "./review-workbench";

export default async function ReviewCasePage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;

  return <ReviewWorkbench caseId={caseId} />;
}
