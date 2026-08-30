import { InstanceProvider } from "@/components/instance/instance-context";
import { InstanceShell } from "@/components/instance/instance-shell";
import { getSession } from "@/lib/session";
import { loadInstanceDetail } from "@/lib/wardend";

export default async function InstanceLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  const [detail, session] = await Promise.all([loadInstanceDetail(id), getSession()]);
  return (
    <InstanceProvider initial={detail} isAdmin={session?.user.role === "admin"}>
      <InstanceShell>{children}</InstanceShell>
    </InstanceProvider>
  );
}
