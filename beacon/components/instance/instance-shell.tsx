"use client";

import { Alert, AlertDescription, AlertTitle } from "@warden/ui/components/alert";
import { Button } from "@warden/ui/components/button";
import { cn } from "@warden/ui/lib/utils";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useInstance } from "@/components/instance/instance-context";
import { SaveBarSlot } from "@/components/instance/section-card";
import { sectionBySlug } from "@/components/instance/sections";
import { StatusPanel } from "@/components/instance/status-panel";
import { TaskBanner } from "@/components/instance/task-banner";
import { StatusSlot } from "@/components/slots";

/**
 * Instance page chrome (ADR-021): the status panel goes into the app sidebar, and the section
 * has the page to itself — no title, no tiles, no facts sidebar. The name lives in the instance
 * switcher and the breadcrumb, the figures in the status panel and the Overview, the power
 * controls in the app sidebar. A task in progress or a missing server jar is announced above the
 * section.
 */

export function InstanceShell({ children }: { children: React.ReactNode }) {
  const { manifest, status, task, retryInstall } = useInstance();

  const { section } = useParams<{ section?: string }>();
  const current = section ? sectionBySlug(section) : undefined;
  // A viewer is as tall as the view at every width, a fill section from `lg` up (its own content
  // scrolls inside it); any other page is at least as tall as the view, so the save bar sits at
  // its foot however short the section is.
  const viewer = current?.layout === "viewer";
  const fill = current?.layout === "fill";
  const fills = viewer || fill;
  // A section's save bar is portalled to the foot of the page (SaveBarSlot); a viewer keeps its
  // bars inside its own panes.
  const [saveSlot, setSaveSlot] = useState<HTMLDivElement | null>(null);
  // Only when there is a build to fetch: an unfinished import has no software yet and no task to retry.
  const notInstalled = status.state === "installing" && !task && Boolean(manifest.software && manifest.mcVersion);

  return (
    <div className={cn("flex min-w-0 flex-col", viewer ? "h-full" : "min-h-full", fill && "lg:h-full")}>
      <StatusSlot.Fill>
        <StatusPanel />
      </StatusSlot.Fill>
      {(task || notInstalled) && (
        <div className="page-pad grid gap-3 border-b">
          <TaskBanner task={task} onRetryInstall={retryInstall} />
          {notInstalled && (
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
        </div>
      )}
      <div className={cn("page-pad min-w-0 flex-1", fills && "flex min-h-0 flex-col")}>
        <div className={cn("w-full", current?.narrow && "max-w-5xl", fills && "flex min-h-0 flex-1 flex-col")}>
          <SaveBarSlot.Provider value={viewer ? null : saveSlot}>{children}</SaveBarSlot.Provider>
        </div>
      </div>
      {!viewer && <div ref={setSaveSlot} className="sticky bottom-0 z-10 empty:hidden" />}
    </div>
  );
}
