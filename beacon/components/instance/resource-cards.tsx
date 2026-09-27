"use client";

import { cn } from "@warden/ui/lib/utils";
import { ArrowDownUp, Cpu, Gauge, HardDrive, MemoryStick, Users } from "lucide-react";
import { useMemo } from "react";
import { Sparkline } from "@/components/instance/sparkline";
import { StatTile } from "@/components/stat-tile";
import { useHostCores } from "@/hooks/use-host-cores";
import type { MetricPoint } from "@/hooks/use-metrics-history";
import type { InstanceState, MetricSample } from "@/lib/api";
import { CPU_DOMAIN, hostShare, memCeiling, netCeiling, tpsDomain } from "@/lib/metrics-axis";

export const compact = (n: number) => {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(1)}G`;
  if (n >= 1 << 20) return `${Math.round(n / (1 << 20))}M`;
  if (n >= 1024) return `${Math.round(n / 1024)}K`;
  return `${n}`;
};

export const rate = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)}M` : `${Math.round(n / 1024)}K`);

/** The figures a resource tile can show, each with its trend. */
export type ResourceKind = "cpu" | "memory" | "network" | "tps" | "players" | "disk";

export type ResourceTileSpec = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  detail?: string;
  keys?: string[];
  /** The vertical range, from lib/metrics-axis.ts — the same one the full chart uses. */
  domain?: readonly [number, number];
};

/**
 * Every resource tile of an instance, from its latest sample and recent history — shared by the
 * Resources cards and the Overview's KPI strip, so a figure reads the same wherever it is shown.
 */
export function useResourceTiles({
  metrics,
  history,
  state,
  tps,
  memoryMb,
}: {
  metrics: MetricSample | null;
  history: MetricPoint[];
  state: InstanceState;
  tps?: [number, number, number];
  memoryMb: number;
}): { live: boolean; plot: Record<string, number | string | null>[]; tiles: Record<ResourceKind, ResourceTileSpec> } {
  const live = state === "running" || state === "starting" || state === "stopping";
  const m = live ? metrics : null;
  const cores = useHostCores();
  // Every tile is drawn against the same range as its full chart in the Metrics tab, so the shape
  // of the miniature means the same thing as the shape of the big one.
  const { plot, mostPlayers, mostDisk } = useMemo(
    () => ({
      plot: history.map((p) => ({ ...p, cpuHost: hostShare(p.cpu, cores) })),
      mostPlayers: history.reduce((n, p) => Math.max(n, p.players), 0),
      mostDisk: history.reduce((n, p) => Math.max(n, p.diskMb), 0),
    }),
    [history, cores],
  );
  const tiles: Record<ResourceKind, ResourceTileSpec> = {
    cpu: {
      label: "CPU",
      icon: Cpu,
      // Of the whole host when the core count is known; the raw per-core figure stays in the detail.
      value: m ? `${hostShare(m.cpu, cores).toFixed(1)} %` : "—",
      detail: m && cores ? `${(m.cpu / 100).toFixed(2)} of ${cores} cores` : undefined,
      keys: ["cpuHost"],
      domain: CPU_DOMAIN,
    },
    memory: {
      // Resident memory of the Java process; the heap limit (-Xmx) is only part of it.
      label: "RAM",
      icon: MemoryStick,
      value: m ? compact(m.memRss) : "—",
      detail: `heap max ${compact(memoryMb * 1048576)}`,
      keys: ["memMb"],
      domain: [0, memCeiling(memoryMb)] as const,
    },
    network: {
      // Every interface of the host: the daemon cannot tell this server's traffic from the rest.
      label: "Host network",
      icon: ArrowDownUp,
      value: m ? `↓${rate(m.netRx)} ↑${rate(m.netTx)}/s` : "—",
      keys: ["rxKb", "txKb"],
      domain: [0, netCeiling(history)] as const,
    },
    tps: {
      label: "TPS",
      icon: Gauge,
      value: live && tps ? tps[0].toFixed(1) : "—",
      keys: ["tps"],
      domain: tpsDomain(history),
    },
    players: {
      label: "Players",
      icon: Users,
      value: m ? String(m.players) : "—",
      detail: live && mostPlayers > 0 ? `peak ${mostPlayers} lately` : undefined,
      keys: ["players"],
      domain: [0, Math.max(mostPlayers, 1)] as const,
    },
    disk: {
      label: "Disk",
      icon: HardDrive,
      value: metrics ? compact(metrics.diskUsed) : "—",
      detail: "the instance's directory",
      keys: ["diskMb"],
      domain: [0, Math.max(mostDisk * 1.2, 1)] as const,
    },
  };
  return { live, plot, tiles };
}

/** One resource tile: the figure over its sparkline, the line fading out behind the text. */
export function ResourceTile({
  spec,
  plot,
  live,
  className,
}: {
  spec: ResourceTileSpec;
  plot: Record<string, number | string | null>[];
  live: boolean;
  className?: string;
}) {
  return (
    <StatTile
      label={spec.label}
      icon={spec.icon}
      value={spec.value}
      detail={spec.detail}
      className={cn("h-28", className)}
    >
      {/* sparkline under a gradient scrim — opaque behind the text, transparent at the bottom */}
      {spec.keys && spec.domain && live && (
        <Sparkline
          data={plot}
          keys={spec.keys}
          domain={spec.domain}
          className="pointer-events-none absolute inset-x-0 bottom-0 h-14"
        />
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-card via-card/80 to-card/10" />
    </StatTile>
  );
}

export function ResourceCards({
  metrics,
  history,
  state,
  tps,
  showTps = true,
  memoryMb,
}: {
  metrics: MetricSample | null;
  /** Recent samples only (a few minutes): the cards show the trend, the Metrics tab the hour. */
  history: MetricPoint[];
  state: InstanceState;
  tps?: [number, number, number];
  /** Off for software that has no tick rate to report (Vanilla, Fabric). */
  showTps?: boolean;
  memoryMb: number;
}) {
  const { live, plot, tiles } = useResourceTiles({ metrics, history, state, tps, memoryMb });
  const kinds: ResourceKind[] = showTps ? ["cpu", "memory", "network", "tps"] : ["cpu", "memory", "network"];
  return (
    <div className={cn("grid grid-cols-2 gap-3", showTps ? "@5xl:grid-cols-4" : "@5xl:grid-cols-3")}>
      {kinds.map((k) => (
        <ResourceTile key={k} spec={tiles[k]} plot={plot} live={live} />
      ))}
    </div>
  );
}
