"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@warden/ui/components/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@warden/ui/components/chart";
import { cn } from "@warden/ui/lib/utils";
import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { DetachControls } from "@/components/instance/detach-controls";
import { SERIES_1, SERIES_2 } from "@/components/instance/sparkline";
import { useDetachable } from "@/hooks/use-detachable";
import { useHostCores } from "@/hooks/use-host-cores";
import type { MetricPoint } from "@/hooks/use-metrics-history";
import { formatBytes } from "@/lib/api";
import {
  axisUnit,
  CPU_DOMAIN,
  hostShare,
  memCeiling,
  netCeiling,
  quarterTicks,
  TPS_FLOOR,
  tpsDomain,
} from "@/lib/metrics-axis";

// Threshold annotations, not series: docs/design.md reserves amber/red for state and forbids
// recolouring marks with them. Validated against the dark surface — amber sits above the
// categorical lightness band on purpose (it is an annotation, not a peer of the data), and the pair
// clears CVD separation (ΔE 13.9 deutan, 19.8 normal). Every line carries a text label too, so the
// meaning never rests on colour alone.
const WARN = "#f59e0b";
const CRIT = "#ef4444";

/** A horizontal limit line with its own label, so the reader knows what the colour means. */
function Threshold({ y, color, label, side }: { y: number; color: string; label: string; side?: "left" }) {
  return (
    <ReferenceLine
      y={y}
      stroke={color}
      strokeDasharray="4 4"
      strokeOpacity={0.9}
      label={{
        value: label,
        // Two lines close together would print their labels on top of each other in one corner.
        position: side === "left" ? "insideTopLeft" : "insideTopRight",
        fill: color,
        fontSize: 10,
      }}
    />
  );
}

const yLabel = (value: string) => ({
  value,
  angle: -90 as const,
  position: "insideLeft" as const,
  style: { fontSize: 10, fill: "var(--muted-foreground)", textAnchor: "middle" as const },
});

const timeFmt = (v: number | string) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const timeFmtFull = (v: number | string) => new Date(v).toLocaleTimeString();
// The tooltip label is the formatted tick text ("02:20 AM"), not the epoch; read the time off the point.
const tooltipTime = (_label: unknown, payload: readonly { payload?: { t?: number } }[]) =>
  timeFmtFull(payload[0]?.payload?.t ?? NaN);

/**
 * One hour of samples: history from the daemon on mount, then live samples appended. Detachable the
 * same way the console is — full screen, or a pop-out window to leave on a second monitor.
 */
export function MetricsChart({
  data,
  memoryMb,
  instanceId,
  popout,
}: {
  data: MetricPoint[];
  memoryMb: number;
  instanceId: string;
  popout?: boolean;
}) {
  const { rootRef, fullscreen, toggleFullscreen, openPopout, fillHeight, showPopout } = useDetachable(
    `/metrics/${instanceId}`,
    `beacon-metrics-${instanceId}`,
    popout,
  );

  const memMax = memoryMb || data[data.length - 1]?.memMaxMb || 0;
  const single = (label: string, color: string): ChartConfig => ({ v: { label, color } });

  // The daemon reports CPU as a percentage of one core; the header tile divides by the core count
  // and the chart used not to, so the same instant read 300 in one place and 25 in the other.
  const cores = useHostCores();
  const cpuData = useMemo(() => data.map((p) => ({ ...p, cpuHost: hostShare(p.cpu, cores) })), [data, cores]);

  const tpsWindow = useMemo(() => tpsDomain(data), [data]);
  const tpsFloor = tpsWindow[0];

  const memTop = memCeiling(memMax);
  const memUnit = axisUnit(memTop, "MB");
  const memTicks = quarterTicks(memTop);
  const netTop = useMemo(() => netCeiling(data), [data]);
  const netUnit = axisUnit(netTop, "KB");
  // Filling the screen is only worth it if the panels grow with it.
  const chartClass = fillHeight ? "h-full min-h-40 w-full" : "h-40 w-full";

  return (
    <div ref={rootRef} className={cn("flex flex-col gap-2", fillHeight && "h-full", fullscreen && "bg-background p-3")}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Last hour · sampled every 2s</span>
        <div className="flex items-center gap-1">
          <DetachControls
            label="metrics"
            fullscreen={fullscreen}
            showPopout={showPopout}
            onPopout={openPopout}
            onToggleFullscreen={toggleFullscreen}
          />
        </div>
      </div>
      {data.length < 2 ? (
        <p className="py-6 text-sm text-muted-foreground">
          Metrics appear once the server has been running for a moment.
        </p>
      ) : (
        <div className={cn("grid gap-4 sm:grid-cols-2", fillHeight && "min-h-0 flex-1 sm:grid-rows-2")}>
          <Panel title="CPU" subtitle={cores ? `share of ${cores} cores` : "share of the host"}>
            <ChartContainer config={single("CPU", SERIES_1)} className={chartClass}>
              <AreaChart data={cpuData} margin={{ left: 4, right: 4, top: 8 }}>
                <CartesianGrid vertical={false} strokeOpacity={0.25} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={timeFmt}
                  minTickGap={48}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  width={48}
                  tickLine={false}
                  axisLine={false}
                  // A share of the whole host cannot exceed 100, so the scale is absolute: the same
                  // shape always means the same load, and an idle server looks idle.
                  domain={CPU_DOMAIN}
                  ticks={[0, 25, 50, 75, 100]}
                  label={yLabel("% of host")}
                />
                <ChartTooltip
                  content={<ChartTooltipContent labelFormatter={tooltipTime} formatter={(v) => [`${v} %`, "CPU"]} />}
                />
                <Threshold y={90} color={CRIT} label="saturated" />
                <Threshold y={75} color={WARN} label="busy" side="left" />
                <Area
                  dataKey="cpuHost"
                  type="monotone"
                  stroke={SERIES_1}
                  strokeWidth={2}
                  fill={SERIES_1}
                  fillOpacity={0.12}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ChartContainer>
          </Panel>

          <Panel
            title="Memory"
            subtitle={`Resident memory of the Java process · heap max ${formatBytes(memMax * 1048576)}`}
          >
            <ChartContainer config={single("Memory", SERIES_1)} className={chartClass}>
              <AreaChart data={data} margin={{ left: 4, right: 4, top: 8 }}>
                <CartesianGrid vertical={false} strokeOpacity={0.25} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={timeFmt}
                  minTickGap={48}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  width={52}
                  tickLine={false}
                  axisLine={false}
                  // Twice the heap limit is the resting scale: RSS legitimately sits above -Xmx
                  // (metaspace, GC structures, native buffers) but rarely doubles it. The bound is a
                  // floor rather than a cap, so a genuine runaway is still drawn instead of clipped.
                  domain={[0, (max: number) => Math.max(memTop, max)]}
                  ticks={memTicks}
                  tickFormatter={memUnit.format}
                  label={yLabel(memUnit.label)}
                />
                <ChartTooltip
                  content={<ChartTooltipContent labelFormatter={tooltipTime} formatter={(v) => [`${v} MB`, "RSS"]} />}
                />
                {memMax > 0 && <Threshold y={memMax} color={WARN} label="heap max" side="left" />}
                <Area
                  dataKey="memMb"
                  type="monotone"
                  stroke={SERIES_1}
                  strokeWidth={2}
                  fill={SERIES_1}
                  fillOpacity={0.12}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ChartContainer>
          </Panel>

          <Panel title="TPS" subtitle="server tick rate · 20 is healthy">
            <ChartContainer config={single("TPS", SERIES_1)} className={chartClass}>
              <LineChart data={data} margin={{ left: 4, right: 4, top: 8 }}>
                <CartesianGrid vertical={false} strokeOpacity={0.25} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={timeFmt}
                  minTickGap={48}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  width={48}
                  tickLine={false}
                  axisLine={false}
                  // 20 is the tick rate Minecraft targets; there is no "above 20", so the scale is
                  // absolute and the distance to the ceiling is the whole story.
                  domain={tpsWindow}
                  ticks={tpsFloor === 0 ? [0, 5, 10, 15, 20] : [15, 16, 17, 18, 19, 20]}
                  label={yLabel("ticks/s")}
                />
                <ChartTooltip
                  content={<ChartTooltipContent labelFormatter={tooltipTime} formatter={(v) => [String(v), "TPS"]} />}
                />
                <Threshold y={18} color={WARN} label="lagging" side="left" />
                {/* At the windowed floor this line would just trace the baseline. */}
                {tpsFloor === 0 && <Threshold y={TPS_FLOOR} color={CRIT} label="unplayable" />}
                <Line
                  dataKey="tps"
                  type="monotone"
                  stroke={SERIES_1}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartContainer>
          </Panel>

          <Panel title="Network" subtitle="all host interfaces, not just this server">
            <ChartContainer
              config={{ rxKb: { label: "In", color: SERIES_1 }, txKb: { label: "Out", color: SERIES_2 } }}
              className={chartClass}
            >
              <LineChart data={data} margin={{ left: 4, right: 4, top: 8 }}>
                <CartesianGrid vertical={false} strokeOpacity={0.25} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={timeFmt}
                  minTickGap={48}
                  tickLine={false}
                  axisLine={false}
                />
                {/* Explicit domain: left to itself the axis picks up the epoch `t` column and prints nonsense. */}
                <YAxis
                  width={52}
                  tickLine={false}
                  axisLine={false}
                  // Throughput has no meaningful ceiling — a link is as fast as it is — so this one
                  // keeps a floor instead of a fixed maximum: 512 KB/s of headroom stops an idle
                  // server's noise from being magnified into mountains, and real traffic still fits.
                  domain={[0, netTop]}
                  ticks={quarterTicks(netTop)}
                  tickFormatter={netUnit.format}
                  label={yLabel(`${netUnit.label}/s`)}
                />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={tooltipTime} />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Line
                  dataKey="rxKb"
                  type="monotone"
                  stroke={SERIES_1}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="txKb"
                  type="monotone"
                  stroke={SERIES_2}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartContainer>
          </Panel>
        </div>
      )}
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <Card className="min-h-0">
      <CardHeader className="pb-0">
        <CardTitle className="text-sm font-medium">
          {title} <span className="ml-1 font-normal text-muted-foreground">{subtitle}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 pt-2">{children}</CardContent>
    </Card>
  );
}
