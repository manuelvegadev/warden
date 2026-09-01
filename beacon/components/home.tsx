"use client";

import { Button } from "@warden/ui/components/button";
import { Activity, Clock, Cpu, HardDrive, MemoryStick, Monitor, Server, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { InstanceList } from "@/components/instance-list";
import { useInstances } from "@/components/instances-store";
import { StatTile } from "@/components/stat-tile";
import { WardendUpdate } from "@/components/wardend-update";
import { Uptime } from "@/hooks/use-uptime";
import { useWardendSocket, type WsMessage } from "@/hooks/use-wardend-socket";
import { formatBytes, type InstanceStatus, type SystemInfo, system } from "@/lib/api";
import { formatDuration } from "@/lib/utils";

const REFRESH_MS = 5000;

interface Tile {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: React.ReactNode;
  detail?: React.ReactNode;
}

function Tiles({ title, tiles }: { title: string; tiles: Tile[] }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <StatTile key={t.label} {...t} />
        ))}
      </div>
    </section>
  );
}

/** Joins the present parts with " · ". */
const dots = (...parts: (string | false | undefined | 0)[]) => parts.filter(Boolean).join(" · ");

const pct = (used?: number, total?: number) => (used && total ? `${Math.round((used / total) * 100)} %` : "—");

/** Home: daemon and host overview on top, the instance list below. Live via the socket + a 5 s poll. */
export function Home({ isAdmin, canCreate }: { isAdmin: boolean; canCreate: boolean }) {
  const { instances, setStatus, openCreate, openImport } = useInstances();
  const [sys, setSys] = useState<SystemInfo | null>(null);

  useEffect(() => {
    let stale = false;
    const load = () =>
      system.get().then(
        (s) => !stale && setSys(s),
        () => {},
      );
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      stale = true;
      clearInterval(id);
    };
  }, []);

  const onMessage = useCallback(
    (msg: WsMessage) => {
      if (msg.type === "state" && msg.instance) setStatus(msg.instance, msg.data as InstanceStatus);
    },
    [setStatus],
  );
  useWardendSocket(
    instances.map((i) => i.id),
    onMessage,
  );

  const running = instances.filter((i) => i.status.state === "running");
  const players = running.reduce((n, i) => n + i.status.players.length, 0);

  const wardend: Tile[] = [
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
  const host: Tile[] = [
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

  return (
    <div className="grid gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Home</h1>
        {canCreate && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={openImport}>
              Import
            </Button>
            <Button onClick={openCreate}>New instance</Button>
          </div>
        )}
      </div>
      <WardendUpdate current={sys?.daemonVersion} isAdmin={isAdmin} />
      <Tiles title="Wardend" tiles={wardend} />
      <Tiles title="Host" tiles={host} />
      <section className="grid gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Instances</h2>
        <InstanceList />
      </section>
    </div>
  );
}
