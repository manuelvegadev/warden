import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_KPIS, normalizeKpis } from "./kpis.ts";

test("a strip that is not a list takes the default one", () => {
  for (const raw of [undefined, null, "cpu", { cpu: true }]) assert.deepEqual(normalizeKpis(raw), DEFAULT_KPIS);
});

test("unknown and repeated kinds are dropped, the order kept", () => {
  assert.deepEqual(normalizeKpis(["disk", "future", "cpu", "disk", 3]), ["disk", "cpu"]);
});

test("an empty strip stays empty: the user hid it", () => {
  assert.deepEqual(normalizeKpis([]), []);
});
