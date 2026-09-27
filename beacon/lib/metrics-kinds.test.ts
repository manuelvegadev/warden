import assert from "node:assert/strict";
import { test } from "node:test";
import { applicableKinds, isMetricKind, METRIC_KINDS } from "./metrics-kinds.ts";

test("the tick rate is left out for software that has no tps command", () => {
  assert.deepEqual(applicableKinds(METRIC_KINDS, false), ["cpu", "memory", "players", "disk", "network"]);
  assert.deepEqual(applicableKinds(METRIC_KINDS, true), [...METRIC_KINDS]);
});

test("chart kinds are recognised by name", () => {
  assert.ok(isMetricKind("cpu"));
  assert.ok(!isMetricKind("gpu"));
});
