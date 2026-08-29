"use client";

import { ArrowDownUp, Cpu, Gauge, MemoryStick } from "lucide-react";
import { Sparkline } from "@/components/instance/sparkline";
import { StatTile } from "@/components/stat-tile";
import type { MetricPoint } from "@/hooks/use-metrics-history";
import type { InstanceState, MetricSample } from "@/lib/api";

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
  keys?: (keyof MetricPoint)[];
  max?: number;
};

export function ResourceCards({
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
}) {
  const live = state === "running" || state === "starting" || state === "stopping";
  const m = live ? metrics : null;
  const tiles: Tile[] = [
    { label: "CPU", icon: Cpu, value: m ? `${m.cpu.toFixed(1)} %` : "—", keys: ["cpu"] },
    {
      label: "RAM",
      icon: MemoryStick,
      value: m ? `${compact(m.memRss)}/${compact(m.memMax)}` : "—",
      keys: ["memMb"],
      max: memoryMb,
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
        <StatTile key={c.label} label={c.label} icon={c.icon} value={c.value} className="h-28">
          {/* sparkline under a gradient scrim — opaque behind the text, transparent at the bottom */}
          {c.keys && live && (
            <Sparkline
              data={history}
              keys={c.keys}
              max={c.max}
              className="pointer-events-none absolute inset-x-0 bottom-0 h-14"
            />
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-card via-card/80 to-card/10" />
        </StatTile>
      ))}
    </div>
  );
}
