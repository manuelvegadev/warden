"use client";

import { ArrowDownUp, Cpu, Gauge, MemoryStick } from "lucide-react";
import { useMemo } from "react";
import { Sparkline } from "@/components/instance/sparkline";
import { StatTile } from "@/components/stat-tile";
import { useHostCores } from "@/hooks/use-host-cores";
import type { MetricPoint } from "@/hooks/use-metrics-history";
import type { InstanceState, MetricSample } from "@/lib/api";
import { CPU_DOMAIN, hostShare, memCeiling, netCeiling, tpsDomain } from "@/lib/metrics-axis";

const compact = (n: number) => {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(1)}G`;
  if (n >= 1 << 20) return `${Math.round(n / (1 << 20))}M`;
  if (n >= 1024) return `${Math.round(n / 1024)}K`;
  return `${n}`;
};

const rate = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)}M` : `${Math.round(n / 1024)}K`);

type Tile = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  detail?: string;
  keys?: string[];
  /** The vertical range, from lib/metrics-axis.ts — the same one the full chart uses. */
  domain?: readonly [number, number];
};

export function ResourceCards({
  metrics,
  history,
  state,
  tps,
  memoryMb,
}: {
  metrics: MetricSample | null;
  /** Recent samples only (a few minutes): the cards show the trend, the Metrics tab the hour. */
  history: MetricPoint[];
  state: InstanceState;
  tps?: [number, number, number];
  memoryMb: number;
}) {
  const live = state === "running" || state === "starting" || state === "stopping";
  const m = live ? metrics : null;
  const cores = useHostCores();
  // Every tile is drawn against the same range as its full chart in the Metrics tab, so the shape
  // of the miniature means the same thing as the shape of the big one.
  const plot = useMemo(() => history.map((p) => ({ ...p, cpuHost: hostShare(p.cpu, cores) })), [history, cores]);
  const tiles: Tile[] = [
    {
      label: "CPU",
      icon: Cpu,
      // Of the whole host when the core count is known; the raw per-core figure stays in the detail.
      value: m ? `${hostShare(m.cpu, cores).toFixed(1)} %` : "—",
      detail: m && cores ? `${(m.cpu / 100).toFixed(2)} of ${cores} cores` : undefined,
      keys: ["cpuHost"],
      domain: CPU_DOMAIN,
    },
    {
      // Resident memory of the Java process; the heap limit (-Xmx) is only part of it.
      label: "RAM",
      icon: MemoryStick,
      value: m ? compact(m.memRss) : "—",
      detail: `heap max ${compact(memoryMb * 1048576)}`,
      keys: ["memMb"],
      domain: [0, memCeiling(memoryMb)] as const,
    },
    {
      label: "Network",
      icon: ArrowDownUp,
      value: m ? `↓${rate(m.netRx)} ↑${rate(m.netTx)}/s` : "—",
      keys: ["rxKb", "txKb"],
      domain: [0, netCeiling(history)] as const,
    },
    {
      label: "TPS",
      icon: Gauge,
      value: live && tps ? tps[0].toFixed(1) : "—",
      keys: ["tps"],
      domain: tpsDomain(history),
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {tiles.map((c) => (
        <StatTile key={c.label} label={c.label} icon={c.icon} value={c.value} detail={c.detail} className="h-28">
          {/* sparkline under a gradient scrim — opaque behind the text, transparent at the bottom */}
          {c.keys && c.domain && live && (
            <Sparkline
              data={plot}
              keys={c.keys}
              domain={c.domain}
              className="pointer-events-none absolute inset-x-0 bottom-0 h-14"
            />
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-card via-card/80 to-card/10" />
        </StatTile>
      ))}
    </div>
  );
}
