import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeQuery, remember, searchKey, worthSearching } from "./plugin-search.ts";

test("spaces typed around or between words do not make a new query", () => {
  assert.equal(normalizeQuery("  world   edit "), "world edit");
  assert.equal(searchKey("all", normalizeQuery("world edit ")), searchKey("all", normalizeQuery(" world edit")));
});

test("a single character waits for the next one; empty lists the most downloaded", () => {
  assert.equal(worthSearching("e"), false);
  assert.equal(worthSearching(""), true);
  assert.equal(worthSearching("es"), true);
});

test("the memory forgets the oldest answer, and one asked again counts as new", () => {
  const memory = new Map<string, number>();
  remember(memory, "a", 1, 2);
  remember(memory, "b", 2, 2);
  remember(memory, "a", 3, 2);
  remember(memory, "c", 4, 2);
  assert.deepEqual(
    [...memory],
    [
      ["a", 3],
      ["c", 4],
    ],
  );
});
