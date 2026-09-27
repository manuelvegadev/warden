import { DashboardLayoutProvider } from "@/components/dashboard/layout-context";
import { InstanceProvider } from "@/components/instance/instance-context";
import { InstanceShell } from "@/components/instance/instance-shell";
import { defaultLayout } from "@/lib/dashboard-layout";
import { getLayout } from "@/lib/dashboard-layout-store";
import { getDb } from "@/lib/db";
import { instanceRoleOf } from "@/lib/members";
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
  const [detail, role, session] = await Promise.all([loadInstanceDetail(id), instanceRoleOf(id), getSession()]);
  // The Overview's layout is read here so the page arrives with it: no flash of the preset (ADR-026).
  const stored = session ? getLayout(getDb(), session.user.id) : null;
  return (
    <InstanceProvider initial={detail} role={role}>
      <DashboardLayoutProvider initial={stored ?? defaultLayout()} isDefault={!stored}>
        <InstanceShell>{children}</InstanceShell>
      </DashboardLayoutProvider>
    </InstanceProvider>
  );
}
