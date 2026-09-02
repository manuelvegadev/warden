"use client";

import { Alert, AlertDescription, AlertTitle } from "@warden/ui/components/alert";
import { Button } from "@warden/ui/components/button";
import { cn } from "@warden/ui/lib/utils";
import { useParams, useRouter } from "next/navigation";
import { useCallback } from "react";
import { Controls } from "@/components/instance/controls";
import { useInstance } from "@/components/instance/instance-context";
import { ResourceCards } from "@/components/instance/resource-cards";
import { CopyButton } from "@/components/instance/section-card";
import { sectionBySlug } from "@/components/instance/sections";
import { InstanceSidebar } from "@/components/instance/sidebar";
import { TaskBanner } from "@/components/instance/task-banner";
import { StateBadge } from "@/components/state-badge";
import { useServerAddress } from "@/components/wardend-config";

/**
 * Instance page chrome: a header (name, controls, stat tiles) and below it the section content next
 * to the facts sidebar. Section navigation lives in the app sidebar.
 */
export function InstanceShell({ children }: { children: React.ReactNode }) {
  const { manifest, status, metrics, recent, task, connected, retryInstall, canOperate, canManage } = useInstance();
  const router = useRouter();
  const onDeleted = useCallback(() => router.push("/"), [router]);

  const address = useServerAddress(manifest.port);
  // Metrics charts the same four series as the tiles, so it asks the shell to drop them.
  const { section } = useParams<{ section?: string }>();
  const current = section ? sectionBySlug(section) : undefined;
  // A viewer section gets the whole page: no tiles, no sidebar, and the height chain down to it.
  const viewer = current?.layout === "viewer";
  const showTiles = !current?.hidesResourceCards && !viewer;
  const showSidebar = !viewer;
  const fills = viewer;

  return (
    <div className={cn("grid min-w-0 grid-rows-[auto_minmax(0,1fr)]", fills && "h-full")}>
      <header className="page-pad grid gap-4 border-b">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="flex items-center gap-3 text-2xl font-semibold">
              {manifest.name} <StateBadge state={status.state} />
              {!connected && <span className="text-xs font-normal text-muted-foreground">(reconnecting…)</span>}
            </h1>
            <CopyButton
              value={address}
              label={address}
              showLabel
              className="font-mono text-muted-foreground hover:text-foreground"
            />
          </div>
          {canOperate && <Controls id={manifest.id} state={status.state} onDeleted={onDeleted} canManage={canManage} />}
        </div>
        <TaskBanner task={task} onRetryInstall={retryInstall} />
        {/* Only when there is a build to fetch: an unfinished import has no software yet and no task to retry. */}
        {status.state === "installing" && !task && manifest.software && manifest.mcVersion && (
          <Alert>
            <AlertTitle>Not installed</AlertTitle>
            <AlertDescription className="grid gap-2">
              <span>The server jar has not been downloaded yet.</span>
              <Button size="sm" variant="outline" className="w-fit" onClick={retryInstall}>
                Install now
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {showTiles && (
          <ResourceCards
            metrics={metrics}
            history={recent}
            state={status.state}
            tps={status.tps}
            memoryMb={manifest.memoryMb}
          />
        )}
      </header>

      <div className={cn("grid grid-cols-1", showSidebar && "lg:grid-cols-[minmax(0,1fr)_280px]", fills && "min-h-0")}>
        <main className={cn("page-pad min-w-0", fills && "flex min-h-0 flex-col")}>
          <div className={cn("w-full", showSidebar && "max-w-5xl", fills && "flex min-h-0 flex-1 flex-col")}>
            {children}
          </div>
        </main>
        {showSidebar && (
          <div className="page-pad border-t lg:border-t-0 lg:border-l">
            <InstanceSidebar manifest={manifest} status={status} metrics={metrics} />
          </div>
        )}
      </div>
    </div>
  );
}
