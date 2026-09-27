import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { defaultLayout, MAX_LAYOUT_BYTES } from "./dashboard-layout.ts";
import { deleteLayout, getLayout, parseLayoutBody, saveLayout } from "./dashboard-layout-store.ts";
import { createOwnTables } from "./db.ts";

const db = () => {
  const d = new Database(":memory:");
  createOwnTables(d);
  return d;
};

test("a user has no layout until one is saved, then gets it back", () => {
  const d = db();
  assert.equal(getLayout(d, "u1"), null);
  const l = defaultLayout();
  saveLayout(d, "u1", l);
  assert.deepEqual(getLayout(d, "u1"), l);
  assert.equal(getLayout(d, "u2"), null, "layouts are per user");
});

test("saving again replaces; deleting resets", () => {
  const d = db();
  const other = { ...defaultLayout(), columns: defaultLayout().columns.slice(0, 1) };
  saveLayout(d, "u1", defaultLayout());
  saveLayout(d, "u1", other);
  assert.equal(getLayout(d, "u1")?.columns.length, 1);
  deleteLayout(d, "u1");
  assert.equal(getLayout(d, "u1"), null);
});

test("a stored row that is no longer a layout reads as none", () => {
  const d = db();
  d.prepare("INSERT INTO dashboardLayout (userId, layout, updatedAt) VALUES (?, ?, ?)").run("u1", "not json", "x");
  assert.equal(getLayout(d, "u1"), null);
});

test("a request body is parsed, normalised and bounded", () => {
  const ok = parseLayoutBody(JSON.stringify(defaultLayout()));
  assert.ok("layout" in ok);
  const bad = parseLayoutBody("{");
  assert.ok("status" in bad && bad.status === 400);
  const empty = parseLayoutBody(JSON.stringify({ columns: [] }));
  assert.ok("status" in empty && empty.status === 400);
  const big = parseLayoutBody("x".repeat(MAX_LAYOUT_BYTES + 1));
  assert.ok("status" in big && big.status === 413);
});
