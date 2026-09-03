import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { type Access, can, type InstanceAction, type InstanceRole, orgGrants, roleFor, strongest } from "./access.ts";

// The access model is enforced twice — here and in wardend/internal/auth/access.go — so the vectors
// live in one file both suites load. The coverage test below asserts every action appears in it, so
// an action added on one side fails the other side's test.
type Vector = {
  name: string;
  aclAll?: InstanceRole;
  acl: Record<string, InstanceRole>;
  instance: string;
  allowed?: InstanceAction[];
  denied?: InstanceAction[];
};

const VECTORS: Vector[] = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "access-vectors.json"), "utf8"),
).vectors;

for (const v of VECTORS) {
  test(`access: ${v.name}`, () => {
    const access: Access = { caps: [], aclAll: v.aclAll, acl: v.acl };
    const role = roleFor(access, v.instance);
    for (const action of v.allowed ?? []) assert.equal(can(role, action), true, `${action} should be allowed`);
    for (const action of v.denied ?? []) assert.equal(can(role, action), false, `${action} should be denied`);
  });
}

test("every action is covered by a vector", () => {
  const seen = new Set(VECTORS.flatMap((v) => [...(v.allowed ?? []), ...(v.denied ?? [])]));
  const actions: InstanceAction[] = [
    "read",
    "power",
    "console.send",
    "players.action",
    "access.write",
    "ops.write",
    "config.write",
    "plugins.write",
    "backups.write",
    "settings.write",
    "voice.listen",
    "voice.speak",
  ];
  for (const action of actions) {
    assert.ok(seen.has(action), `action "${action}" has no vector in access-vectors.json`);
  }
});

test("roleFor takes the stronger of the blanket and the per-instance grant", () => {
  assert.equal(roleFor({ caps: [], aclAll: "viewer", acl: { a: "manager" } }, "a"), "manager");
  assert.equal(roleFor({ caps: [], aclAll: "manager", acl: { a: "viewer" } }, "a"), "manager");
  assert.equal(roleFor({ caps: [], acl: {} }, "a"), undefined);
});

test("strongest handles the absence of a role", () => {
  assert.equal(strongest(undefined, "viewer"), "viewer");
  assert.equal(strongest("operator", undefined), "operator");
  assert.equal(strongest(undefined, undefined), undefined);
});

test("nothing is allowed without a role", () => {
  for (const action of ["read", "power", "settings.write"] as InstanceAction[]) {
    assert.equal(can(undefined, action), false);
  }
});

test("organization roles carry the powers the daemon checks", () => {
  assert.deepEqual(orgGrants("owner"), {
    caps: ["instances.create", "instances.delete", "members.manage"],
    aclAll: "manager",
  });
  assert.deepEqual(orgGrants("admin"), { caps: ["members.manage"], aclAll: "manager" });
  // A plain member reaches only what an explicit grant gives them.
  assert.deepEqual(orgGrants("member"), { caps: [] });
});
