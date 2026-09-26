import assert from "node:assert/strict";
import { test } from "node:test";
import type { LodInfo, LodKey, LodProvider } from "./api.ts";
import { diskTotal, lodDiskTotal, parseSetting, pregenSummary, radiusBlocks } from "./lod.ts";

test("a running pre-generation reads as progress, speed and time left", () => {
  assert.equal(
    pregenSummary({ state: "running", progress: 52.3, done: 1204, target: 2304, cps: 38.4, remaining: "9m 3s" }),
    "52.3% · 1,204 / 2,304 · 38 CPS · 9m 3s left",
  );
  assert.equal(pregenSummary({ state: "resumed", progress: 0, done: 0, target: 0, cps: 0 }), "Resumed after a restart");
  assert.equal(pregenSummary({ state: "unknown", progress: 0, done: 0, target: 0, cps: 0 }), "Status not recognised");
  assert.equal(pregenSummary({ state: "running", progress: 0, done: 0, target: 0, cps: 0 }), "Starting…");
});

test("a radius in chunks is shown in blocks too", () => {
  assert.equal(radiusBlocks(256), 4096);
});

test("disk use adds every store path", () => {
  const p = {
    disk: [
      { path: "a", bytes: 10 },
      { path: "b", bytes: 5 },
    ],
  } as LodProvider;
  assert.equal(diskTotal(p), 15);
});

test("a backup's LOD size adds the stores of every installed plugin", () => {
  const info = {
    providers: [
      { installed: {}, disk: [{ path: "plugins/DHSupport/data.sqlite", bytes: 100 }] },
      { installed: {}, disk: [{ path: "world/vss-lod", bytes: 20 }] },
      { disk: [{ path: "stale", bytes: 7 }] },
    ],
  } as unknown as LodInfo;
  assert.equal(lodDiskTotal(info), 120);
});

test("settings are parsed against their key", () => {
  const int: LodKey = { name: "d", label: "D", type: "int", default: 512, min: 1, max: 2048, live: true };
  assert.deepEqual(parseSetting(int, "256"), { value: 256 });
  assert.ok(parseSetting(int, "0").error);
  assert.ok(parseSetting(int, "1.5").error);
  assert.ok(parseSetting(int, "").error);
  const bool: LodKey = { name: "b", label: "B", type: "bool", default: true, live: true };
  assert.deepEqual(parseSetting(bool, false), { value: false });
  const en: LodKey = { name: "e", label: "E", type: "enum", default: "on", options: ["on", "off"], live: false };
  assert.deepEqual(parseSetting(en, "off"), { value: "off" });
  assert.ok(parseSetting(en, "sideways").error);
});
