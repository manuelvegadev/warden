import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addTo,
  convert,
  detectIndent,
  freeKey,
  hasUnsafeNumbers,
  type Json,
  removeAt,
  renameKey,
  serialize,
  setAt,
} from "./json-edit.ts";

const doc: Json = { name: "Steve", ops: [{ level: 4 }, { level: 2 }], flags: { pvp: true } };

test("a value deep in the document is replaced without touching the original", () => {
  const next = setAt(doc, ["ops", 1, "level"], 3);
  assert.deepEqual(next, { name: "Steve", ops: [{ level: 4 }, { level: 3 }], flags: { pvp: true } });
  assert.equal((doc as { ops: { level: number }[] }).ops[1].level, 2);
});

test("entries are removed from objects and arrays", () => {
  assert.deepEqual(removeAt(doc, ["flags", "pvp"]), { name: "Steve", ops: [{ level: 4 }, { level: 2 }], flags: {} });
  assert.deepEqual(removeAt(doc, ["ops", 0]), { name: "Steve", ops: [{ level: 2 }], flags: { pvp: true } });
});

test("a renamed key keeps its place, and a taken name is refused", () => {
  assert.deepEqual(Object.keys(renameKey(doc, [], "ops", "operators") as object), ["name", "operators", "flags"]);
  assert.equal(renameKey(doc, [], "ops", "name"), null);
});

test("new entries go at the end of an array, or under a free key", () => {
  assert.deepEqual(addTo(doc, ["ops"], null), { ...(doc as object), ops: [{ level: 4 }, { level: 2 }, null] });
  assert.equal(freeKey({ key: 1, key2: 2 }), "key3");
  assert.deepEqual(Object.keys(addTo({ a: 1 }, [], "") as object), ["a", "key"]);
});

test("changing a value's type keeps what it can", () => {
  assert.equal(convert("12", "number"), 12);
  assert.equal(convert(12, "string"), "12");
  assert.equal(convert("true", "boolean"), true);
  assert.equal(convert("x", "number"), 0);
  assert.deepEqual(convert(5, "array"), []);
});

test("the file is written back in its own indentation, with its final newline", () => {
  assert.equal(detectIndent('{\n    "a": 1\n}'), "    ");
  assert.equal(detectIndent('{\n\t"a": 1\n}'), "\t");
  assert.equal(detectIndent("[]"), "  ");
  assert.equal(serialize({ a: 1 }, '{\n    "a": 0\n}\n'), '{\n    "a": 1\n}\n');
  assert.equal(serialize([1], "[0]"), "[\n  1\n]");
});

test("integers too big for JavaScript are caught, digits inside strings are not", () => {
  assert.equal(hasUnsafeNumbers('{"seed": -4172144997902289642}'), true);
  assert.equal(hasUnsafeNumbers('{"id": "1234567890123456789", "n": 42}'), false);
});
