"use client";

import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { SERIES_1, SERIES_2 } from "@/components/instance/sparkline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { MetricPoint } from "@/hooks/use-metrics-history";
import { formatBytes } from "@/lib/api";

const timeFmt = (v: number | string) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const timeFmtFull = (v: number | string) => new Date(v).toLocaleTimeString();

/** One hour of samples: history from the daemon on mount, then live samples appended. */
export function MetricsChart({ data, memoryMb }: { data: MetricPoint[]; memoryMb: number }) {
  if (data.length < 2) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        Metrics appear once the server has been running for a moment.
      </p>
    );
  }

  const memMax = memoryMb || data[data.length - 1]?.memMaxMb || 0;
  const single = (label: string, color: string): ChartConfig => ({ v: { label, color } });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Panel title="CPU" subtitle="% of one core">
        <ChartContainer config={single("CPU", SERIES_1)} className="h-40 w-full">
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
              width={36}
              tickLine={false}
              axisLine={false}
              domain={[0, (max: number) => Math.max(100, Math.ceil(max / 100) * 100)]}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(l) => timeFmtFull(Number(l))}
                  formatter={(v) => [`${v} %`, "CPU"]}
                />
              }
            />
            <Area
              dataKey="cpu"
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

      <Panel title="Memory" subtitle={`RSS · max ${formatBytes(memMax * 1048576)}`}>
        <ChartContainer config={single("Memory", SERIES_1)} className="h-40 w-full">
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
              width={44}
              tickLine={false}
              axisLine={false}
              domain={[0, Math.max(memMax, 1)]}
              tickFormatter={(v) => (v >= 1024 ? `${(v / 1024).toFixed(1)} GB` : `${v} MB`)}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(l) => timeFmtFull(Number(l))}
                  formatter={(v) => [`${v} MB`, "RSS"]}
                />
              }
            />
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

      <Panel title="TPS" subtitle="ticks per second (20 = healthy)">
        <ChartContainer config={single("TPS", SERIES_1)} className="h-40 w-full">
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
            <YAxis width={36} tickLine={false} axisLine={false} domain={[0, 20]} ticks={[0, 10, 20]} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(l) => timeFmtFull(Number(l))}
                  formatter={(v) => [String(v), "TPS"]}
                />
              }
            />
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

      <Panel title="Network" subtitle="host interfaces, KB/s">
        <ChartContainer
          config={{ rxKb: { label: "In", color: SERIES_1 }, txKb: { label: "Out", color: SERIES_2 } }}
          className="h-40 w-full"
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
            <YAxis width={44} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent labelFormatter={(l) => timeFmtFull(Number(l))} />} />
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
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="text-sm font-medium">
          {title} <span className="ml-1 font-normal text-muted-foreground">{subtitle}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-2">{children}</CardContent>
    </Card>
  );
}
