"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Console } from "@/components/instance/console";
import { Controls } from "@/components/instance/controls";
import { MetricsChart } from "@/components/instance/metrics-chart";
import { PlayersTab } from "@/components/instance/players-tab";
import { ResourceCards } from "@/components/instance/resource-cards";
import { SettingsForm } from "@/components/instance/settings-form";
import { InstanceSidebar } from "@/components/instance/sidebar";
import { StateBadge } from "@/components/state-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMetricsHistory } from "@/hooks/use-metrics-history";
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
  const history = useMetricsHistory(manifest.id, metrics);

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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="grid min-w-0 gap-6">
          <ResourceCards
            metrics={metrics}
            history={history}
            state={status.state}
            tps={status.tps}
            memoryMb={manifest.memoryMb}
          />

          <Tabs defaultValue="console">
            <TabsList>
              <TabsTrigger value="console">Console</TabsTrigger>
              <TabsTrigger value="metrics">Metrics</TabsTrigger>
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
            <TabsContent value="metrics">
              <MetricsChart data={history} memoryMb={manifest.memoryMb} />
            </TabsContent>
            <TabsContent value="players">
              <PlayersTab id={manifest.id} online={status.players} />
            </TabsContent>
            <TabsContent value="settings">
              <SettingsForm manifest={manifest} running={status.state !== "stopped" && status.state !== "crashed"} />
            </TabsContent>
          </Tabs>
        </div>
        <InstanceSidebar manifest={manifest} status={status} metrics={metrics} />
      </div>
    </div>
  );
}
