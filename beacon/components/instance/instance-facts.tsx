"use client";

import { Card, CardContent } from "@warden/ui/components/card";
import { Clock, Coffee, Cpu, HardDrive, Hash, MemoryStick, Network, Package, Users } from "lucide-react";
import { PlayerName } from "@/components/instance/player-face";
import { StateBadge } from "@/components/state-badge";
import { useUptime } from "@/hooks/use-uptime";
import {
  formatBytes,
  hasBuilds,
  type InstanceStatus,
  type Manifest,
  type MetricSample,
  softwareLabel,
} from "@/lib/api";
import { formatWhen, mono } from "@/lib/utils";

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

const isLive = (s: InstanceStatus) => s.state === "running" || s.state === "starting" || s.state === "stopping";

/** State, uptime, process and when it started (Overview, ADR-021). */
export function StatusCard({ status, address }: { status: InstanceStatus; address: React.ReactNode }) {
  const uptime = useUptime(status.startedAt);
  const live = isLive(status);
  return (
    <Card className="py-0">
      <CardContent className="px-4 py-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Status</span>
          <StateBadge state={status.state} />
        </div>
        <Row icon={Network} label="Address" value={address} />
        <Row icon={Clock} label="Uptime" value={live ? uptime : "—"} />
        <Row icon={Hash} label="PID" value={status.pid ?? "—"} />
        {status.startedAt && <Row icon={Clock} label="Started" value={formatWhen(status.startedAt)} />}
      </CardContent>
    </Card>
  );
}

/** Who is on the server right now. */
export function PlayersOnlineCard({ status }: { status: InstanceStatus }) {
  const live = isLive(status);
  return (
    <Card className="py-0">
      <CardContent className="px-4 py-3">
        <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="size-3.5" aria-hidden />
          Players online · {live ? status.players.length : 0}
        </div>
        {live && status.players.length > 0 ? (
          <ul className={`grid gap-0.5 text-sm ${monoNum}`}>
            {status.players.map((p) => (
              <li key={p}>
                <PlayerName name={p} faceClassName="size-5" className="gap-2" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nobody online.</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Software, build and runtime: what the server is and how it is launched. */
export function ServerFactsCard({ manifest, metrics }: { manifest: Manifest; metrics: MetricSample | null }) {
  return (
    <Card className="py-0">
      <CardContent className="px-4 py-3">
        <div className="mb-1 text-xs text-muted-foreground">Server</div>
        <Row icon={Package} label="Software" value={softwareLabel(manifest)} />
        {hasBuilds(manifest.software) && (
          <Row icon={Hash} label="Build" value={manifest.build ? `#${manifest.build}` : "—"} />
        )}
        <Row icon={HardDrive} label="Size" value={metrics ? formatBytes(metrics.diskUsed) : "—"} />
        <Row icon={MemoryStick} label="RAM" value={`${manifest.memoryMb} MB`} />
        <Row icon={Cpu} label="JVM flags" value={manifest.jvmFlagsPreset} />
        <Row icon={Coffee} label="Java" value={manifest.javaPath ?? manifest.javaRuntime ?? "auto"} />
      </CardContent>
    </Card>
  );
}
