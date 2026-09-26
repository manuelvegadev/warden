"use client";

import { useEffect, useState } from "react";
import { type MetricPoint, toPoint } from "@/hooks/use-metrics-history";
import { instances } from "@/lib/api";
import { bucketMs, CHART_POINTS, type MetricsRange, RANGE_MS } from "@/lib/metrics-axis";

/**
 * A range of an instance's metrics, bucketed by the daemon (`?points=`), re-read as often as a new
 * bucket can appear — every step, between 5 s and a minute — while the page is visible. `end` is
 * the time of the last read: the chart's window is [end − range, end].
 */
export function useMetricsRange(id: string, range: MetricsRange) {
  const [state, setState] = useState<{ range: MetricsRange; points: MetricPoint[]; end: number } | null>(null);

  useEffect(() => {
    let stale = false;
    const load = () => {
      if (document.visibilityState === "hidden") return;
      const end = Date.now();
      instances
        .metrics(id, range, CHART_POINTS)
        .then((rows) => {
          if (!stale) setState({ range, points: rows.map(toPoint), end });
        })
        .catch(() => {});
    };
    load();
    const every = Math.min(Math.max(bucketMs(RANGE_MS[range]), 5000), 60_000);
    const timer = setInterval(load, every);
    document.addEventListener("visibilitychange", load);
    return () => {
      stale = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [id, range]);

  // A range just picked shows nothing rather than the previous range's series on the new axis.
  const current = state?.range === range ? state : null;
  return { points: current?.points ?? null, end: current?.end ?? Date.now() };
}
