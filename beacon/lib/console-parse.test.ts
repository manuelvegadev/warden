import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConsoleLine } from "./console-parse.ts";

const info = (text: string) => ({ ts: "2026-08-29T12:00:01", level: "INFO" as const, text });

test("Paper prefix: time, no thread", () => {
  const p = parseConsoleLine(info('[12:04:09 INFO]: Done (6.812s)! For help, type "help"'));
  assert.equal(p.time, "12:04:09");
  assert.equal(p.thread, undefined);
  assert.equal(p.kind, "server");
});

test("vanilla prefix: thread and level", () => {
  const p = parseConsoleLine(info("[12:07:12] [Server thread/INFO]: Steve joined the game"));
  assert.equal(p.thread, "Server thread");
  assert.equal(p.kind, "join");
  assert.equal(p.player, "Steve");
});

test("chat, command, leave, advancement, death", () => {
  assert.deepEqual(
    (({ kind, player, message }) => ({ kind, player, message }))(
      parseConsoleLine(info("[12:08:00 INFO]: <Alex> hello")),
    ),
    { kind: "chat", player: "Alex", message: "hello" },
  );
  const c = parseConsoleLine(info("[12:08:01 INFO]: Alex issued server command: /gamemode creative"));
  assert.equal(c.kind, "command");
  assert.equal(c.message, "/gamemode creative");
  assert.equal(parseConsoleLine(info("[12:08:02 INFO]: Alex lost connection: Disconnected")).kind, "leave");
  const a = parseConsoleLine(info("[12:08:03 INFO]: Alex has made the advancement [Stone Age]"));
  assert.equal(a.kind, "advancement");
  assert.equal(a.message, "Stone Age");
  assert.equal(parseConsoleLine(info("[12:08:04 INFO]: Alex was slain by Zombie")).kind, "death");
});

test("plugin source is split off; server threads are not sources", () => {
  const p = parseConsoleLine(info("[12:09:00 INFO]: [LuckPerms] Loading storage provider... [H2]"));
  assert.equal(p.source, "LuckPerms");
  assert.equal(p.kind, "plugin");
  assert.equal(p.message, "Loading storage provider... [H2]");
  const v = parseConsoleLine(info("[12:09:01] [Craft Scheduler Thread - 3/INFO]: [Chunky] Task finished"));
  assert.equal(v.thread, "Craft Scheduler Thread - 3");
  assert.equal(v.source, "Chunky");
});

test("levels and wardend lines", () => {
  const w = parseConsoleLine({ ...info("[12:06:41 WARN]: Can't keep up! Running 2314ms behind"), level: "WARN" });
  assert.equal(w.kind, "overload");
  assert.equal(parseConsoleLine({ ...info("[12:06:42 WARN]: Ambiguity"), level: "WARN" }).kind, "warn");
  assert.equal(parseConsoleLine({ ...info("[12:06:43 ERROR]: boom"), level: "ERROR" }).kind, "error");
  const s = parseConsoleLine({ ...info("> list"), level: "STDIN" });
  assert.equal(s.kind, "stdin");
  assert.equal(s.message, "list");
  assert.equal(s.time, "12:00:01");
  assert.equal(parseConsoleLine({ ...info("[wardend]: Stopping"), level: "SYSTEM" }).kind, "system");
});
