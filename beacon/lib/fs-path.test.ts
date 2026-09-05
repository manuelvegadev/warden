import assert from "node:assert/strict";
import { test } from "node:test";
import { ancestors, baseName, isValidName, joinPath, normalizePath, parentPath } from "./fs-path";

test("paths join and split around the root", () => {
  assert.equal(joinPath("", "plugins"), "plugins");
  assert.equal(joinPath("plugins", "Foo"), "plugins/Foo");
  assert.equal(parentPath("plugins/Foo/config.yml"), "plugins/Foo");
  assert.equal(parentPath("bukkit.yml"), "");
  assert.equal(baseName("plugins/Foo/config.yml"), "config.yml");
  assert.equal(baseName("bukkit.yml"), "bukkit.yml");
});

test("ancestors lists every column a path opens", () => {
  assert.deepEqual(ancestors(""), [""]);
  assert.deepEqual(ancestors("plugins/Foo"), ["", "plugins", "plugins/Foo"]);
});

test("a typed path is tidied before it is sent", () => {
  assert.equal(normalizePath("/plugins//Foo/"), "plugins/Foo");
  assert.equal(normalizePath("plugins\\Foo\\..\\Bar\\."), "plugins/Bar");
  assert.equal(normalizePath("../../etc"), "etc");
  assert.equal(normalizePath(""), "");
});

test("names may not carry separators or be the dot entries", () => {
  assert.ok(isValidName("My Plugin"));
  assert.ok(isValidName(".paper"));
  for (const bad of ["", ".", "..", "a/b", "a\\b"]) assert.equal(isValidName(bad), false, bad);
});
