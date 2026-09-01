import { redirect } from "next/navigation";
import { InstanceProvider } from "@/components/instance/instance-context";
import { MetricsPopout } from "@/components/instance/metrics-popout";
import { WardendConfigProvider } from "@/components/wardend-config";
import { instanceRoleOf } from "@/lib/members";
import { getSession } from "@/lib/session";
import { loadInstanceDetail, publicWsUrl } from "@/lib/wardend";

/** The metrics charts alone, for a browser pop-up window (no sidebar, no header). */
export default async function MetricsPopoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");
  const [detail, role] = await Promise.all([loadInstanceDetail(id), instanceRoleOf(id)]);
  return (
    <WardendConfigProvider wsUrl={publicWsUrl()}>
      <InstanceProvider initial={detail} role={role}>
        <title>{`${detail.manifest.name} · Metrics`}</title>
        <div className="h-svh p-3">
          <MetricsPopout />
        </div>
      </InstanceProvider>
    </WardendConfigProvider>
  );
}
