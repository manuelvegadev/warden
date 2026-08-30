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

const WINDOW_MS = 3600_000;

export const toPoint = (m: MetricSample): MetricPoint => ({
  ts: m.ts,
  t: new Date(m.ts).getTime(),
  cpu: Math.round(m.cpu * 10) / 10,
  memMb: Math.round(m.memRss / 1048576),
  memMaxMb: Math.round(m.memMax / 1048576),
  diskMb: Math.round(m.diskUsed / 1048576),
  players: m.players,
  tps: m.tps ? Math.round(m.tps[0] * 100) / 100 : null,
  // Rates already stored by daemons before v0.5.1 can be MinInt64 (counter wrap); never plot those.
  rxKb: m.netRx > 0 ? Math.round(m.netRx / 1024) : 0,
  txKb: m.netTx > 0 ? Math.round(m.netTx / 1024) : 0,
});

const RECENT_MS = 5 * 60_000;

/**
 * One hour of samples: history from the daemon on mount, then live samples appended. `history` is
 * the hour downsampled for the Metrics tab; `recent` is the last five minutes at full resolution
 * for the sparklines in the resource cards.
 */
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
      const cutoff = Date.now() - WINDOW_MS;
      return [...prev.filter((p) => new Date(p.ts).getTime() >= cutoff), toPoint(live)];
    });
  }, [live]);

  // Downsample so the SVGs stay light; tooltips still read real values. Buckets are by time, not
  // by index: with a full hour in the buffer every new sample drops one at the front, and an
  // index-based pick would then shift phase each second and redraw a different curve.
  return useMemo(() => {
    const newest = history[history.length - 1]?.t ?? 0;
    const recent = history.filter((p) => p.t >= newest - RECENT_MS);
    if (history.length <= maxPoints) return { history, recent };
    const bucketMs = Math.ceil(WINDOW_MS / maxPoints);
    const out: MetricPoint[] = [];
    for (const p of history) {
      const last = out[out.length - 1];
      if (last && Math.floor(last.t / bucketMs) === Math.floor(p.t / bucketMs)) out[out.length - 1] = p;
      else out.push(p);
    }
    return { history: out, recent };
  }, [history, maxPoints]);
}
