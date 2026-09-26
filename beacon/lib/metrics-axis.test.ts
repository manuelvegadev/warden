import assert from "node:assert/strict";
import { test } from "node:test";
import {
  axisUnit,
  breakAtGaps,
  bucketMs,
  gapsIn,
  holdTps,
  nextPowerOfTwo,
  quarterTicks,
  RANGE_MS,
  TPS_FLOOR,
  timeTicks,
  tpsFloorFor,
} from "./metrics-axis.ts";

// The TPS window trades range for resolution, and is only honest because of the escape hatch — so
// that is the part worth pinning. A log scale was considered and rejected: it expands small values,
// which compresses the very 18–20 band the window exists to show, and log(0) is undefined for a
// frozen server.

const at = (...tps: (number | null)[]) => tps.map((t) => ({ tps: t }));

test("a healthy server keeps the window, so half a tick of lag is visible", () => {
  assert.equal(tpsFloorFor(at(20, 19.8, 20, 19.5, 18.2)), TPS_FLOOR);
});

test("one sample under the floor opens the axis to zero", () => {
  assert.equal(tpsFloorFor(at(20, 20, 14.9, 20)), 0);
});

test("a frozen server is shown, not cropped", () => {
  assert.equal(tpsFloorFor(at(20, 0)), 0);
});

test("unknown samples are not read as zero", () => {
  assert.equal(tpsFloorFor(at(null, null, 20)), TPS_FLOOR);
});

test("exactly at the floor still counts as healthy", () => {
  assert.equal(tpsFloorFor(at(15, 20)), TPS_FLOOR);
});

// Network values arrive in KB and memory in MB; feeding one to the other's ladder is how the
// network axis briefly announced megabytes as gigabytes.
test("the unit ladder promotes from the base it was given", () => {
  assert.deepEqual([axisUnit(512, "KB").label, axisUnit(4096, "KB").label], ["KB", "MB"]);
  assert.deepEqual([axisUnit(512, "MB").label, axisUnit(2048, "MB").label], ["MB", "GB"]);
  assert.equal(axisUnit(4 * 1024 * 1024, "KB").label, "GB");
});

test("promoted ticks read as one decimal, base ticks as whole numbers", () => {
  assert.equal(axisUnit(4096, "KB").format(3072), "3.0");
  assert.equal(axisUnit(512, "KB").format(128), "128");
});

test("quarter ticks are round fractions of the ceiling", () => {
  assert.deepEqual(quarterTicks(2048), [0, 512, 1024, 1536, 2048]);
});

test("the throughput ladder only moves when traffic doubles", () => {
  assert.equal(nextPowerOfTwo(0, 512), 512);
  assert.equal(nextPowerOfTwo(512, 512), 512);
  assert.equal(nextPowerOfTwo(3100, 512), 4096);
  assert.equal(nextPowerOfTwo(4097, 512), 8192);
});

test("the bucket width matches the daemon's for every range", () => {
  assert.equal(bucketMs(RANGE_MS["15m"]), 3000);
  assert.equal(bucketMs(RANGE_MS["1h"]), 10_000);
  assert.equal(bucketMs(RANGE_MS["7d"]), 28 * 60_000);
  assert.equal(bucketMs(60_000), 2000); // never finer than the sampling interval
});

const series = (...t: number[]) => t.map((x) => ({ t: x }));

test("a server that was stopped for a while is a gap, a missing bucket or two is not", () => {
  assert.deepEqual(gapsIn(series(0, 10, 20, 40, 50), 10, 50), []);
  assert.deepEqual(gapsIn(series(0, 10, 100, 110), 10, 110), [{ from: 10, to: 100 }]);
});

test("a series that stops before the window ends is a gap up to the end", () => {
  assert.deepEqual(gapsIn(series(0, 10), 10, 200), [{ from: 10, to: 200 }]);
});

test("lines break inside each gap instead of ramping across it", () => {
  const points = [
    { t: 0, v: 1 },
    { t: 10, v: 2 },
    { t: 100, v: 3 },
  ];
  assert.deepEqual(breakAtGaps(points, [{ from: 10 }]), [{ t: 0, v: 1 }, { t: 10, v: 2 }, { t: 11 }, { t: 100, v: 3 }]);
});

test("time ticks fall on round times inside the window", () => {
  const start = new Date(2026, 8, 25, 18, 7).getTime(); // 18:07 local
  const ticks = timeTicks(start, start + RANGE_MS["1h"], "1h").map((t) => new Date(t).toTimeString().slice(0, 5));
  assert.deepEqual(ticks, ["18:10", "18:20", "18:30", "18:40", "18:50", "19:00"]);
});

test("a week's ticks fall on local midnight", () => {
  const start = new Date(2026, 8, 18, 15, 30).getTime();
  const ticks = timeTicks(start, start + RANGE_MS["7d"], "7d");
  assert.equal(ticks.length, 7);
  assert.ok(ticks.every((t) => new Date(t).getHours() === 0 && new Date(t).getMinutes() === 0));
});

test("TPS carries over the buckets between two readings, but not across a stop", () => {
  const tps = (...v: [number, number | null][]) => v.map(([t, x]) => ({ t, tps: x }));
  assert.deepEqual(
    holdTps(tps([0, 20], [3000, null], [6000, null], [16_000, 19.5], [19_000, null], [60_000, null])).map((p) => p.tps),
    [20, 20, 20, 19.5, 19.5, null],
  );
});
