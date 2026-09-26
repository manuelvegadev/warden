// Pure scale rules for the Metrics charts, kept out of the component so they can be tested: an axis
// that silently crops a bad minute, or that labels MB as GB, is a bug you only find by looking.

/**
 * One unit for the whole axis, named once in the axis label: ticks reading "0 MB, 450 MB, 1.3 GB"
 * mix scales and re-state the unit on every line. `base` is the unit the values are already in.
 */
export function axisUnit(max: number, base: "KB" | "MB") {
  const ladder = base === "KB" ? ["KB", "MB", "GB"] : ["MB", "GB"];
  let step = 0;
  let scale = 1;
  while (step < ladder.length - 1 && max / scale >= 1024) {
    scale *= 1024;
    step += 1;
  }
  return {
    label: ladder[step],
    format: (v: number) => (scale === 1 ? String(Math.round(v)) : (v / scale).toFixed(1)),
  };
}

/** Quarter steps, so every tick is a round fraction of the ceiling rather than whatever fits. */
export const quarterTicks = (ceiling: number) => [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(ceiling * f));

/** Next power of two at or above `v`: a ladder that only moves when the data genuinely doubles. */
export function nextPowerOfTwo(v: number, min: number) {
  let ceiling = min;
  while (ceiling < v) ceiling *= 2;
  return ceiling;
}

/** Below this the server is not worth watching tick by tick; the axis opens up instead. */
export const TPS_FLOOR = 15;

/**
 * The TPS axis window. A healthy server lives between 18 and 20, which is a tenth of a 0–20 axis,
 * so the axis starts at 15 — but only while every sample is above it. One dip below and the floor
 * drops to 0, because a chart that crops the outage is worse than one that rescales.
 */
export const tpsFloorFor = (samples: readonly { tps: number | null }[]) =>
  samples.some((p) => p.tps !== null && p.tps < TPS_FLOOR) ? 0 : TPS_FLOOR;

/**
 * The vertical range each series is drawn against. One definition per metric, shared by the Metrics
 * charts and the header tiles, so the miniature and the full chart can never disagree about what a
 * given height means.
 */

/** Process CPU as a share of the whole host: bounded, so the scale is absolute. */
export const CPU_DOMAIN: readonly [number, number] = [0, 100];

/** The daemon reports CPU as a percentage of one core, like `top`. */
export const hostShare = (cpu: number, cores: number | null) => Math.round((cores ? cpu / cores : cpu) * 10) / 10;

/**
 * Twice the heap limit. RSS legitimately sits above -Xmx (metaspace, GC structures, native buffers)
 * but rarely doubles it, so this is a resting scale rather than a cap.
 */
export const memCeiling = (heapMaxMb: number) => Math.max(heapMaxMb * 2, 512);

/** Throughput has no ceiling of its own, so the scale climbs only when traffic actually doubles. */
export const netCeiling = (samples: readonly { rxKb: number; txKb: number }[]) =>
  nextPowerOfTwo(
    samples.reduce((m, p) => Math.max(m, p.rxKb, p.txKb), 0),
    512,
  );

/** The TPS window, opened to the full range as soon as a sample falls through the floor. */
export const tpsDomain = (samples: readonly { tps: number | null }[]): [number, number] => [tpsFloorFor(samples), 20];

/** The ranges the Metrics section offers; the daemon keeps a week. */
export const METRICS_RANGES = ["15m", "1h", "6h", "24h", "7d"] as const;
export type MetricsRange = (typeof METRICS_RANGES)[number];
export const RANGE_MS: Record<MetricsRange, number> = {
  "15m": 15 * 60_000,
  "1h": 3_600_000,
  "6h": 6 * 3_600_000,
  "24h": 24 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
};
export const isMetricsRange = (v: unknown): v is MetricsRange => METRICS_RANGES.includes(v as MetricsRange);

/** Time-axis ticks at round times of day — every 3 min over 15 min up to every day over a week. */
const TICK_MS: Record<MetricsRange, number> = {
  "15m": 3 * 60_000,
  "1h": 10 * 60_000,
  "6h": 3_600_000,
  "24h": 4 * 3_600_000,
  "7d": 24 * 3_600_000,
};

/**
 * The time-axis ticks inside a window. Aligned to the local clock (a day tick falls on midnight
 * where the viewer is), so the labels read as the round times they are.
 */
export function timeTicks(start: number, end: number, range: MetricsRange) {
  const every = TICK_MS[range];
  const offset = new Date(start).getTimezoneOffset() * 60_000;
  const ticks: number[] = [];
  for (let t = Math.ceil((start - offset) / every) * every + offset; t <= end; t += every) ticks.push(t);
  return ticks;
}

/** How many buckets a chart asks the daemon for: about one per two pixels of a wide chart. */
export const CHART_POINTS = 360;

/**
 * The daemon's bucket width for a range (wardend metrics.StepFor): the range over the points,
 * rounded up to whole seconds, never finer than the 2 s sampling interval.
 */
export const bucketMs = (rangeMs: number, points = CHART_POINTS) =>
  Math.max(Math.ceil(Math.ceil(rangeMs / points) / 1000) * 1000, 2000);

/**
 * The stretches with no samples — the server was stopped — inside the chart's window: between two
 * buckets further apart than a few steps, and from the last one to the end of the window when the
 * series stops early. A step or two missing is jitter, not an outage.
 */
export function gapsIn(points: readonly { t: number }[], stepMs: number, windowEnd: number) {
  const limit = stepMs * 3;
  const gaps: { from: number; to: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    if (points[i].t - points[i - 1].t > limit) gaps.push({ from: points[i - 1].t, to: points[i].t });
  }
  const last = points[points.length - 1];
  if (last && windowEnd - last.t > limit) gaps.push({ from: last.t, to: windowEnd });
  return gaps;
}

/** The daemon asks the server for its TPS every ~16 s; a reading this old still stands. */
export const TPS_HOLD_MS = 20_000;

/**
 * TPS carried over the buckets between two readings: the daemon polls it every ~16 s, so a short
 * range has buckets with no reading at all, and the line would break into dashes. A reading older
 * than `TPS_HOLD_MS` is not carried, so a stopped server still leaves a gap.
 */
export function holdTps<T extends { t: number; tps: number | null }>(points: readonly T[]): T[] {
  let last: { t: number; tps: number } | null = null;
  return points.map((p) => {
    if (p.tps !== null) {
      last = { t: p.t, tps: p.tps };
      return p;
    }
    return last && p.t - last.t <= TPS_HOLD_MS ? { ...p, tps: last.tps } : p;
  });
}

/**
 * The series with an empty point just inside each gap, so the lines break there instead of drawing
 * a straight ramp across the hours the server was off.
 */
export function breakAtGaps<T extends { t: number }>(points: readonly T[], gaps: readonly { from: number }[]) {
  if (gaps.length === 0) return points as (T | { t: number })[];
  const starts = new Set(gaps.map((g) => g.from));
  const out: (T | { t: number })[] = [];
  for (const p of points) {
    out.push(p);
    if (starts.has(p.t)) out.push({ t: p.t + 1 });
  }
  return out;
}
