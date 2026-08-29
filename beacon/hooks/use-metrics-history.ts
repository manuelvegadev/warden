"use client";

import { useEffect, useMemo, useState } from "react";
import { instances, type MetricSample } from "@/lib/api";

export type MetricPoint = {
  ts: string;
  t: number; // epoch ms for a true time axis
  cpu: number;
  memMb: number;
  memMaxMb: number;
  diskMb: number;
  players: number;
  tps: number | null;
  rxKb: number;
  txKb: number;
};

export const toPoint = (m: MetricSample): MetricPoint => ({
  ts: m.ts,
  t: new Date(m.ts).getTime(),
  cpu: Math.round(m.cpu * 10) / 10,
  memMb: Math.round(m.memRss / 1048576),
  memMaxMb: Math.round(m.memMax / 1048576),
  diskMb: Math.round(m.diskUsed / 1048576),
  players: m.players,
  tps: m.tps ? Math.round(m.tps[0] * 100) / 100 : null,
  rxKb: Math.round(m.netRx / 1024),
  txKb: Math.round(m.netTx / 1024),
});

/** One hour of samples: history from the daemon on mount, then live samples appended. Shared by the cards and the Metrics tab. */
export function useMetricsHistory(id: string, live: MetricSample | null, maxPoints = 180) {
  const [history, setHistory] = useState<MetricPoint[]>([]);

  useEffect(() => {
    let stale = false;
    instances
      .metrics(id, "1h")
      .then((rows) => {
        if (!stale) setHistory(rows.map(toPoint));
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [id]);

  useEffect(() => {
    if (!live) return;
    setHistory((prev) => {
      if (prev.length && prev[prev.length - 1].ts === live.ts) return prev;
      const cutoff = Date.now() - 3600_000;
      return [...prev.filter((p) => new Date(p.ts).getTime() >= cutoff), toPoint(live)];
    });
  }, [live]);

  // Downsample so the SVGs stay light; tooltips still read real values.
  return useMemo(() => {
    const step = Math.max(1, Math.floor(history.length / maxPoints));
    return history.filter((_, i) => i % step === 0 || i === history.length - 1);
  }, [history, maxPoints]);
}
