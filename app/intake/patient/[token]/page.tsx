import { IntakeWorkspace } from "../../intake-workspace";

export default async function PatientIntakePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return <IntakeWorkspace mode="patient" token={token} />;
}
