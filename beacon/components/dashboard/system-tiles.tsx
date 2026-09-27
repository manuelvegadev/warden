"use client";

import { Activity, Clock, Cpu, HardDrive, MemoryStick, Monitor, Server, Users } from "lucide-react";
import { useInstances } from "@/components/instances-store";
import { StatTile } from "@/components/stat-tile";
import { useSystemInfo } from "@/hooks/use-system-info";
import { Uptime } from "@/hooks/use-uptime";
import { formatBytes } from "@/lib/api";
import { formatDuration } from "@/lib/utils";

interface Tile {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: React.ReactNode;
  detail?: React.ReactNode;
}

function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    // The dashboard's own spacing between cards, so the tiles read as loose cards like its other modules.
    <div className="grid grid-cols-2 gap-4 sm:gap-5 @2xl:grid-cols-4">
      {tiles.map((t) => (
        <StatTile key={t.label} {...t} />
      ))}
    </div>
  );
}

/** Joins the present parts with " · ". */
const dots = (...parts: (string | false | undefined | 0)[]) => parts.filter(Boolean).join(" · ");

const pct = (used?: number, total?: number) => (used && total ? `${Math.round((used / total) * 100)} %` : "—");

/** The "Wardend" dashboard module: the daemon's version, uptime, instance count and players online. */
export function WardendTiles() {
  const sys = useSystemInfo();
  const { instances } = useInstances();
  const running = instances.filter((i) => i.status.state === "running");
  const players = running.reduce((n, i) => n + i.status.players.length, 0);

  const tiles: Tile[] = [
    { label: "wardend", icon: Server, value: sys ? sys.daemonVersion : "—", detail: sys?.goVersion },
    { label: "Uptime", icon: Clock, value: <Uptime startedAt={sys?.startedAt} />, detail: sys?.hostname },
    {
      label: "Instances",
      icon: Activity,
      value: `${running.length}/${instances.length}`,
      detail: `${running.length} running`,
    },
    { label: "Players online", icon: Users, value: String(players) },
  ];

  return <Tiles tiles={tiles} />;
}

/** The "Host" dashboard module: system, CPU, memory and disk of the machine wardend runs on. */
export function HostTiles() {
  const sys = useSystemInfo();

  const tiles: Tile[] = [
    {
      label: "System",
      icon: Monitor,
      value: sys?.platform || sys?.os || "—",
      detail: sys && dots(sys.os, sys.hostUptime && `up ${formatDuration(sys.hostUptime)}`),
    },
    {
      label: "CPU",
      icon: Cpu,
      value: sys?.cpuPercent !== undefined ? `${sys.cpuPercent.toFixed(0)} %` : "—",
      detail: sys
        ? `${sys.cpuCores} cores${sys.load ? ` · load ${sys.load.map((l) => l.toFixed(2)).join(" ")}` : ""}`
        : undefined,
    },
    {
      label: "Memory",
      icon: MemoryStick,
      value: pct(sys?.memUsed, sys?.memTotal),
      detail: sys?.memTotal ? `${formatBytes(sys.memUsed ?? 0)} of ${formatBytes(sys.memTotal)}` : undefined,
    },
    {
      label: "Disk",
      icon: HardDrive,
      value: pct(sys?.disk?.used, sys?.disk?.total),
      detail: sys?.disk
        ? `${formatBytes(sys.disk.used)} of ${formatBytes(sys.disk.total)} · ${sys.disk.path}`
        : undefined,
    },
  ];

  return <Tiles tiles={tiles} />;
}
