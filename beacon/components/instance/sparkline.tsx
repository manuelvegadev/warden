"use client";

import { Area, AreaChart, Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import type { MetricPoint } from "@/hooks/use-metrics-history";

export const SERIES_1 = "#3987e5"; // categorical slot 1 (docs/design.md), validated for the dark surface
export const SERIES_2 = "#d95926"; // slot 2

/** Plot-only miniature (no axes, no text) for stat tiles; identity comes from the tile label. */
export function Sparkline({
  data,
  keys,
  max,
  className,
}: {
  data: MetricPoint[];
  keys: (keyof MetricPoint)[];
  max?: number;
  className?: string;
}) {
  if (data.length < 2) return null;
  const domain: [number, number | "auto"] = [0, max ?? "auto"];
  const single = keys.length === 1;
  return (
    <div className={className} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        {single ? (
          <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <YAxis hide domain={domain} />
            <Area
              dataKey={keys[0]}
              type="monotone"
              stroke={SERIES_1}
              strokeWidth={1.5}
              fill={SERIES_1}
              fillOpacity={0.15}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </AreaChart>
        ) : (
          <LineChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <YAxis hide domain={domain} />
            {keys.map((k, i) => (
              <Line
                key={k}
                dataKey={k}
                type="monotone"
                stroke={i === 0 ? SERIES_1 : SERIES_2}
                strokeWidth={1.5}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
