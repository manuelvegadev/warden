"use client";

import { Alert, AlertDescription, AlertTitle } from "@warden/ui/components/alert";
import { Button } from "@warden/ui/components/button";
import { cn } from "@warden/ui/lib/utils";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useInstance } from "@/components/instance/instance-context";
import { ResourceCards } from "@/components/instance/resource-cards";
import { CopyButton, SaveBarSlot } from "@/components/instance/section-card";
import { sectionBySlug } from "@/components/instance/sections";
import { InstanceSidebar } from "@/components/instance/sidebar";
import { TaskBanner } from "@/components/instance/task-banner";
import { StateBadge } from "@/components/state-badge";
import { useServerAddress } from "@/components/wardend-config";
import { hasTps } from "@/lib/api";

/**
 * Instance page chrome: a header (name, address, stat tiles) and below it the section content next
 * to the facts sidebar. Section navigation and the power controls live in the app sidebar.
 */
export function InstanceShell({ children }: { children: React.ReactNode }) {
  const { manifest, status, metrics, recent, task, connected, retryInstall } = useInstance();

  const address = useServerAddress(manifest.port);
  const { section } = useParams<{ section?: string }>();
  const current = section ? sectionBySlug(section) : undefined;
  // A viewer section gets the whole page: no tiles, no sidebar, and the height chain down to it.
  // A fill section keeps both and, from `lg` up, is as tall as the view — its own content scrolls
  // inside it, and so does a sidebar taller than what is left. Every other page is at least as
  // tall as the view, so the sidebar's divider runs to the bottom however short the section is.
  const viewer = current?.layout === "viewer";
  const fill = current?.layout === "fill";
  const fills = viewer || fill;
  const showTiles = !viewer;
  const showSidebar = !viewer;
  // A section's save bar is portalled to the foot of the main column (SaveBarSlot); a viewer keeps
  // its bars inside its own panes.
  const [saveSlot, setSaveSlot] = useState<HTMLDivElement | null>(null);

  return (
    <div
      className={cn(
        "grid min-w-0 grid-rows-[auto_minmax(0,1fr)]",
        viewer ? "h-full" : "min-h-full",
        fill && "lg:h-full",
      )}
    >
      <header className="page-pad grid gap-4 border-b">
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
            showTps={hasTps(manifest.software)}
            memoryMb={manifest.memoryMb}
          />
        )}
      </header>

      {/* Stacked on a phone, the section and the sidebar keep their own heights rather than share the spare one. */}
      <div
        className={cn(
          "grid grid-cols-1",
          !viewer && "content-start lg:content-normal",
          showSidebar && "lg:grid-cols-[minmax(0,1fr)_280px]",
          fills && "min-h-0",
        )}
      >
        <div className={cn("flex min-w-0 flex-col", fills && "min-h-0")}>
          <div className={cn("page-pad min-w-0 flex-1", fills && "flex min-h-0 flex-col")}>
            <div className={cn("w-full", showSidebar && "max-w-5xl", fills && "flex min-h-0 flex-1 flex-col")}>
              <SaveBarSlot.Provider value={viewer ? null : saveSlot}>{children}</SaveBarSlot.Provider>
            </div>
          </div>
          {!viewer && <div ref={setSaveSlot} className="sticky bottom-0 z-10 empty:hidden" />}
        </div>
        {showSidebar && (
          <div className={cn("page-pad border-t lg:border-t-0 lg:border-l", fill && "lg:overflow-y-auto")}>
            <InstanceSidebar manifest={manifest} status={status} metrics={metrics} />
          </div>
        )}
      </div>
    </div>
  );
}
