"use client";

import { Button } from "@warden/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@warden/ui/components/dropdown-menu";
import { useState } from "react";
import { toast } from "sonner";
import { type InstanceState, instances } from "@/lib/api";

export function Controls({
  id,
  state,
  onDeleted,
  canManage,
}: {
  id: string;
  state: InstanceState;
  onDeleted: () => void;
  /** Deleting the instance is a manager's call; power is already gated by the caller. */
  canManage: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(`${label}: ${e instanceof Error ? e.message : "failed"}`);
    } finally {
      setBusy(false);
    }
  };
  const stopped = state === "stopped" || state === "crashed";
  const live = state === "running" || state === "starting";

  return (
    <div className="flex items-center gap-2">
      {stopped && (
        <Button disabled={busy} onClick={() => run("Start", () => instances.start(id))}>
          Start
        </Button>
      )}
      {live && (
        <>
          <Button variant="secondary" disabled={busy} onClick={() => run("Stop", () => instances.stop(id))}>
            Stop
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => run("Restart", () => instances.restart(id))}>
            Restart
          </Button>
        </>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="More actions" />}>
          ⋯
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={state === "stopped" || state === "installing"}
            className="text-destructive"
            onClick={() => {
              if (confirm("Force kill the server process? Unsaved world data may be lost.")) {
                void run("Kill", () => instances.kill(id));
              }
            }}
          >
            Kill process
          </DropdownMenuItem>
          {canManage && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => {
                  if (confirm(`Delete instance "${id}"? It will be moved to the trash.`)) {
                    void run("Delete", async () => {
                      await instances.remove(id);
                      onDeleted();
                    });
                  }
                }}
              >
                Delete instance
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
