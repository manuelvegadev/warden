"use client";

import { Clock, Coffee, Cpu, HardDrive, Hash, MemoryStick, Network, Package, Users } from "lucide-react";
import { useUptime } from "@/components/instance/resource-cards";
import { StateBadge } from "@/components/state-badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatBytes, type InstanceStatus, type Manifest, type MetricSample } from "@/lib/api";
import { mono } from "@/lib/utils";

const monoNum = `${mono} tabular-nums`;

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </span>
      <span className={`truncate ${monoNum}`}>{value}</span>
    </div>
  );
}

/** Static/slow-changing facts about the instance: state, uptime, players online, build and runtime details. */
export function InstanceSidebar({
  manifest,
  status,
  metrics,
}: {
  manifest: Manifest;
  status: InstanceStatus;
  metrics: MetricSample | null;
}) {
  const uptime = useUptime(status.startedAt);
  const live = status.state === "running" || status.state === "starting" || status.state === "stopping";
  return (
    <aside className="grid gap-3 self-start">
      <Card className="py-0">
        <CardContent className="px-4 py-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Status</span>
            <StateBadge state={status.state} />
          </div>
          <Row icon={Clock} label="Uptime" value={live ? uptime : "—"} />
          <Row icon={Hash} label="PID" value={status.pid ?? "—"} />
          {status.startedAt && (
            <Row icon={Clock} label="Started" value={new Date(status.startedAt).toLocaleTimeString()} />
          )}
        </CardContent>
      </Card>

      <Card className="py-0">
        <CardContent className="px-4 py-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="size-3.5" aria-hidden />
            Players online · {live ? status.players.length : 0}
          </div>
          {live && status.players.length > 0 ? (
            <ul className={`grid gap-0.5 text-sm ${monoNum}`}>
              {status.players.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nobody online.</p>
          )}
        </CardContent>
      </Card>

      <Card className="py-0">
        <CardContent className="px-4 py-3">
          <div className="mb-1 text-xs text-muted-foreground">Server</div>
          <Row icon={Package} label="Software" value={`${manifest.software} ${manifest.mcVersion}`} />
          <Row icon={Hash} label="Build" value={manifest.build ? `#${manifest.build}` : "—"} />
          <Row icon={Network} label="Port" value={manifest.port} />
          <Row icon={HardDrive} label="Size" value={metrics ? formatBytes(metrics.diskUsed) : "—"} />
          <Row icon={MemoryStick} label="RAM" value={`${manifest.memoryMb} MB`} />
          <Row icon={Cpu} label="JVM flags" value={manifest.jvmFlagsPreset} />
          <Row icon={Coffee} label="Java" value={manifest.javaPath ?? manifest.javaRuntime ?? "auto"} />
        </CardContent>
      </Card>
    </aside>
  );
}
