import assert from "node:assert/strict";
import { test } from "node:test";
import { complete } from "./command-complete.ts";
import { argAt, tokenize } from "./command-grammar.ts";
import data from "./mc/data.json" with { type: "json" };

const values = (input: string, extra: Record<string, unknown> = {}) =>
  complete({ value: input, caret: input.length, ...extra }, data).suggestions.map((s) => s.hint ?? s.value);

test("tokenize splits the trailing token from the ones before it", () => {
  assert.deepEqual(tokenize("give Steve dia"), { tokens: ["give", "Steve"], current: "dia", inJson: false });
  assert.deepEqual(tokenize("gamemode "), { tokens: ["gamemode"], current: "", inJson: false });
  assert.deepEqual(tokenize(""), { tokens: [], current: "", inJson: false });
  assert.equal(tokenize('tellraw @a {"text":"hi').inJson, true);
});

test("argAt follows subcommands and execute … run", () => {
  assert.equal(argAt([]), "command");
  assert.deepEqual(argAt(["time", "set"]), { type: "literal", values: ["day", "noon", "night", "midnight"] });
  assert.equal(argAt(["execute", "as", "Steve", "run"]), "command");
  assert.deepEqual(argAt(["execute", "as", "Steve", "run", "give"]), { type: "player" });
  assert.equal(argAt(["unknowncmd", "x"]), undefined);
});

test("diffi → difficulty", () => {
  assert.deepEqual(values("diffi"), ["difficulty"]);
});

test("gamemode lists the modes", () => {
  assert.deepEqual(values("gamemode "), ["survival", "creative", "adventure", "spectator"]);
  assert.deepEqual(values("gamemode CR"), ["creative"]);
});

test("give completes players then items", () => {
  assert.deepEqual(values("give ", { players: ["Steve"], knownPlayers: ["Alex", "Steve"] }), [
    "Steve",
    "Alex",
    "@a",
    "@p",
    "@r",
    "@e",
    "@s",
  ]);
  const items = values("give Steve dia");
  assert.ok(items.includes("diamond"));
  assert.ok(items.every((i) => i.startsWith("dia")));
  assert.deepEqual(values("give Steve diamond "), ["<count>"]);
});

test("gamerules and effects", () => {
  assert.deepEqual(values("gamerule keep"), ["keep_inventory", "keepInventory"]);
  assert.deepEqual(values("effect give @a fire"), ["fire_resistance"]);
});

test("paper commands only on paper-like software", () => {
  assert.deepEqual(values("tp", { paper: false }), ["tp"]);
  assert.deepEqual(values("tp", { paper: true }), ["tp", "tps"]);
});

test("no suggestions inside json", () => {
  assert.deepEqual(values('tellraw @a {"text":"hi'), []);
});

test("apply replaces the token under the caret", () => {
  const input = "give St diamond";
  const c = complete({ value: input, caret: 7, players: ["Steve"] }, data);
  assert.deepEqual(c.suggestions[0].value, "Steve");
  assert.equal(c.start, 5);
});
