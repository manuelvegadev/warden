import assert from "node:assert/strict";
import { test } from "node:test";
import { arrowTarget, HISTORY_MAX, NOT_NAVIGATING, navigate, parseHistory, record } from "./command-history.ts";

const history = ["say hello", "give Steve diamond 1", "time set day", "give Alex stone 64"];

/** Presses the arrows in order from an idle line holding `value`; returns the line after each press. */
function press(keys: ("up" | "down")[], value = "") {
  let nav = NOT_NAVIGATING;
  let line = value;
  const shown: string[] = [];
  for (const k of keys) {
    const step = navigate(nav, k, history, line);
    if (step) ({ nav, value: line } = step);
    shown.push(line);
  }
  return shown;
}

test("ArrowUp on an empty line walks history from the newest command", () => {
  assert.deepEqual(press(["up", "up", "up"]), ["say hello", "give Steve diamond 1", "time set day"]);
});

test("ArrowUp stops at the oldest command", () => {
  assert.deepEqual(press(["up", "up", "up", "up", "up"]).at(-1), "give Alex stone 64");
});

test("going back down past the newest entry restores the draft", () => {
  assert.deepEqual(press(["up", "up", "down", "down"], "gi"), [
    "give Steve diamond 1",
    "give Alex stone 64",
    "give Steve diamond 1",
    "gi",
  ]);
});

test("typed text narrows history to entries starting with it", () => {
  assert.deepEqual(press(["up", "up", "up"], "give "), [
    "give Steve diamond 1",
    "give Alex stone 64",
    "give Alex stone 64",
  ]);
});

test("ArrowDown on a line that is not navigating does nothing", () => {
  assert.equal(navigate(NOT_NAVIGATING, "down", history, "time"), null);
});

test("an entry equal to the draft is skipped", () => {
  assert.deepEqual(press(["up"], "say hello"), ["say hello"]);
});

test("a repeated command moves to the front instead of appearing twice", () => {
  assert.deepEqual(record(history, "time set day"), [
    "time set day",
    "say hello",
    "give Steve diamond 1",
    "give Alex stone 64",
  ]);
});

test("a command is recorded trimmed, and a blank one not at all", () => {
  assert.deepEqual(record(["list"], "  weather clear "), ["weather clear", "list"]);
  assert.deepEqual(record(["list"], "   "), ["list"]);
});

test("history keeps the newest hundred", () => {
  let h: string[] = [];
  for (let i = 0; i < HISTORY_MAX + 20; i++) h = record(h, `say ${i}`);
  assert.equal(h.length, HISTORY_MAX);
  assert.equal(h[0], `say ${HISTORY_MAX + 19}`);
});

test("an empty line gives the arrows to history even with suggestions open", () => {
  assert.equal(arrowTarget({ listOpen: true, value: "", navigating: false }), "history");
});

test("an open suggestion list keeps the arrows unless history navigation has begun", () => {
  assert.equal(arrowTarget({ listOpen: true, value: "gam", navigating: false }), "list");
  assert.equal(arrowTarget({ listOpen: true, value: "gamemode creative", navigating: true }), "history");
  assert.equal(arrowTarget({ listOpen: false, value: "gam", navigating: false }), "history");
});

test("a stored history that is not a list of strings is dropped", () => {
  assert.deepEqual(parseHistory('["list", 3, "stop"]'), ["list", "stop"]);
  assert.deepEqual(parseHistory("{}"), []);
  assert.deepEqual(parseHistory("not json"), []);
  assert.deepEqual(parseHistory(null), []);
});
