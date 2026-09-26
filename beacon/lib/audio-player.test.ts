import assert from "node:assert/strict";
import { test } from "node:test";
import { clock, normalize, peaks } from "./audio-player.ts";

test("each bar is the loudest sample of its slice, whichever sign", () => {
  assert.deepEqual(peaks([0.1, -0.8, 0.2, 0.3, -0.1, 0.05], 3), [0.8, 0.3, 0.1]);
});

test("a clip shorter than the bars gives a bar per sample and never more than full scale", () => {
  assert.deepEqual(peaks([0.5, 1.5], 2), [0.5, 1]);
  assert.deepEqual(peaks([], 10), []);
});

test("a quiet sound is scaled so its loudest bar fills the height; silence stays flat", () => {
  assert.deepEqual(normalize([0.1, 0.05, 0.2]), [0.5, 0.25, 1]);
  assert.deepEqual(normalize([0, 0]), [0, 0]);
});

test("times read like a player's clock", () => {
  assert.equal(clock(7.9), "0:07");
  assert.equal(clock(205), "3:25");
  assert.equal(clock(3723), "1:02:03");
  assert.equal(clock(Number.NaN), "0:00");
});
