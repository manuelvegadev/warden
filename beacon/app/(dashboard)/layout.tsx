import { SidebarInset, SidebarProvider } from "@warden/ui/components/sidebar";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { CreateInstanceDialog } from "@/components/create-instance-dialog";
import { ImportInstanceDialog } from "@/components/import-instance-dialog";
import { InstancesProvider } from "@/components/instances-store";
import { SiteHeader } from "@/components/site-header";
import { WardendConfigProvider } from "@/components/wardend-config";
import { roleFor } from "@/lib/access";
import { canManageMembers, currentAccess, currentMembership } from "@/lib/members";
import { getSession } from "@/lib/session";
import { loadInstances, publicWsUrl } from "@/lib/wardend";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [session, cookieStore] = await Promise.all([getSession(), cookies()]);
  if (!session) redirect("/login");
  const { user } = session;
  // Seed the shared instance list; a daemon outage must not take the whole shell down. The
  // organization stays invisible while there is one; only its managers get the Members entry.
  const [instances, membership, access] = await Promise.all([loadInstances(), currentMembership(), currentAccess()]);
  // Resolved once here so the sidebar can hide the sections this person cannot open.
  const roles = Object.fromEntries(
    instances.flatMap((i) => {
      const role = access && roleFor(access, i.id);
      return role ? [[i.id, role] as const] : [];
    }),
  );
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <WardendConfigProvider wsUrl={publicWsUrl()}>
      <InstancesProvider initial={instances} roles={roles}>
        {/* The viewport never scrolls: the inset (the bordered "island") is the scroll container. */}
        <SidebarProvider defaultOpen={sidebarOpen} className="h-svh overflow-hidden">
          <AppSidebar
            user={{ name: user.name, email: user.email, role: user.role ?? "operator" }}
            canManageMembers={canManageMembers(membership)}
          />
          <SidebarInset className="min-h-0 overflow-hidden">
            <SiteHeader />
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          </SidebarInset>
        </SidebarProvider>
        <CreateInstanceDialog />
        <ImportInstanceDialog />
      </InstancesProvider>
    </WardendConfigProvider>
  );
}
