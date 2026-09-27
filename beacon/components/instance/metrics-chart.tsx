"use client";

import { Button } from "@warden/ui/components/button";
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
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, XAxis, YAxis } from "recharts";
import { DetachControls } from "@/components/instance/detach-controls";
import { useInstance } from "@/components/instance/instance-context";
import { SERIES_1, SERIES_2 } from "@/components/instance/sparkline";
import { type DisplayMode, useDetachable } from "@/hooks/use-detachable";
import { useHostCores } from "@/hooks/use-host-cores";
import type { MetricPoint } from "@/hooks/use-metrics-history";
import { useMetricsRange } from "@/hooks/use-metrics-range";
import { formatBytes, hasTps } from "@/lib/api";
import {
  axisUnit,
  breakAtGaps,
  bucketMs,
  CPU_DOMAIN,
  gapsIn,
  holdTps,
  hostShare,
  isMetricsRange,
  METRICS_RANGES,
  type MetricsRange,
  memCeiling,
  netCeiling,
  nextPowerOfTwo,
  quarterTicks,
  RANGE_MS,
  TPS_FLOOR,
  timeTicks,
  tpsDomain,
} from "@/lib/metrics-axis";
import { METRIC_KINDS, type MetricKind } from "@/lib/metrics-kinds";

// Threshold annotations, not series: docs/design.md reserves amber/red for state and forbids
// recolouring marks with them. Validated against the dark surface — amber sits above the
// categorical lightness band on purpose (it is an annotation, not a peer of the data), and the pair
// clears CVD separation (ΔE 13.9 deutan, 19.8 normal). Every line carries a text label too, so the
// meaning never rests on colour alone.
const WARN = "#f59e0b";
const CRIT = "#ef4444";
// The charts share one crosshair: hovering a time in one shows it in all of them.
const SYNC_ID = "instance-metrics";

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

const RANGE_LABEL: Record<MetricsRange, string> = {
  "15m": "Last 15 minutes",
  "1h": "Last hour",
  "6h": "Last 6 hours",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
};

/** Ticks read the time of day, or the date once the window spans days. */
const tickFormat = (range: MetricsRange) =>
  range === "7d"
    ? (v: number) => new Date(v).toLocaleDateString([], { month: "short", day: "numeric" })
    : (v: number) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
// The tooltip label is the formatted tick text, not the epoch; read the time off the point.
const tooltipTime = (_label: unknown, payload: readonly { payload?: { t?: number } }[]) => {
  const t = payload[0]?.payload?.t;
  return t === undefined
    ? ""
    : new Date(t).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
};

type Plot = MetricPoint & { cpuHost: number; cpuPeakHost?: number };

/**
 * The Metrics section and its pop-out: the range from the URL (`?range=`, one hour by default),
 * the series from the daemon bucketed to fit the charts, re-read as new buckets appear.
 */
export function MetricsView({ mode = "section" }: { mode?: DisplayMode }) {
  const { manifest } = useInstance();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const fromUrl = params.get("range");
  const [range, setRange] = useState<MetricsRange>(isMetricsRange(fromUrl) ? fromUrl : "1h");
  const { points, end } = useMetricsRange(manifest.id, range);

  const pick = (r: MetricsRange) => {
    setRange(r);
    const next = new URLSearchParams(params);
    next.set("range", r);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  return (
    <MetricsChart
      data={points}
      end={end}
      range={range}
      onRange={pick}
      memoryMb={manifest.memoryMb}
      instanceId={manifest.id}
      tps={hasTps(manifest.software)}
      mode={mode}
    />
  );
}

/** The Metrics of the instance in context with the range and charts given by the caller (a dashboard module). */
export function MetricsPanel({
  range,
  onRange,
  charts,
  mode = "fill",
}: {
  range: MetricsRange;
  onRange: (range: MetricsRange) => void;
  charts: readonly MetricKind[];
  mode?: DisplayMode;
}) {
  const { manifest } = useInstance();
  const { points, end } = useMetricsRange(manifest.id, range);
  return (
    <MetricsChart
      data={points}
      end={end}
      range={range}
      onRange={onRange}
      memoryMb={manifest.memoryMb}
      instanceId={manifest.id}
      tps={hasTps(manifest.software)}
      mode={mode}
      charts={charts}
    />
  );
}

/**
 * CPU, memory, TPS, players, disk and host network over a range, one bucket per point: the average
 * drawn, the peak shaded behind it, stretches when the server was off shaded and left as gaps, and
 * one crosshair across every chart. Detachable the same way the console is — full screen, or a
 * pop-out window to leave on a second monitor.
 */
export function MetricsChart({
  data,
  end,
  range,
  onRange,
  memoryMb,
  instanceId,
  mode = "section",
  tps = true,
  charts = METRIC_KINDS,
}: {
  /** Null while the range loads. */
  data: MetricPoint[] | null;
  /** The end of the window, the time of the last read. */
  end: number;
  range: MetricsRange;
  onRange: (range: MetricsRange) => void;
  memoryMb: number;
  instanceId: string;
  mode?: DisplayMode;
  /** Off for software that has no tick rate to report (Vanilla, Fabric). */
  tps?: boolean;
  /** Which charts to render (default: all). TPS is still gated by `tps` even when listed here. */
  charts?: readonly MetricKind[];
}) {
  const { rootRef, fullscreen, toggleFullscreen, openPopout, fillHeight, showPopout } = useDetachable(
    `/metrics/${instanceId}`,
    `beacon-metrics-${instanceId}`,
    mode,
  );
  const inPlace = mode === "section" && !fillHeight;
  const shown = new Set(charts.filter((k) => k !== "tps" || tps));

  const points = data ?? [];
  const memMax = memoryMb || points[points.length - 1]?.memMaxMb || 0;
  const single = (label: string, color: string): ChartConfig => ({ v: { label, color } });

  // The daemon reports CPU as a percentage of one core; the header tile divides by the core count
  // and the chart used not to, so the same instant read 300 in one place and 25 in the other.
  const cores = useHostCores();
  const windowStart = end - RANGE_MS[range];
  const step = bucketMs(RANGE_MS[range]);
  const gaps = useMemo(() => gapsIn(points, step, end), [points, step, end]);
  const plot = useMemo(
    () =>
      breakAtGaps<Plot>(
        holdTps(points).map((p) => ({
          ...p,
          cpuHost: hostShare(p.cpu, cores),
          ...(p.cpuPeak !== undefined && { cpuPeakHost: hostShare(p.cpuPeak, cores) }),
        })),
        gaps,
      ),
    [points, cores, gaps],
  );

  const tpsWindow = useMemo(() => tpsDomain(points.map((p) => ({ tps: p.tpsLow ?? p.tps }))), [points]);
  const tpsFloor = tpsWindow[0];
  const memTop = memCeiling(memMax);
  const memUnit = axisUnit(memTop, "MB");
  const memTicks = quarterTicks(memTop);
  const netTop = useMemo(() => netCeiling(points), [points]);
  const netUnit = axisUnit(netTop, "KB");
  // A round ceiling above the directory's size, so a size that barely changes reads as a line, not a block.
  const diskTop = useMemo(() => nextPowerOfTwo(Math.max(...points.map((p) => p.diskMb)) * 1.25, 64), [points]);
  const diskUnit = axisUnit(diskTop, "MB");
  const playersTop = useMemo(() => Math.max(4, ...points.map((p) => p.players)), [points]);
  const hasPeaks = points.some((p) => p.cpuPeak !== undefined);

  // Filling the screen is only worth it if the panels grow with it.
  const chartClass = fillHeight
    ? "h-full min-h-32 w-full"
    : inPlace
      ? "h-40 w-full sm:h-full sm:min-h-32"
      : "h-40 w-full";

  // What every chart shares: the time axis over the whole window, the stopped stretches, the crosshair.
  const common = { data: plot, margin: { left: 4, right: 4, top: 8 }, syncId: SYNC_ID };
  const timeAxis = (
    <XAxis
      dataKey="t"
      type="number"
      scale="time"
      domain={[windowStart, end]}
      ticks={timeTicks(windowStart, end, range)}
      tickFormatter={tickFormat(range)}
      minTickGap={24}
      tickLine={false}
      axisLine={false}
      allowDataOverflow
    />
  );
  const stopped = gaps.map((g) => (
    <ReferenceArea
      key={g.from}
      x1={Math.max(g.from, windowStart)}
      x2={g.to}
      fill="var(--muted-foreground)"
      fillOpacity={0.08}
      ifOverflow="hidden"
    />
  ));
  const grid = <CartesianGrid vertical={false} strokeOpacity={0.25} />;

  return (
    <div
      ref={rootRef}
      className={cn(
        "flex flex-col gap-2",
        fillHeight && "h-full",
        inPlace && "sm:min-h-0 sm:flex-1",
        fullscreen && "bg-background p-3",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <fieldset className="flex rounded-md border p-0.5">
            <legend className="sr-only">Range</legend>
            {METRICS_RANGES.map((r) => (
              <Button
                key={r}
                size="sm"
                variant={r === range ? "secondary" : "ghost"}
                className="h-7 px-2"
                aria-pressed={r === range}
                title={RANGE_LABEL[r]}
                onClick={() => onRange(r)}
              >
                {r}
              </Button>
            ))}
          </fieldset>
          <span className="text-xs text-muted-foreground @max-lg:hidden">
            {RANGE_LABEL[range]}
            {hasPeaks && " · line the average, shade the peak"}
            {gaps.length > 0 && " · grey where the server was not running"}
          </span>
        </div>
        <div className="flex items-center">
          <DetachControls
            label="metrics"
            fullscreen={fullscreen}
            showPopout={showPopout}
            onPopout={openPopout}
            onToggleFullscreen={toggleFullscreen}
          />
        </div>
      </div>
      {data === null ? (
        <p className="py-6 text-sm text-muted-foreground">Loading…</p>
      ) : points.length < 2 ? (
        <p className="py-6 text-sm text-muted-foreground">
          No samples in this range yet: metrics are recorded while the server runs.
        </p>
      ) : shown.size === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">This server's software doesn't report TPS.</p>
      ) : (
        <div
          className={cn(
            // As many columns as there are charts, up to three: a module showing two never leaves a
            // third column empty beside them.
            "grid gap-4",
            shown.size > 1 && "@md:grid-cols-2",
            shown.size > 2 && "@5xl:grid-cols-3",
            // auto-rows-fr (not a fixed row count): a Metrics module can show as few as one chart, and
            // a fixed `grid-rows-N` would leave it filling only a fraction of the panel's height.
            (fillHeight || inPlace) && "sm:min-h-0 sm:flex-1 @md:auto-rows-fr",
            fillHeight && "min-h-0 flex-1",
          )}
        >
          {shown.has("cpu") && (
            <Panel title="CPU" subtitle={cores ? `share of ${cores} cores` : "share of the host"}>
              <ChartContainer
                config={{ cpuHost: { label: "CPU", color: SERIES_1 }, cpuPeakHost: { label: "Peak", color: SERIES_1 } }}
                className={chartClass}
              >
                <AreaChart {...common}>
                  {grid}
                  {timeAxis}
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
                    content={<ChartTooltipContent labelFormatter={tooltipTime} formatter={(v, n) => [`${v} %`, n]} />}
                  />
                  {stopped}
                  <Threshold y={90} color={CRIT} label="saturated" />
                  <Threshold y={75} color={WARN} label="busy" side="left" />
                  {hasPeaks && (
                    <Area
                      dataKey="cpuPeakHost"
                      name="Peak"
                      type="monotone"
                      stroke="none"
                      fill={SERIES_1}
                      fillOpacity={0.12}
                      isAnimationActive={false}
                    />
                  )}
                  <Area
                    dataKey="cpuHost"
                    name="CPU"
                    type="monotone"
                    stroke={SERIES_1}
                    strokeWidth={2}
                    fill={SERIES_1}
                    fillOpacity={hasPeaks ? 0 : 0.12}
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ChartContainer>
            </Panel>
          )}

          {shown.has("memory") && (
            <Panel title="Memory" subtitle={`Java process · heap max ${formatBytes(memMax * 1048576)}`}>
              <ChartContainer
                config={{ memMb: { label: "RSS", color: SERIES_1 }, memPeakMb: { label: "Peak", color: SERIES_1 } }}
                className={chartClass}
              >
                <AreaChart {...common}>
                  {grid}
                  {timeAxis}
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
                    content={<ChartTooltipContent labelFormatter={tooltipTime} formatter={(v, n) => [`${v} MB`, n]} />}
                  />
                  {stopped}
                  {memMax > 0 && <Threshold y={memMax} color={WARN} label="heap max" side="left" />}
                  {hasPeaks && (
                    <Area
                      dataKey="memPeakMb"
                      name="Peak"
                      type="monotone"
                      stroke="none"
                      fill={SERIES_1}
                      fillOpacity={0.12}
                      isAnimationActive={false}
                    />
                  )}
                  <Area
                    dataKey="memMb"
                    name="RSS"
                    type="monotone"
                    stroke={SERIES_1}
                    strokeWidth={2}
                    fill={SERIES_1}
                    fillOpacity={hasPeaks ? 0 : 0.12}
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ChartContainer>
            </Panel>
          )}

          {shown.has("tps") && (
            <Panel title="TPS" subtitle="server tick rate · 20 is healthy">
              <ChartContainer
                config={{ tps: { label: "TPS", color: SERIES_1 }, tpsLow: { label: "Lowest", color: SERIES_1 } }}
                className={chartClass}
              >
                <LineChart {...common}>
                  {grid}
                  {timeAxis}
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
                    content={<ChartTooltipContent labelFormatter={tooltipTime} formatter={(v, n) => [String(v), n]} />}
                  />
                  {stopped}
                  <Threshold y={18} color={WARN} label="lagging" side="left" />
                  {/* At the windowed floor this line would just trace the baseline. */}
                  {tpsFloor === 0 && <Threshold y={TPS_FLOOR} color={CRIT} label="unplayable" />}
                  {hasPeaks && (
                    <Line
                      dataKey="tpsLow"
                      name="Lowest"
                      type="monotone"
                      stroke={SERIES_1}
                      strokeOpacity={0.35}
                      strokeWidth={1}
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}
                  <Line
                    dataKey="tps"
                    name="TPS"
                    type="monotone"
                    stroke={SERIES_1}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ChartContainer>
            </Panel>
          )}

          {shown.has("players") && (
            <Panel title="Players" subtitle={hasPeaks ? "most online in each step" : "online"}>
              <ChartContainer config={single("Players", SERIES_1)} className={chartClass}>
                <LineChart {...common}>
                  {grid}
                  {timeAxis}
                  <YAxis
                    width={48}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                    domain={[0, playersTop]}
                    label={yLabel("players")}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent labelFormatter={tooltipTime} formatter={(v) => [String(v), "Players"]} />
                    }
                  />
                  {stopped}
                  <Line
                    dataKey="players"
                    type="stepAfter"
                    stroke={SERIES_1}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ChartContainer>
            </Panel>
          )}

          {shown.has("disk") && (
            <Panel title="Disk" subtitle="size of the instance directory">
              <ChartContainer config={single("Disk", SERIES_1)} className={chartClass}>
                <AreaChart {...common}>
                  {grid}
                  {timeAxis}
                  <YAxis
                    width={52}
                    tickLine={false}
                    axisLine={false}
                    domain={[0, (max: number) => Math.max(diskTop, max)]}
                    ticks={quarterTicks(diskTop)}
                    tickFormatter={diskUnit.format}
                    label={yLabel(diskUnit.label)}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={tooltipTime}
                        formatter={(v) => [formatBytes(Number(v) * 1048576), "Disk"]}
                      />
                    }
                  />
                  {stopped}
                  <Area
                    dataKey="diskMb"
                    type="stepAfter"
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
          )}

          {shown.has("network") && (
            <Panel
              title="Host network"
              subtitle="all host interfaces, not just this server"
              // Network is always the last chart rendered when shown: span both columns when the
              // shown count is odd, so it never ends up alone at half width — whatever combination
              // of charts (all six here, or a subset chosen for a dashboard Metrics module) produced
              // that count.
              className={shown.size % 2 === 0 ? undefined : "@md:col-span-2"}
            >
              <ChartContainer
                config={{ rxKb: { label: "In", color: SERIES_1 }, txKb: { label: "Out", color: SERIES_2 } }}
                className={chartClass}
              >
                <LineChart {...common}>
                  {grid}
                  {timeAxis}
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
                  {stopped}
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
          )}
        </div>
      )}
    </div>
  );
}

function Panel({
  title,
  subtitle,
  className,
  children,
}: {
  title: string;
  subtitle: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("min-h-0", className)}>
      <CardHeader className="pb-0">
        <CardTitle className="text-sm font-medium">
          {title} <span className="ml-1 font-normal text-muted-foreground">{subtitle}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 pt-2">{children}</CardContent>
    </Card>
  );
}
