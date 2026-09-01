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
