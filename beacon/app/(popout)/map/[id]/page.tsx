import { redirect } from "next/navigation";
import { InstanceProvider } from "@/components/instance/instance-context";
import { LiveView } from "@/components/instance/live-view";
import { WardendConfigProvider } from "@/components/wardend-config";
import { instanceRoleOf } from "@/lib/members";
import { getSession } from "@/lib/session";
import { loadInstanceDetail, publicWsUrl } from "@/lib/wardend";

/** The live view alone, for a browser pop-up window (no sidebar, no header). */
export default async function MapPopout({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");
  const [detail, role] = await Promise.all([loadInstanceDetail(id), instanceRoleOf(id)]);
  return (
    <WardendConfigProvider wsUrl={publicWsUrl()}>
      <InstanceProvider initial={detail} role={role}>
        <title>{`${detail.manifest.name} · Live view`}</title>
        <div className="h-svh p-3">
          <LiveView popout />
        </div>
      </InstanceProvider>
    </WardendConfigProvider>
  );
}
