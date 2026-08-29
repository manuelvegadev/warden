"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CopyButton, SectionCard } from "@/components/instance/section-card";
import { instances, type LaunchCommand, type Manifest } from "@/lib/api";
import { mono } from "@/lib/utils";

/** The exact `java …` line wardend runs for this instance, rebuilt from the current settings. */
export function LaunchCommandCard({ manifest }: { manifest: Manifest }) {
  const [cmd, setCmd] = useState<LaunchCommand | null>(null);

  // Re-fetch when the manifest changes: memory, flags, runtime and jar all feed the command.
  useEffect(() => {
    instances
      .launchCommand(manifest.id)
      .then(setCmd)
      .catch((e) => toast.error(e.message));
  }, [manifest]);

  return (
    <SectionCard
      title="Launch command"
      subtitle="What wardend executes on Start, from the settings below. Runs inside the server directory."
      action={cmd && <CopyButton value={`cd '${cmd.cwd}' && ${cmd.shell}`} label="Copy" showLabel />}
    >
      {cmd === null ? (
        <p className="px-5 py-3 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-2 px-5 py-3">
          <pre className={`${mono} overflow-x-auto whitespace-pre-wrap break-all text-xs leading-relaxed`}>
            <span className="text-muted-foreground">{cmd.cwd} $ </span>
            {cmd.shell}
          </pre>
          {cmd.javaError && <p className="text-xs text-amber-500">Java not resolved yet: {cmd.javaError}</p>}
        </div>
      )}
    </SectionCard>
  );
}
