"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Console } from "@/components/instance/console";
import { Controls } from "@/components/instance/controls";
import { ResourceCards } from "@/components/instance/resource-cards";
import { StateBadge } from "@/components/state-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWardendSocket, type WsMessage } from "@/hooks/use-wardend-socket";
import {
  type ConsoleLine,
  type InstanceDetail,
  type InstanceStatus,
  instances,
  type MetricSample,
  type Task,
} from "@/lib/api";

export function InstanceView({ initial }: { initial: InstanceDetail }) {
  const router = useRouter();
  const { manifest } = initial;
  const [status, setStatus] = useState<InstanceStatus>(initial.status);
  const [metrics, setMetrics] = useState<MetricSample | null>(initial.metrics);
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [task, setTask] = useState<Task | null>(null);

  const onMessage = useCallback((msg: WsMessage) => {
    switch (msg.type) {
      case "console.history":
        setLines((msg.data as { lines: ConsoleLine[] }).lines ?? []);
        break;
      case "console":
        setLines((prev) => [...prev.slice(-1999), msg.data as ConsoleLine]);
        break;
      case "state":
        setStatus(msg.data as InstanceStatus);
        break;
      case "players":
        setStatus((s) => ({ ...s, players: msg.data as string[] }));
        break;
      case "metrics":
        setMetrics(msg.data as MetricSample);
        break;
      case "task.progress": {
        const t = msg.data as Task;
        setTask(t);
        if (t.status === "failed") toast.error(`${t.type} failed: ${t.error}`);
        if (t.status === "done") toast.success(t.message);
        break;
      }
      case "error":
        toast.error(String(msg.data));
        break;
    }
  }, []);

  const { connected, send } = useWardendSocket([manifest.id], onMessage);

  const sendCommand = useCallback(
    (command: string) => send({ type: "command", instance: manifest.id, data: { command } }),
    [send, manifest.id],
  );

  async function retryInstall() {
    try {
      const { task } = await instances.install(manifest.id, true);
      setTask(task);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Install failed");
    }
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm text-muted-foreground">
            <Link href="/" className="hover:underline">
              Instances
            </Link>{" "}
            / {manifest.id}
          </div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold">
            {manifest.name} <StateBadge state={status.state} />
            {!connected && <span className="text-xs font-normal text-muted-foreground">(reconnecting…)</span>}
          </h1>
          <div className="text-sm text-muted-foreground">
            {manifest.software} {manifest.mcVersion} #{manifest.build} · port {manifest.port} · {manifest.memoryMb} MB ·{" "}
            {manifest.jvmFlagsPreset} flags · Java: {manifest.javaPath ?? manifest.javaRuntime ?? "auto"}
          </div>
        </div>
        <Controls id={manifest.id} state={status.state} onDeleted={() => router.push("/")} />
      </div>

      {task && task.status !== "done" && (
        <Alert>
          <AlertTitle className="capitalize">
            {task.type} · {task.status}
          </AlertTitle>
          <AlertDescription className="grid gap-2">
            <span>{task.error ?? task.message}</span>
            {task.status === "running" && <Progress value={task.progress} />}
            {task.status === "failed" && (
              <Button size="sm" variant="outline" className="w-fit" onClick={retryInstall}>
                Retry install
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
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

      <ResourceCards metrics={metrics} players={status.players} state={status.state} startedAt={status.startedAt} />

      <Tabs defaultValue="console">
        <TabsList>
          <TabsTrigger value="console">Console</TabsTrigger>
          <TabsTrigger value="players">Players</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="console">
          <Console
            instanceId={manifest.id}
            lines={lines}
            onCommand={sendCommand}
            disabled={status.state !== "running" && status.state !== "starting"}
          />
        </TabsContent>
        <TabsContent value="players">
          {status.players.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">No players online.</p>
          ) : (
            <ul className="grid gap-1 py-2 text-sm">
              {status.players.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="settings">
          <p className="py-6 text-sm text-muted-foreground">
            server.properties, whitelist and plugins arrive in phase 2.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
