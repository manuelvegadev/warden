import { redirect } from "next/navigation";
import { Console } from "@/components/instance/console";
import { InstanceProvider } from "@/components/instance/instance-context";
import { WardendConfigProvider } from "@/components/wardend-config";
import { getSession } from "@/lib/session";
import { loadInstanceDetail, publicWsUrl } from "@/lib/wardend";

/** The console alone, for a browser pop-up window (no sidebar, no header). */
export default async function ConsolePopout({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");
  const detail = await loadInstanceDetail(id);
  return (
    <WardendConfigProvider wsUrl={publicWsUrl()}>
      <InstanceProvider initial={detail} isAdmin={session.user.role === "admin"}>
        <title>{`${detail.manifest.name} · Console`}</title>
        <div className="h-svh p-3">
          <Console popout />
        </div>
      </InstanceProvider>
    </WardendConfigProvider>
  );
}
