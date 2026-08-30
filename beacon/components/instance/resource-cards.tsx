"use client";

import { ArrowDownUp, Cpu, Gauge, MemoryStick } from "lucide-react";
import { useEffect, useState } from "react";
import { Sparkline } from "@/components/instance/sparkline";
import { StatTile } from "@/components/stat-tile";
import type { MetricPoint } from "@/hooks/use-metrics-history";
import { type InstanceState, type MetricSample, system } from "@/lib/api";

// Host core count, fetched once per page load: the daemon reports CPU as % of one core (like
// top), which reads as "150 %" without it.
let hostCores: number | null = null;
function useHostCores() {
  const [cores, setCores] = useState(hostCores);
  useEffect(() => {
    if (hostCores) return;
    system.get().then(
      (s) => {
        hostCores = s.cpuCores || null;
        setCores(hostCores);
      },
      () => {},
    );
  }, []);
  return cores;
}

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
  keys?: (keyof MetricPoint)[];
  max?: number;
  headroom?: number;
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
  const tiles: Tile[] = [
    {
      label: "CPU",
      icon: Cpu,
      // Of the whole host when the core count is known; the raw per-core figure stays in the detail.
      value: m ? `${(cores ? m.cpu / cores : m.cpu).toFixed(1)} %` : "—",
      detail: m && cores ? `${(m.cpu / 100).toFixed(2)} of ${cores} cores` : undefined,
      keys: ["cpu"],
    },
    {
      // Resident memory of the Java process; the heap limit (-Xmx) is only part of it.
      label: "RAM",
      icon: MemoryStick,
      value: m ? compact(m.memRss) : "—",
      detail: `heap max ${compact(memoryMb * 1048576)}`,
      keys: ["memMb"],
      headroom: 2.5,
    },
    {
      label: "Network",
      icon: ArrowDownUp,
      value: m ? `↓${rate(m.netRx)} ↑${rate(m.netTx)}/s` : "—",
      keys: ["rxKb", "txKb"],
    },
    { label: "TPS", icon: Gauge, value: live && tps ? tps[0].toFixed(1) : "—", keys: ["tps"], max: 20 },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {tiles.map((c) => (
        <StatTile key={c.label} label={c.label} icon={c.icon} value={c.value} detail={c.detail} className="h-28">
          {/* sparkline under a gradient scrim — opaque behind the text, transparent at the bottom */}
          {c.keys && live && (
            <Sparkline
              data={history}
              keys={c.keys}
              max={c.max}
              headroom={c.headroom}
              className="pointer-events-none absolute inset-x-0 bottom-0 h-14"
            />
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-card via-card/80 to-card/10" />
        </StatTile>
      ))}
    </div>
  );
}
