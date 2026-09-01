import { InstanceProvider } from "@/components/instance/instance-context";
import { InstanceShell } from "@/components/instance/instance-shell";
import { instanceRoleOf } from "@/lib/members";
import { loadInstanceDetail } from "@/lib/wardend";

export default async function InstanceLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  const [detail, role] = await Promise.all([loadInstanceDetail(id), instanceRoleOf(id)]);
  return (
    <InstanceProvider initial={detail} role={role}>
      <InstanceShell>{children}</InstanceShell>
    </InstanceProvider>
  );
}
