"use client";

import { Button } from "@warden/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@warden/ui/components/dropdown-menu";
import { MoreHorizontal, Play, RotateCw, ServerCrash, Square, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
  const [confirming, setConfirming] = useState<"kill" | "delete" | null>(null);
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
          <Play /> Start
        </Button>
      )}
      {live && (
        <>
          <Button variant="secondary" disabled={busy} onClick={() => run("Stop", () => instances.stop(id))}>
            <Square /> Stop
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => run("Restart", () => instances.restart(id))}>
            <RotateCw /> Restart
          </Button>
        </>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="More actions" />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem
            disabled={state === "stopped" || state === "installing"}
            className="text-destructive"
            onClick={() => setConfirming("kill")}
          >
            <ServerCrash /> Kill process
          </DropdownMenuItem>
          {canManage && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={() => setConfirming("delete")}>
                <Trash2 /> Delete instance
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirming === "kill"}
        onClose={() => setConfirming(null)}
        title="Kill the server process?"
        description="The process is terminated immediately, with no chance to save. Anything the world has not
          written to disk since the last save is lost. Stop is the graceful way out; this is for a server that
          will not respond to it."
        confirmLabel="Kill process"
        destructive
        onConfirm={() => void run("Kill", () => instances.kill(id))}
      />
      <ConfirmDialog
        open={confirming === "delete"}
        onClose={() => setConfirming(null)}
        title={`Delete "${id}"?`}
        description="The instance, its world and its backups move to the daemon's trash, where they are kept for
          seven days before being removed for good."
        confirmLabel="Delete instance"
        destructive
        onConfirm={() =>
          void run("Delete", async () => {
            await instances.remove(id);
            onDeleted();
          })
        }
      />
    </div>
  );
}
