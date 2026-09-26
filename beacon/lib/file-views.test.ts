import assert from "node:assert/strict";
import { test } from "node:test";
import { viewFor } from "./file-views.ts";

test("every JSON file gets the JSON editor, the server's lists as much as any other", () => {
  assert.equal(viewFor("whitelist.json", "text"), "json");
  assert.equal(viewFor("usercache.json", "text"), "json");
  assert.equal(viewFor("plugins/Foo/config.json", "text"), "json");
  assert.equal(viewFor("world/datapacks/pack.mcmeta", "text"), "json");
});

test("logs, rotated logs and crash reports open in the log view", () => {
  assert.equal(viewFor("logs/latest.log", "text"), "log");
  assert.equal(viewFor("logs/2026-09-25-1.log.gz", "binary"), "log");
  assert.equal(viewFor("crash-reports/crash-2026-09-25_18.00.00-server.txt", "text"), "log");
  assert.equal(viewFor("notes.txt", "text"), null);
});

test("eula.txt at the root has its card; server.properties is text", () => {
  assert.equal(viewFor("eula.txt", "text"), "eula");
  assert.equal(viewFor("server.properties", "text"), null);
});

test("pictures and sounds are shown and played", () => {
  assert.equal(viewFor("server-icon.png", "image"), "image");
  assert.equal(viewFor("plugins/Sounds/click.ogg", "audio"), "audio");
});

test("binaries the daemon can read have their views; the rest are downloads", () => {
  assert.equal(viewFor("plugins/LuckPerms.jar", "binary"), "jar");
  assert.equal(viewFor("world/datapacks/tweaks.zip", "binary"), "archive");
  assert.equal(viewFor("world/level.dat", "binary"), "nbt");
  assert.equal(viewFor("world/playerdata/abc.dat_old", "binary"), "nbt");
  assert.equal(viewFor("plugins/WorldEdit/schematics/house.schem", "binary"), "nbt");
  assert.equal(viewFor("world/region/r.0.-1.mca", "binary"), "region");
  assert.equal(viewFor("plugins/CoreProtect/database.db", "binary"), "sqlite");
  assert.equal(viewFor("cache/mojang_1.21.jar.tmp", "binary"), null);
});
