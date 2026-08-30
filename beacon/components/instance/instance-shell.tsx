"use client";

import { Alert, AlertDescription, AlertTitle } from "@warden/ui/components/alert";
import { Button } from "@warden/ui/components/button";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { Controls } from "@/components/instance/controls";
import { useInstance } from "@/components/instance/instance-context";
import { ResourceCards } from "@/components/instance/resource-cards";
import { CopyButton } from "@/components/instance/section-card";
import { InstanceSidebar } from "@/components/instance/sidebar";
import { TaskBanner } from "@/components/instance/task-banner";
import { StateBadge } from "@/components/state-badge";
import { useServerAddress } from "@/components/wardend-config";

/**
 * Instance page chrome: a header (name, controls, stat tiles) and below it the section content next
 * to the facts sidebar. Section navigation lives in the app sidebar.
 */
export function InstanceShell({ children }: { children: React.ReactNode }) {
  const { manifest, status, metrics, recent, task, connected, retryInstall } = useInstance();
  const router = useRouter();
  const onDeleted = useCallback(() => router.push("/"), [router]);

  const address = useServerAddress(manifest.port);

  return (
    <div className="grid min-w-0 grid-rows-[auto_minmax(0,1fr)]">
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
          <Controls id={manifest.id} state={status.state} onDeleted={onDeleted} />
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
        <ResourceCards
          metrics={metrics}
          history={recent}
          state={status.state}
          tps={status.tps}
          memoryMb={manifest.memoryMb}
        />
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px]">
        <main className="page-pad min-w-0">
          <div className="w-full max-w-5xl">{children}</div>
        </main>
        <div className="page-pad border-t lg:border-t-0 lg:border-l">
          <InstanceSidebar manifest={manifest} status={status} metrics={metrics} />
        </div>
      </div>
    </div>
  );
}
