import assert from "node:assert/strict";
import { test } from "node:test";
import { fileIconRule, fileIconSrc, folderIconRule, folderIconSrc } from "./index";

test("the staples of a server directory get their own icon", () => {
  const cases: [string, string][] = [
    ["paper.jar", "Java"],
    ["bukkit.yml", "YAML"],
    ["server.properties", "Properties"],
    ["ops.json", "JSON"],
    ["latest.log", "Log"],
    ["2026-09-04-1.log.gz", "Rotated log"],
    ["level.dat", "Minecraft data"],
    ["r.0.0.mca", "Minecraft data"],
    ["pack.mcmeta", "Minecraft"],
    ["session.lock", "Lockfiles"],
    ["eula.txt", "EULA"],
    [".console_history", "Console history"],
    ["crash-2026-09-04_12.00.00-server.txt", "Crash report"],
    ["server-icon.png", "Images (PNG)"],
    ["world.zip", "Archive"],
    ["README.md", "README Dark"],
    ["start.sh", "Shell"],
  ];
  for (const [name, rule] of cases) assert.equal(fileIconRule(name)?.name, rule, name);
});

test("a rule that looks at directories sees the path, the others only the name", () => {
  assert.equal(fileIconRule("config.yml", "plugins/Foo/config.yml")?.name, "Configs");
  assert.equal(fileIconRule("config.yml")?.name, "YAML");
});

test("unknown files and folders fall back to the plain icons", () => {
  assert.equal(fileIconRule("whatever.xyz"), undefined);
  assert.match(fileIconSrc("whatever.xyz"), /^data:image\/svg\+xml,/);
  assert.equal(folderIconRule("MyPlugin"), undefined);
  assert.notEqual(folderIconSrc("MyPlugin"), folderIconSrc("MyPlugin", true), "an open folder looks open");
});

test("server folders are recognised, open or closed", () => {
  const cases: [string, string][] = [
    ["plugins", "Plugins"],
    ["mods", "Plugins"],
    ["config", "Config"],
    ["logs", "Logs"],
    ["world", "World"],
    ["world_nether", "World"],
    ["region", "Region"],
    ["playerdata", "Player data"],
    ["datapacks", "Datapacks"],
    ["cache", "Temp"],
    ["libraries", "Vendors"],
    ["backups", "Archives"],
    [".paper", "Software"],
    ["crash-reports", "Crash reports"],
  ];
  for (const [name, rule] of cases) assert.equal(folderIconRule(name)?.name, rule, name);
  assert.notEqual(folderIconSrc("plugins"), folderIconSrc("plugins", true));
});
