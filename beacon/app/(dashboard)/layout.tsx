import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { CreateInstanceDialog } from "@/components/create-instance-dialog";
import { InstancesProvider } from "@/components/instances-store";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import type { InstanceSummary } from "@/lib/api";
import { getSession } from "@/lib/session";
import { wardendFetch } from "@/lib/wardend";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [session, cookieStore] = await Promise.all([getSession(), cookies()]);
  if (!session) redirect("/login");
  const { user } = session;
  // Seed the shared instance list; a daemon outage must not take the whole shell down.
  const instances = await wardendFetch("/instances")
    .then((r) => (r.ok ? (r.json() as Promise<InstanceSummary[]>) : []))
    .catch(() => [] as InstanceSummary[]);
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <InstancesProvider initial={instances}>
      {/* The viewport never scrolls: the inset (the bordered "island") is the scroll container. */}
      <SidebarProvider defaultOpen={sidebarOpen} className="h-svh overflow-hidden">
        <AppSidebar user={{ name: user.name, email: user.email, role: user.role ?? "operator" }} />
        <SidebarInset className="min-h-0 overflow-hidden">
          <SiteHeader />
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </SidebarInset>
      </SidebarProvider>
      <CreateInstanceDialog />
    </InstancesProvider>
  );
}
