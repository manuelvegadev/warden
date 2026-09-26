import assert from "node:assert/strict";
import { test } from "node:test";
import { complete } from "./command-complete.ts";
import {
  matchAt,
  matchesToken,
  type RemoteAnswer,
  recall,
  rememberAnswer,
  type ServerCommand,
} from "./command-remote.ts";
import data from "./mc/data.json" with { type: "json" };

const SERVER: ServerCommand[] = [
  { name: "gamemode" },
  { name: "give", plugin: "Essentials", usage: "/give <player> <item> [amount]" },
  { name: "lp", aliases: ["luckperms", "perm", "perms", "permissions"], plugin: "LuckPerms", description: "Perms" },
  { name: "spark" },
  { name: "tps" },
];

const at = (value: string, commands: readonly ServerCommand[] | null = SERVER) =>
  complete({ value, caret: value.length, commands: commands ?? undefined, paper: true }, data);

test("with the server's list, command names are the server's, labelled by plugin", () => {
  const names = at("").suggestions.map((s) => `${s.value}:${s.kind}`);
  assert.deepEqual(names, ["gamemode:", "give:Essentials", "lp:LuckPerms", "spark:", "tps:paper"]);
  // Commands the grammar knows but the server does not run are not offered.
  assert.equal(
    at("dif").suggestions.find((s) => s.value === "difficulty"),
    undefined,
  );
});

test("a command shows once, under the first of its labels that matches", () => {
  const r = at("perm");
  assert.deepEqual(
    r.suggestions.map((s) => [s.value, s.detail, s.description]),
    [["perm", "lp", "Perms"]],
  );
  assert.equal(at("l").suggestions[0].detail, undefined, "the name itself needs no pointer");
});

test("the arguments of a plugin's command are the server's to complete", () => {
  const r = at("lp user ");
  assert.equal(r.remote, "lp user ");
  assert.deepEqual(r.suggestions, []);
  assert.equal(at("perms user St").remote, "perms user St", "aliases too");
});

test("a plugin that took over a vanilla command owns its arguments, and its usage is the hint", () => {
  const r = at("give ");
  assert.equal(r.remote, "give ");
  assert.deepEqual(
    r.suggestions.map((s) => s.hint),
    ["/give <player> <item> [amount]"],
  );
  assert.deepEqual(at("give St").suggestions, [], "the hint only shows before anything is typed");
});

test("commands the grammar knows stay local and instant; unknown ones go to the server", () => {
  const r = at("gamemode ");
  assert.equal(r.remote, null);
  assert.ok(r.suggestions.some((s) => s.value === "creative"));
  assert.equal(at("spark ").remote, "spark ");
  assert.equal(at("execute as @a run lp user ").remote, "execute as @a run lp user ");
});

test("without the server's list, completion is the grammar's alone", () => {
  assert.equal(at("lp user ", null).remote, null);
  assert.ok(at("dif", null).suggestions.some((s) => s.value === "difficulty"));
});

test("suggestions match from the start or from a word inside", () => {
  assert.ok(matchesToken("Steve", "st"));
  assert.ok(matchesToken("minecraft:stone", "stone"));
  assert.ok(matchesToken("oak_planks", "plank"));
  assert.ok(matchesToken("anything", ""));
  assert.ok(!matchesToken("oakplanks", "plank"));
});

test("the match is found where the typed token starts inside the suggestion", () => {
  assert.equal(matchAt("voicechat", "voi"), 0);
  assert.equal(matchAt("VoiceChat", "voi"), 0, "whatever the case");
  assert.equal(matchAt("minecraft:stone", "stone"), 10);
  assert.equal(matchAt("oak_planks", "plank"), 4);
  assert.equal(matchAt("oakplanks", "plank"), -1);
  assert.equal(matchAt("anything", ""), 0);
});

test("an answer serves every longer token of the same argument, unless it was capped", () => {
  const memory = new Map<string, RemoteAnswer>();
  rememberAnswer(memory, "lp user S", { suggestions: [{ text: "Steve" }, { text: "Stella" }, { text: "Sam" }] });
  assert.deepEqual(
    recall(memory, "lp user Ste", "Ste")?.map((s) => s.text),
    ["Steve", "Stella"],
  );
  assert.deepEqual(
    recall(memory, "lp user S", "S")?.map((s) => s.text),
    ["Steve", "Stella", "Sam"],
  );
  assert.equal(recall(memory, "lp user ", ""), null, "a shorter token needs asking");
  assert.equal(recall(memory, "lp group S", "S"), null, "another argument needs asking");

  rememberAnswer(memory, "lp user ", { suggestions: [{ text: "Alex" }], truncated: true });
  assert.equal(recall(memory, "lp user A", "A"), null, "a capped answer may lack what matches");
  assert.deepEqual(recall(memory, "lp user ", ""), [{ text: "Alex" }], "but answers its own line");
});

test("the server's own answer is narrowed to the typed token too", () => {
  // Plenty of plugins answer with every option whatever was typed.
  const memory = new Map<string, RemoteAnswer>([["lp u", { suggestions: [{ text: "user" }, { text: "group" }] }]]);
  assert.deepEqual(recall(memory, "lp u", "u"), [{ text: "user" }]);
});
