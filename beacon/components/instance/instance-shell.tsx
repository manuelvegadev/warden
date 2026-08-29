"use client";

import { Alert, AlertDescription, AlertTitle } from "@warden/ui/components/alert";
import { Button } from "@warden/ui/components/button";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { Controls } from "@/components/instance/controls";
import { useInstance } from "@/components/instance/instance-context";
import { ResourceCards } from "@/components/instance/resource-cards";
import { InstanceSidebar } from "@/components/instance/sidebar";
import { TaskBanner } from "@/components/instance/task-banner";
import { StateBadge } from "@/components/state-badge";

/**
 * Instance page chrome: a header (name, controls, stat tiles) and below it the section content next
 * to the facts sidebar. Section navigation lives in the app sidebar.
 */
export function InstanceShell({ children }: { children: React.ReactNode }) {
  const { manifest, status, metrics, history, task, connected, retryInstall } = useInstance();
  const router = useRouter();
  const onDeleted = useCallback(() => router.push("/"), [router]);

  return (
    <div className="grid min-w-0 grid-rows-[auto_minmax(0,1fr)]">
      <header className="grid gap-4 border-b p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-3 text-2xl font-semibold">
            {manifest.name} <StateBadge state={status.state} />
            {!connected && <span className="text-xs font-normal text-muted-foreground">(reconnecting…)</span>}
          </h1>
          <Controls id={manifest.id} state={status.state} onDeleted={onDeleted} />
        </div>
        <TaskBanner task={task} onRetryInstall={retryInstall} />
        {status.state === "installing" && !task && (
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
          history={history}
          state={status.state}
          tps={status.tps}
          memoryMb={manifest.memoryMb}
        />
      </header>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_280px]">
        <main className="min-w-0 p-5">
          <div className="w-full max-w-5xl">{children}</div>
        </main>
        <div className="border-l p-5">
          <InstanceSidebar manifest={manifest} status={status} metrics={metrics} />
        </div>
      </div>
    </div>
  );
}
