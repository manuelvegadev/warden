import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chunksAt,
  judgeMaxPlayers,
  judgeSimulationDistance,
  judgeViewDistance,
  memoryFor,
  type Resources,
  tickedChunks,
} from "./server-budget.ts";

const box = (memoryMb: number, cores: number, players: number, view = 10, sim = 10): Resources => ({
  memoryMb,
  cores,
  players,
  viewDistance: view,
  simulationDistance: sim,
});

test("chunk count is the square that makes distance expensive", () => {
  assert.equal(chunksAt(10), 441, "the vanilla default already loads 441 chunks per player");
  assert.equal(chunksAt(32), 4225);
  assert.ok(chunksAt(20) / chunksAt(10) > 3.7, "doubling the distance is nearly four times the chunks");
});

test("the case that started this: 25 players at max distance on a 1 GB box", () => {
  const v = judgeViewDistance(32, box(1024, 1, 25));
  assert.equal(v.level, "over");
  assert.match(v.reason, /1 GB/);
  assert.ok(v.recommended < 10, `recommends ${v.recommended}, which should be well under the default`);
});

test("the vanilla default of 10 is fine on a box sized for the player count", () => {
  assert.equal(judgeViewDistance(10, box(8192, 4, 20)).level, "ok");
  assert.equal(judgeSimulationDistance(5, box(8192, 4, 20)).level, "ok");
});

test("the same default is over budget on one core with a full server", () => {
  // 20 players x 441 ticked chunks = 8820, past what one core sustains
  assert.equal(judgeSimulationDistance(10, box(8192, 1, 20)).level, "over");
  // Four cores tick it, so the resource complaint goes away — but 10 is still past the range the
  // guides call useful, and that warning does not depend on the hardware.
  assert.equal(judgeSimulationDistance(10, box(8192, 4, 20)).level, "caution");
});

test("resources are not the only limit: past the useful range it warns anyway", () => {
  const huge = box(64 * 1024, 32, 5);
  const view = judgeViewDistance(20, huge);
  assert.equal(view.level, "caution", "the heap fits, but nobody sees the difference");
  assert.equal(judgeSimulationDistance(12, huge).level, "caution");
  assert.equal(judgeViewDistance(8, huge).level, "ok");
});

test("what it recommends is always something it would itself call ok", () => {
  for (const r of [box(2048, 2, 10), box(8192, 4, 40), box(512, 1, 5), box(16384, 8, 60)]) {
    for (const judge of [judgeViewDistance, judgeSimulationDistance, judgeMaxPlayers]) {
      const { recommended, hopeless } = judge(10, r);
      if (hopeless) continue;
      assert.equal(
        judge(recommended, r).level,
        "ok",
        `${judge.name} recommended ${recommended} for ${JSON.stringify(r)}`,
      );
    }
  }
});

test("when no distance fits, it says the instance is the problem, not the slider", () => {
  // 25 players cost ~2.6 GB before a single chunk of view is loaded
  const v = judgeViewDistance(3, box(1024, 1, 25));
  assert.equal(v.level, "over");
  assert.equal(v.hopeless, true);
  assert.match(v.reason, /more memory, or a lower max-players/);
  // the same 1 GB box with a player count it can actually serve is fine at the recommended distance
  assert.equal(judgeViewDistance(7, box(1024, 1, 5)).level, "ok");
});

test("the verdict never improves as the distance grows", () => {
  const rank = { ok: 0, caution: 1, over: 2 };
  const r = box(4096, 2, 20);
  for (const judge of [judgeViewDistance, judgeSimulationDistance]) {
    let worst = 0;
    for (let d = 3; d <= 32; d++) {
      const level = rank[judge(d, r).level];
      assert.ok(level >= worst, `${judge.name} got better going from ${d - 1} to ${d}`);
      worst = level;
    }
  }
});

test("memory and tick estimates line up with what hosting guides publish", () => {
  // "10 players at view distance 10 can easily use 2-3 GB just from chunk loading"
  const ten = memoryFor(10, 10);
  assert.ok(ten > 1500 && ten < 3500, `${ten} MB for 10 players at distance 10`);
  // a small SMP: 5 players at the recommended 7 fits comfortably in 2 GB
  assert.ok(memoryFor(7, 5) < 2048);
  assert.equal(tickedChunks(4, 20), 81 * 20);
});

test("a single core is assumed even when the caller reports none", () => {
  assert.doesNotThrow(() => judgeSimulationDistance(4, box(2048, 0, 10)));
  assert.equal(judgeSimulationDistance(4, box(0, 0, 10)).level, judgeSimulationDistance(4, box(0, 1, 10)).level);
});

test("max-players is the same budget solved for the other unknown", () => {
  // 2 GB at the vanilla view distance: (512 base) + n x (60 + 44.1) leaves room for ~14
  const r = box(2048, 8, 20, 10, 5);
  const comfortable = judgeMaxPlayers(1, r).recommended;
  assert.equal(judgeMaxPlayers(comfortable, r).level, "ok", "what it recommends is what it calls ok");
  assert.equal(judgeMaxPlayers(comfortable + 1, r).level, "caution", "one past it is tight, not broken");
  assert.equal(judgeMaxPlayers(comfortable * 4, r).level, "over");
  assert.match(judgeMaxPlayers(comfortable * 4, r).reason, /this instance has 2 GB/);
});

test("the distances currently set change how many players fit", () => {
  const tight = judgeMaxPlayers(20, box(4096, 8, 20, 20, 5));
  const modest = judgeMaxPlayers(20, box(4096, 8, 20, 6, 5));
  assert.equal(tight.level, "over", "at view-distance 20 each player costs four times as much");
  assert.equal(modest.level, "ok");
  assert.ok(modest.recommended > tight.recommended);
});

test("whichever runs out first is the one it names", () => {
  // plenty of heap, one core, and a simulation distance that ticks a lot: CPU is the wall
  const cpuBound = judgeMaxPlayers(60, box(32 * 1024, 1, 60, 6, 12));
  assert.equal(cpuBound.level, "over");
  assert.match(cpuBound.reason, /ticking chunks/);
  // plenty of cores, little heap: memory is the wall
  const ramBound = judgeMaxPlayers(60, box(2048, 32, 60, 10, 4));
  assert.equal(ramBound.level, "over");
  assert.match(ramBound.reason, /would want about/);
});

test("filling the budget exactly is allowed but flagged as no headroom", () => {
  const r = box(4096, 16, 20, 8, 4);
  const comfortable = judgeMaxPlayers(1, r).recommended;
  assert.equal(judgeMaxPlayers(comfortable + 1, r).level, "caution");
  assert.match(judgeMaxPlayers(comfortable + 1, r).reason, /chunk generation/);
  assert.equal(judgeMaxPlayers(comfortable, r).level, "ok");
});

test("when not even one player fits, it points at the distances instead", () => {
  const v = judgeMaxPlayers(10, box(600, 1, 10, 32, 32));
  assert.equal(v.hopeless, true);
  assert.match(v.reason, /Lower view-distance and simulation-distance/);
});
