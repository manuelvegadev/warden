"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@warden/ui/components/popover";
import { cn } from "@warden/ui/lib/utils";
import { Cpu, Gauge, MemoryStick, Users } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { useInstance } from "@/components/instance/instance-context";
import { PlayerName } from "@/components/instance/player-face";
import { compact } from "@/components/instance/resource-cards";
import { CopyButton } from "@/components/instance/section-card";
import { Sparkline } from "@/components/instance/sparkline";
import { StateBadge, stateDot } from "@/components/state-badge";
import { useServerAddress } from "@/components/wardend-config";
import { useHostCores } from "@/hooks/use-host-cores";
import { useUptime } from "@/hooks/use-uptime";
import { hasTps } from "@/lib/api";
import { instanceHref } from "@/lib/instance-routes";
import { CPU_DOMAIN, hostShare, memCeiling, tpsDomain } from "@/lib/metrics-axis";
import { formatWhen, mono } from "@/lib/utils";

/**
 * The instance at a glance, at the foot of the app sidebar (ADR-021): a small card with state and
 * uptime on top, then a row each for players online, TPS, CPU and RAM. Each row opens a popover
 * beside the sidebar with its detail — the players, the last minutes as a sparkline — and a link
 * to the section that owns it.
 */
export function StatusPanel() {
  const { manifest, status, metrics, recent, connected } = useInstance();
  const address = useServerAddress(manifest.port);
  const uptime = useUptime(status.startedAt);
  const cores = useHostCores();
  const live = status.state === "running" || status.state === "starting" || status.state === "stopping";
  const m = live ? metrics : null;
  const tps = hasTps(manifest.software);
  const plot = useMemo(() => recent.map((p) => ({ ...p, cpuHost: hostShare(p.cpu, cores) })), [recent, cores]);
  const players = live ? status.players : [];
  const metricsHref = instanceHref(manifest.id, "metrics");

  const cpuValue = m ? `${hostShare(m.cpu, cores).toFixed(0)}%` : "—";
  const ramValue = m ? `${compact(m.memRss)} / ${compact(manifest.memoryMb * 1048576)}` : "—";
  const tpsValue = live && status.tps ? status.tps[0].toFixed(1) : "—";

  const trend = (label: string, value: string, keys: string[], domain: readonly [number, number]) => (
    <div className="grid gap-2">
      <Fact label={label}>{value}</Fact>
      {live && <Sparkline data={plot} keys={keys} domain={domain} className="h-12" />}
      <SectionLink href={metricsHref}>Metrics</SectionLink>
    </div>
  );

  return (
    <div className="grid gap-0.5 rounded-lg border border-sidebar-border bg-sidebar-accent/30 p-1">
      <Figure
        icon={
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              stateDot[status.state],
              !connected && "animate-pulse opacity-50",
            )}
          />
        }
        label={<span className="text-sidebar-foreground capitalize">{connected ? status.state : "reconnecting…"}</span>}
        value={live ? uptime : undefined}
        title="State and uptime"
      >
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">{manifest.name}</span>
            <StateBadge state={status.state} />
          </div>
          {!connected && <p className="text-xs text-muted-foreground">Reconnecting to wardend…</p>}
          <Fact label="Address">
            <CopyButton value={address} label={address} showLabel className="-mr-2 h-6 font-mono text-xs" />
          </Fact>
          <Fact label="Uptime">{live ? uptime : "—"}</Fact>
          <Fact label="PID">{status.pid ?? "—"}</Fact>
          {status.startedAt && <Fact label="Started">{formatWhen(status.startedAt)}</Fact>}
        </div>
      </Figure>
      <div aria-hidden className="mx-1 my-0.5 h-px bg-sidebar-border" />
      <Figure icon={<Users />} label="Players" value={String(players.length)} title="Players online">
        <div className="grid gap-2">
          <span className="text-xs text-muted-foreground">Players online · {players.length}</span>
          {players.length > 0 ? (
            <ul className="grid gap-1">
              {players.map((p) => (
                <li key={p}>
                  <PlayerName name={p} faceClassName="size-5" className="gap-2" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">Nobody online.</p>
          )}
          <SectionLink href={instanceHref(manifest.id, "players")}>All players</SectionLink>
        </div>
      </Figure>
      {tps && (
        <Figure icon={<Gauge />} label="TPS" value={tpsValue} title="Ticks per second">
          {trend("TPS", tpsValue, ["tps"], tpsDomain(recent))}
        </Figure>
      )}
      <Figure
        icon={<Cpu />}
        label="CPU"
        value={cpuValue}
        title={cores ? `CPU, share of ${cores} cores` : "CPU, share of the host"}
      >
        {trend("CPU", cpuValue, ["cpuHost"], CPU_DOMAIN)}
      </Figure>
      <Figure
        icon={<MemoryStick />}
        label="RAM"
        value={ramValue}
        title="Resident memory of the Java process, and the heap limit"
      >
        {trend("RAM", ramValue, ["memMb"], [0, memCeiling(manifest.memoryMb)])}
      </Figure>
    </div>
  );
}

/** One row of the panel — icon and name, value on the right — that opens its popover beside the sidebar. */
function Figure({
  icon,
  label,
  value,
  title,
  className,
  children,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  value?: string;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger
        title={title}
        className={cn(
          "flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs text-sidebar-foreground/70 outline-none",
          "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          "data-[popup-open]:bg-sidebar-accent [&_svg]:size-3.5 [&_svg]:shrink-0",
          className,
        )}
      >
        {icon}
        <span className="truncate">{label}</span>
        {value && <span className={cn(mono, "ml-auto truncate text-sidebar-foreground tabular-nums")}>{value}</span>}
      </PopoverTrigger>
      <PopoverContent side="right" align="end" sideOffset={8} className="w-64">
        {children}
      </PopoverContent>
    </Popover>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(mono, "truncate tabular-nums")}>{children}</span>
    </div>
  );
}

function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-xs text-primary underline-offset-4 hover:underline">
      {children} →
    </Link>
  );
}
