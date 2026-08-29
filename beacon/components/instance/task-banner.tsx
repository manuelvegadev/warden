"use client";

import { Alert, AlertDescription, AlertTitle } from "@warden/ui/components/alert";
import { Button } from "@warden/ui/components/button";
import { Progress } from "@warden/ui/components/progress";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { type Task, taskLabel } from "@/lib/api";

const LINGER_MS = 5000;

/**
 * Daemon task progress card. Slides in when a task starts and, once it finishes, lingers for a few
 * seconds in its final state so quick tasks are still readable. Failed tasks stay until the next one.
 */
export function TaskBanner({ task, onRetryInstall }: { task: Task | null; onRetryInstall: () => void }) {
  // Only the linger needs state: which finished task has been dismissed.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const shown = task && task.id !== dismissed ? task : null;

  // Keyed on id + status, not the object: progress snapshots arrive as new objects and must not reset the timer.
  const taskId = task?.id;
  const done = task?.status === "done";
  useEffect(() => {
    if (!done || !taskId) return;
    const t = setTimeout(() => setDismissed(taskId), LINGER_MS);
    return () => clearTimeout(t);
  }, [taskId, done]);

  return (
    <AnimatePresence initial={false}>
      {shown && (
        <motion.div
          key={shown.id}
          initial={{ opacity: 0, height: 0, y: -8 }}
          animate={{ opacity: 1, height: "auto", y: 0 }}
          exit={{ opacity: 0, height: 0, y: -8 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="overflow-hidden"
        >
          <Alert variant={shown.status === "failed" ? "destructive" : "default"}>
            {shown.status === "running" || shown.status === "pending" ? (
              <Loader2 className="animate-spin" />
            ) : shown.status === "done" ? (
              <CheckCircle2 />
            ) : (
              <CircleAlert />
            )}
            <AlertTitle>
              {taskLabel(shown.type)} · {shown.status === "done" ? "completed" : shown.status}
            </AlertTitle>
            <AlertDescription className="grid gap-2">
              <span>{shown.error ?? shown.message}</span>
              {shown.status === "running" && <Progress value={shown.progress} />}
              {shown.status === "failed" && shown.type === "install" && (
                <Button size="sm" variant="outline" className="w-fit" onClick={onRetryInstall}>
                  Retry install
                </Button>
              )}
            </AlertDescription>
          </Alert>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
