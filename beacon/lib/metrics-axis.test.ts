import assert from "node:assert/strict";
import { test } from "node:test";
import { axisUnit, nextPowerOfTwo, quarterTicks, TPS_FLOOR, tpsFloorFor } from "./metrics-axis.ts";

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
