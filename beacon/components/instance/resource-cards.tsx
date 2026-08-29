"use client";

import { ArrowDownUp, Cpu, Gauge, MemoryStick } from "lucide-react";
import { useEffect, useState } from "react";
import { Sparkline } from "@/components/instance/sparkline";
import { Card, CardContent } from "@/components/ui/card";
import type { MetricPoint } from "@/hooks/use-metrics-history";
import type { InstanceState, MetricSample } from "@/lib/api";
import { mono } from "@/lib/utils";

/** Client-only clock: computed after mount so SSR and hydration render the same placeholder. */
export function useUptime(startedAt?: string) {
  const [text, setText] = useState("—");
  useEffect(() => {
    if (!startedAt) {
      setText("—");
      return;
    }
    const tick = () => {
      const s = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      setText(h ? `${h}h ${m}m` : `${m}m ${s % 60}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return text;
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
        <Card key={c.label} className="relative h-28 overflow-hidden py-0">
          {/* layer 1: sparkline */}
          {c.keys && live && (
            <Sparkline
              data={history}
              keys={c.keys}
              max={c.max}
              className="pointer-events-none absolute inset-x-0 bottom-0 h-14"
            />
          )}
          {/* layer 2: gradient scrim — opaque at the top (behind the text), transparent at the bottom */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-card via-card/80 to-card/10" />
          {/* layer 3: text, aligned to the top */}
          <CardContent className="relative z-10 px-4 pt-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <c.icon className="size-3.5" aria-hidden />
              {c.label}
            </div>
            <div className={`mt-1 truncate text-base font-semibold tabular-nums ${mono}`} title={c.value}>
              {c.value}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
