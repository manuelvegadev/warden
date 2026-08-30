"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useOptionalInstances } from "@/components/instances-store";
import { type MetricPoint, useMetricsHistory } from "@/hooks/use-metrics-history";
import { useWardendSocket, type WsMessage } from "@/hooks/use-wardend-socket";
import {
  type ConsoleLine,
  type InstanceDetail,
  type InstanceStatus,
  instances,
  type Manifest,
  type MetricSample,
  type Task,
  taskLabel,
  tasks,
} from "@/lib/api";

export interface InstanceState {
  manifest: Manifest;
  status: InstanceStatus;
  metrics: MetricSample | null;
  history: MetricPoint[];
  task: Task | null;
  connected: boolean;
  isAdmin: boolean;
  sendCommand: (command: string) => void;
  retryInstall: () => Promise<void>;
}

const StateCtx = createContext<InstanceState | null>(null);
// Console output is the high-frequency stream; it gets its own context so the shell does not re-render per line.
const LinesCtx = createContext<ConsoleLine[]>([]);

export function useInstance(): InstanceState {
  const v = useContext(StateCtx);
  if (!v) throw new Error("useInstance must be used inside InstanceProvider");
  return v;
}

export function useConsoleLines(): ConsoleLine[] {
  return useContext(LinesCtx);
}

const MAX_LINES = 2000;

/** Owns the WebSocket subscription and live state for one instance; every section reads from here. */
export function InstanceProvider({
  initial,
  isAdmin,
  children,
}: {
  initial: InstanceDetail;
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  const { manifest } = initial;
  const setListStatus = useOptionalInstances()?.setStatus;
  const [status, setStatusState] = useState<InstanceStatus>(initial.status);
  const [metrics, setMetrics] = useState<MetricSample | null>(initial.metrics);
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [task, setTask] = useState<Task | null>(null);
  // A task that started (or finished) before this page subscribed — an import that failed in
  // milliseconds, an install still running after a reload — is only known through REST.
  useEffect(() => {
    let live = true;
    tasks.ofInstance(manifest.id).then(
      (list) => live && list[0] && setTask((t) => t ?? list[0]),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [manifest.id]);

  // Incoming lines are buffered and flushed once per frame: one state update per burst, not per line.
  const pendingLines = useRef<ConsoleLine[]>([]);
  const flushScheduled = useRef(false);
  const flushLines = useCallback(() => {
    flushScheduled.current = false;
    const batch = pendingLines.current;
    pendingLines.current = [];
    if (batch.length) setLines((prev) => [...prev, ...batch].slice(-MAX_LINES));
  }, []);
  const pushLine = useCallback(
    (line: ConsoleLine) => {
      pendingLines.current.push(line);
      if (!flushScheduled.current) {
        flushScheduled.current = true;
        requestAnimationFrame(flushLines);
      }
    },
    [flushLines],
  );

  const setStatus = useCallback(
    (next: InstanceStatus) => {
      setStatusState(next);
      setListStatus?.(manifest.id, next);
    },
    [manifest.id, setListStatus],
  );

  const onMessage = useCallback(
    (msg: WsMessage) => {
      switch (msg.type) {
        case "console.history":
          pendingLines.current = [];
          setLines((msg.data as { lines: ConsoleLine[] }).lines ?? []);
          break;
        case "console":
          pushLine(msg.data as ConsoleLine);
          break;
        case "state":
          setStatus(msg.data as InstanceStatus);
          break;
        case "players":
          setStatusState((s) => ({ ...s, players: msg.data as string[] }));
          break;
        case "metrics":
          setMetrics(msg.data as MetricSample);
          break;
        case "task.progress": {
          const t = msg.data as Task;
          setTask(t);
          if (t.status === "failed") toast.error(`${taskLabel(t.type)} failed: ${t.error}`);
          if (t.status === "done") toast.success(t.message);
          break;
        }
        case "error":
          toast.error(String(msg.data));
          break;
      }
    },
    [pushLine, setStatus],
  );

  const { connected, send } = useWardendSocket([manifest.id], onMessage);
  const history = useMetricsHistory(manifest.id, metrics);

  const sendCommand = useCallback(
    (command: string) => send({ type: "command", instance: manifest.id, data: { command } }),
    [send, manifest.id],
  );

  const retryInstall = useCallback(async () => {
    try {
      const { task } = await instances.install(manifest.id, true);
      setTask(task);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Install failed");
    }
  }, [manifest.id]);

  const value = useMemo<InstanceState>(
    () => ({ manifest, status, metrics, history, task, connected, isAdmin, sendCommand, retryInstall }),
    [manifest, status, metrics, history, task, connected, isAdmin, sendCommand, retryInstall],
  );

  return (
    <StateCtx.Provider value={value}>
      <LinesCtx.Provider value={lines}>{children}</LinesCtx.Provider>
    </StateCtx.Provider>
  );
}
