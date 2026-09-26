"use client";

import { Button } from "@warden/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@warden/ui/components/dropdown-menu";
import { Loader2, MoreHorizontal, Play, RotateCw, ServerCrash, Square, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SectionCard, SettingRow } from "@/components/instance/section-card";
import { useOptionalInstances } from "@/components/instances-store";
import { type InstanceState, type InstanceStatus, instances } from "@/lib/api";

/** Runs a daemon call with a busy flag, reporting a failure as a toast. */
function useRun() {
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
  return { busy, run };
}

/** Who a stop or a restart would disconnect, for the confirmation. */
function whoIsOnline(players: string[]) {
  if (players.length === 0) return "No one is online.";
  const names = players.length <= 3 ? players.join(", ") : `${players.slice(0, 3).join(", ")} and others`;
  return `${players.length} ${players.length === 1 ? "player is" : "players are"} online and will be disconnected: ${names}.`;
}

const TRANSITION: Partial<Record<InstanceState, string>> = { stopping: "Stopping…", installing: "Installing…" };

/**
 * The server's power controls, under the instance switcher in the app sidebar — away from the
 * page, where a Stop next to a section's own toolbar read as that section's. Start is one click;
 * Stop and Restart ask first, naming who would be disconnected; Kill waits in the overflow menu.
 */
export function PowerControls({ id, status }: { id: string; status: InstanceStatus }) {
  const { busy, run } = useRun();
  const [confirming, setConfirming] = useState<"stop" | "kill" | null>(null);
  const { state, players } = status;
  const stopped = state === "stopped" || state === "crashed";
  const live = state === "running" || state === "starting";
  const killable = state !== "stopped" && state !== "installing";
  const transition = TRANSITION[state];

  return (
    <div className="flex items-center gap-1.5">
      {stopped && (
        <Button size="sm" className="flex-1" disabled={busy} onClick={() => run("Start", () => instances.start(id))}>
          <Play /> Start
        </Button>
      )}
      {live && (
        <>
          <Button
            size="sm"
            variant="destructive"
            className="flex-1"
            disabled={busy}
            onClick={() => setConfirming("stop")}
          >
            <Square /> Stop
          </Button>
          <RestartServerButton id={id} players={players} className="flex-1" />
        </>
      )}
      {transition && (
        <Button size="sm" variant="outline" className="flex-1" disabled>
          <Loader2 className="animate-spin" /> {transition}
        </Button>
      )}
      {killable && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" size="icon-sm" aria-label="More power actions" title="More" />}
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem className="text-destructive" onClick={() => setConfirming("kill")}>
              <ServerCrash /> Kill process
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <ConfirmDialog
        open={confirming === "stop"}
        onClose={() => setConfirming(null)}
        title="Stop the server?"
        description={`${whoIsOnline(players)} The world is saved before the server exits.`}
        confirmLabel="Stop server"
        destructive={players.length > 0}
        onConfirm={() => void run("Stop", () => instances.stop(id))}
      />
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
    </div>
  );
}

/** Restart, after a confirmation naming who would be disconnected: the sidebar's and the restart banner's. */
export function RestartServerButton({
  id,
  players,
  label = "Restart",
  className,
}: {
  id: string;
  players: string[];
  label?: string;
  className?: string;
}) {
  const { busy, run } = useRun();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button size="sm" variant="warning" className={className} disabled={busy} onClick={() => setConfirming(true)}>
        <RotateCw /> {label}
      </Button>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Restart the server?"
        description={`${whoIsOnline(players)} The server saves the world, stops and starts again.`}
        confirmLabel="Restart server"
        destructive={players.length > 0}
        onConfirm={() => void run("Restart", () => instances.restart(id))}
      />
    </>
  );
}

/** Deleting the instance: the last card of its Settings, a manager's call. */
export function DeleteInstanceCard({ id, name }: { id: string; name: string }) {
  const { busy, run } = useRun();
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();
  const refresh = useOptionalInstances()?.refresh;

  return (
    <SectionCard title="Danger zone">
      <SettingRow
        label="Delete instance"
        description="The instance, its world and its backups move to the daemon's trash for seven days."
      >
        <Button variant="destructive" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
          <Trash2 /> Delete instance
        </Button>
      </SettingRow>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Delete "${name}"?`}
        description="The instance, its world and its backups move to the daemon's trash, where they are kept for
          seven days before being removed for good."
        confirmLabel="Delete instance"
        destructive
        onConfirm={() =>
          void run("Delete", async () => {
            await instances.remove(id);
            await refresh?.();
            router.push("/");
          })
        }
      />
    </SectionCard>
  );
}
