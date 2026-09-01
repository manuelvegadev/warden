import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

// The whole ADR-017 invitation flow, driven through Better Auth's own HTTP handler: sign-up gating,
// the organization hooks, the extra invitation fields and the claims that end up in the JWT.
// Everything is configured through the environment before `lib/auth.ts` is loaded.
const dir = mkdtempSync(join(tmpdir(), "beacon-invite-"));
process.env.DATABASE_PATH = join(dir, "beacon.db");
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
delete process.env.BEACON_OPEN_SIGNUP;

const BASE = process.env.BETTER_AUTH_URL;
const PASSWORD = "correct-horse-battery";

const { auth } = await import("./auth.ts");
const { getDb } = await import("./db.ts");
const { claimsFor, defaultOrganizationId, listMembers, listPendingInvitations } = await import("./org.ts");

let jar = new Map<string, string>();

/** One call against the auth handler, carrying and collecting cookies like a browser would. */
async function call(path: string, body?: unknown) {
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const res = await auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", origin: BASE, ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  for (const raw of res.headers.getSetCookie()) {
    const pair = raw.split(";")[0];
    const eq = pair.indexOf("=");
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${text}`);
  return json;
}

const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
const tokenClaims = async () => claims((await call("/token")).token);

before(async () => {
  const { getMigrations } = await import("better-auth/db/migration");
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
});

after(() => rmSync(dir, { recursive: true, force: true }));

test("the first account owns the organization and holds every capability", async () => {
  await call("/sign-up/email", { email: "owner@example.com", password: PASSWORD, name: "Owner" });
  const owner = await tokenClaims();
  assert.equal(owner.role, "admin");
  assert.equal(owner.aclAll, "manager");
  assert.equal(owner.node, "default");
  assert.deepEqual([...owner.caps].sort(), [
    "instances.create",
    "instances.delete",
    "java.manage",
    "members.manage",
    "system.update",
  ]);
});

test("nobody can sign up without an invitation, and the refusal says why", async () => {
  await assert.rejects(
    () => call("/sign-up/email", { email: "stranger@example.com", password: PASSWORD, name: "Nope" }),
    /Registration is closed/,
  );
});

test("an invitation carries the instance and the role it grants", async () => {
  const db = getDb();
  const invitation = await call("/organization/invite-member", {
    email: "guest@example.com",
    role: "member",
    organizationId: defaultOrganizationId(db),
    instanceId: "survival",
    instanceRole: "operator",
  });
  assert.equal(invitation.instanceId, "survival");
  assert.equal(invitation.instanceRole, "operator");
  assert.equal(listPendingInvitations(db).length, 1);
});

test("the guest signs up because of the invitation, and accepting grants exactly one instance", async () => {
  const db = getDb();
  const [invitation] = listPendingInvitations(db);
  jar = new Map(); // the guest arrives in their own browser

  await call("/sign-up/email", { email: "guest@example.com", password: PASSWORD, name: "Guest" });
  const before = await tokenClaims();
  assert.equal(before.aclAll, undefined, "signing up must not grant anything on its own");
  assert.equal(before.acl, undefined);

  await call("/organization/accept-invitation", { invitationId: invitation.id });
  const after = await tokenClaims();
  assert.equal(after.role, "operator", "an invited user is never a host admin");
  assert.deepEqual(after.caps, [], "a plain member holds no capability");
  assert.equal(after.aclAll, undefined, "the grant must not spill onto the other instances");
  assert.deepEqual(after.acl, { survival: "operator" });

  assert.equal(listPendingInvitations(db).length, 0, "the invitation is spent");
  assert.deepEqual(
    listMembers(db).map((m) => [m.email, m.orgRole, m.grants]),
    [
      ["owner@example.com", "owner", []],
      ["guest@example.com", "member", [{ instanceId: "survival", role: "operator" }]],
    ],
  );
});

test("the claims in the token match what the database says", () => {
  const db = getDb();
  const guest = listMembers(db).find((m) => m.email === "guest@example.com");
  assert.ok(guest);
  assert.deepEqual(claimsFor(db, guest.userId, "operator"), {
    caps: [],
    aclAll: undefined,
    acl: { survival: "operator" },
  });
});
