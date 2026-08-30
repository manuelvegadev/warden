"use client";

import { Alert, AlertDescription, AlertTitle } from "@warden/ui/components/alert";
import { Button } from "@warden/ui/components/button";
import { Progress } from "@warden/ui/components/progress";
import { ArrowUpCircle, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { system, type Task, tasks, type UpdateInfo } from "@/lib/api";

const POLL_MS = 1500;
const RESTART_TIMEOUT_MS = 90_000;

/**
 * "A newer wardend is available" card for the Home page. Update = the daemon stages the release
 * and its root helper installs and restarts it; the card follows the task, then waits for the
 * daemon to come back with the new version.
 */
export function WardendUpdate({ current, isAdmin }: { current?: string; isAdmin: boolean }) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [task, setTask] = useState<Task | null>(null);
  const [phase, setPhase] = useState<"idle" | "staging" | "restarting">("idle");

  useEffect(() => {
    system.update().then(setInfo, () => {});
  }, []);

  // Follow the staging task; once it is done the daemon restarts, so poll /system for the new version.
  useEffect(() => {
    if (phase !== "staging" || !task) return;
    const id = setInterval(() => {
      tasks.get(task.id).then(
        (t) => {
          setTask(t);
          if (t.status === "failed") {
            setPhase("idle");
            toast.error(`Update failed: ${t.error ?? t.message}`);
          } else if (t.status === "done") setPhase("restarting");
        },
        () => {},
      );
    }, POLL_MS);
    return () => clearInterval(id);
  }, [phase, task]);

  useEffect(() => {
    if (phase !== "restarting" || !info) return;
    const started = Date.now();
    const id = setInterval(() => {
      system.get().then(
        (s) => {
          if (s.daemonVersion === info.latest) {
            setPhase("idle");
            setInfo(null);
            toast.success(`wardend updated to ${s.daemonVersion}`);
            window.location.reload();
          } else if (Date.now() - started > RESTART_TIMEOUT_MS) {
            setPhase("idle");
            toast.error("The daemon did not come back with the new version; check journalctl -u wardend-update");
          }
        },
        () => {}, // restarting: unreachable for a moment
      );
    }, POLL_MS);
    return () => clearInterval(id);
  }, [phase, info]);

  if (!info?.available || (current && current === info.latest)) return null;

  async function apply() {
    setConfirm(false);
    try {
      const res = await system.applyUpdate();
      setTask(res.task);
      setPhase("staging");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  const busy = phase !== "idle";
  return (
    <>
      <Alert>
        {busy ? <Loader2 className="animate-spin" /> : <ArrowUpCircle />}
        <AlertTitle>
          {phase === "restarting"
            ? `Installing wardend ${info.latest} and restarting…`
            : phase === "staging"
              ? (task?.message ?? `Downloading wardend ${info.latest}…`)
              : `wardend ${info.latest} is available`}
        </AlertTitle>
        <AlertDescription className="grid gap-2">
          {phase === "idle" && (
            <span>
              You are on {info.current}.{" "}
              <a href={info.url} target="_blank" rel="noreferrer" className="underline">
                Release notes
              </a>
              {!info.canApply &&
                " · this daemon was not installed by wardend install: re-run the install script on the host."}
            </span>
          )}
          {phase === "staging" && task && <Progress value={task.progress} />}
          {phase === "idle" && info.canApply && isAdmin && (
            <Button size="sm" className="w-fit" onClick={() => setConfirm(true)}>
              Update wardend
            </Button>
          )}
        </AlertDescription>
      </Alert>
      <ConfirmDialog
        open={confirm}
        title={`Update wardend to ${info.latest}?`}
        description="The daemon downloads and verifies the release, installs it and restarts. Running servers are stopped for the restart and started again right after (expect a couple of minutes of downtime); Beacon reconnects by itself."
        confirmLabel="Update"
        onConfirm={apply}
        onClose={() => setConfirm(false)}
      />
    </>
  );
}
