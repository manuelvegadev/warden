import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import Database from "better-sqlite3";
import { ALL_INSTANCES } from "./access.ts";
import { createOwnTables } from "./db.ts";
import {
  bootstrapOrganization,
  claimsFor,
  defaultOrganizationId,
  grantFromInvitation,
  hasPendingInvitation,
  joinDefaultOrganization,
  listMembers,
  listPendingInvitations,
  publicInvitation,
  removeGrant,
  setGrant,
} from "./org.ts";

// The Better Auth tables exactly as `auth migrate` writes them (better-auth 1.7.2, SQLite), so the
// queries in org.ts are pinned against the real column names and the ISO-text dates.
const BETTER_AUTH_SCHEMA = `
CREATE TABLE "user" ("id" text not null primary key, "name" text not null, "email" text not null unique,
  "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null,
  "role" text, "banned" integer, "banReason" text, "banExpires" date);
CREATE TABLE "organization" ("id" text not null primary key, "name" text not null, "slug" text not null unique,
  "logo" text, "createdAt" date not null, "metadata" text);
CREATE TABLE "member" ("id" text not null primary key, "organizationId" text not null, "userId" text not null,
  "role" text not null, "createdAt" date not null);
CREATE TABLE "invitation" ("id" text not null primary key, "organizationId" text not null, "email" text not null,
  "role" text, "status" text not null, "expiresAt" date not null, "createdAt" date not null,
  "inviterId" text not null, "nodeId" text, "instanceId" text, "instanceRole" text);
`;

function db(withBetterAuth = true) {
  const d = new Database(":memory:");
  if (withBetterAuth) d.exec(BETTER_AUTH_SCHEMA);
  createOwnTables(d);
  return d;
}

function addUser(d: Database.Database, email: string, role: string | null) {
  const id = randomUUID();
  const now = new Date().toISOString();
  d.prepare(
    `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, role) VALUES (?, ?, ?, 0, ?, ?, ?)`,
  ).run(id, email.split("@")[0], email, now, now, role);
  return id;
}

function addInvitation(
  d: Database.Database,
  organizationId: string,
  email: string,
  extra: { instanceId?: string; instanceRole?: string; expiresAt?: string; status?: string } = {},
) {
  const id = randomUUID();
  d.prepare(
    `INSERT INTO invitation (id, organizationId, email, role, status, expiresAt, createdAt, inviterId, nodeId, instanceId, instanceRole)
     VALUES (?, ?, ?, 'member', ?, ?, ?, 'inviter', 'default', ?, ?)`,
  ).run(
    id,
    organizationId,
    email,
    extra.status ?? "pending",
    extra.expiresAt ?? new Date(Date.now() + 86_400_000).toISOString(),
    new Date().toISOString(),
    extra.instanceId ?? null,
    extra.instanceRole ?? null,
  );
  return id;
}

test("bootstrap migrates a pre-ADR-017 database: admins own it, operators keep their reach", () => {
  const d = db();
  const adminId = addUser(d, "admin@example.com", "admin");
  const opId = addUser(d, "op@example.com", "operator");

  bootstrapOrganization(d);
  const orgId = defaultOrganizationId(d);
  assert.ok(orgId);

  const admin = claimsFor(d, adminId, "admin");
  assert.deepEqual(admin.caps.sort(), [
    "instances.create",
    "instances.delete",
    "java.manage",
    "members.manage",
    "system.update",
  ]);
  assert.equal(admin.aclAll, "manager");

  // The former global operator could reach every instance; the blanket grant preserves exactly that.
  const op = claimsFor(d, opId, "operator");
  assert.deepEqual(op.caps, []);
  assert.equal(op.aclAll, "operator");
});

test("bootstrap is a no-op on a fresh install and runs only once", () => {
  const d = db();
  bootstrapOrganization(d);
  assert.equal(defaultOrganizationId(d), undefined); // no users yet

  const id = addUser(d, "first@example.com", "admin");
  bootstrapOrganization(d);
  const orgId = defaultOrganizationId(d);
  bootstrapOrganization(d);
  assert.equal(defaultOrganizationId(d), orgId);
  assert.equal(d.prepare("SELECT COUNT(*) AS c FROM member WHERE userId = ?").get(id).c, 1);
});

test("bootstrap survives a database whose Better Auth migrations have not run", () => {
  const d = db(false);
  bootstrapOrganization(d); // must not throw
  assert.equal(defaultOrganizationId(d), undefined);
});

test("the first sign-up owns the organization; later ones do not join by themselves", () => {
  const d = db();
  const first = addUser(d, "owner@example.com", "admin");
  joinDefaultOrganization(d, first, "owner@example.com", { openSignup: false });
  const orgId = defaultOrganizationId(d);
  assert.ok(orgId);
  assert.equal(claimsFor(d, first, "admin").aclAll, "manager");

  const second = addUser(d, "nobody@example.com", "operator");
  joinDefaultOrganization(d, second, "nobody@example.com", { openSignup: false });
  const claims = claimsFor(d, second, "operator");
  assert.equal(claims.aclAll, undefined);
  assert.deepEqual(claims.acl, {});
  assert.deepEqual(claims.caps, []);
});

test("open signup adds arrivals as plain members", () => {
  const d = db();
  const first = addUser(d, "owner@example.com", "admin");
  joinDefaultOrganization(d, first, "owner@example.com", { openSignup: true });
  const second = addUser(d, "walkin@example.com", "operator");
  joinDefaultOrganization(d, second, "walkin@example.com", { openSignup: true });
  assert.equal(listMembers(d).length, 2);
});

test("an invited user is left for acceptInvitation to add", () => {
  const d = db();
  const first = addUser(d, "owner@example.com", "admin");
  joinDefaultOrganization(d, first, "owner@example.com", { openSignup: false });
  const orgId = defaultOrganizationId(d);
  assert.ok(orgId);
  addInvitation(d, orgId, "guest@example.com", { instanceId: "survival", instanceRole: "operator" });

  const guest = addUser(d, "guest@example.com", "operator");
  joinDefaultOrganization(d, guest, "guest@example.com", { openSignup: true });
  assert.equal(listMembers(d).length, 1, "the invitation, not the sign-up, decides the membership");
});

test("pending invitations gate sign-up, case-insensitively, and expire", () => {
  const d = db();
  addUser(d, "owner@example.com", "admin");
  bootstrapOrganization(d);
  const orgId = defaultOrganizationId(d);
  assert.ok(orgId);

  assert.equal(hasPendingInvitation(d, "guest@example.com"), false);
  addInvitation(d, orgId, "Guest@Example.com");
  assert.equal(hasPendingInvitation(d, "guest@example.com"), true);

  addInvitation(d, orgId, "stale@example.com", { expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(hasPendingInvitation(d, "stale@example.com"), false);

  addInvitation(d, orgId, "used@example.com", { status: "accepted" });
  assert.equal(hasPendingInvitation(d, "used@example.com"), false);
});

test("accepting an invitation turns its instance into a grant", () => {
  const d = db();
  addUser(d, "owner@example.com", "admin");
  bootstrapOrganization(d);
  const orgId = defaultOrganizationId(d);
  assert.ok(orgId);
  const guest = addUser(d, "guest@example.com", "operator");
  const invitationId = addInvitation(d, orgId, "guest@example.com", {
    instanceId: "survival",
    instanceRole: "manager",
  });
  const invitation = d.prepare("SELECT * FROM invitation WHERE id = ?").get(invitationId) as Record<string, unknown>;

  grantFromInvitation(d, invitation, guest);
  const claims = claimsFor(d, guest, "operator");
  assert.deepEqual(claims.acl, { survival: "manager" });
  assert.equal(claims.aclAll, undefined, "a grant on one instance must not leak to the others");
});

test("an invitation without an instance grants nothing", () => {
  const d = db();
  addUser(d, "owner@example.com", "admin");
  bootstrapOrganization(d);
  const orgId = defaultOrganizationId(d);
  assert.ok(orgId);
  const guest = addUser(d, "guest@example.com", "operator");
  const id = addInvitation(d, orgId, "guest@example.com");
  const invitation = d.prepare("SELECT * FROM invitation WHERE id = ?").get(id) as Record<string, unknown>;
  grantFromInvitation(d, invitation, guest);
  assert.deepEqual(claimsFor(d, guest, "operator").acl, {});
});

test("grants are upserted, removable, and a blanket grant becomes aclAll", () => {
  const d = db();
  addUser(d, "owner@example.com", "admin");
  bootstrapOrganization(d);
  const orgId = defaultOrganizationId(d);
  assert.ok(orgId);
  const guest = addUser(d, "guest@example.com", "operator");

  setGrant(d, { organizationId: orgId, userId: guest, instanceId: "survival", role: "viewer" });
  setGrant(d, { organizationId: orgId, userId: guest, instanceId: "survival", role: "manager" });
  assert.deepEqual(claimsFor(d, guest, "operator").acl, { survival: "manager" });

  setGrant(d, { organizationId: orgId, userId: guest, instanceId: ALL_INSTANCES, role: "viewer" });
  assert.equal(claimsFor(d, guest, "operator").aclAll, "viewer");

  removeGrant(d, guest, "survival");
  assert.deepEqual(claimsFor(d, guest, "operator").acl, {});
});

test("grants on another node stay out of this node's claims", () => {
  const d = db();
  addUser(d, "owner@example.com", "admin");
  bootstrapOrganization(d);
  const orgId = defaultOrganizationId(d);
  assert.ok(orgId);
  const guest = addUser(d, "guest@example.com", "operator");
  setGrant(d, { organizationId: orgId, userId: guest, instanceId: "survival", role: "manager", nodeId: "vps" });
  assert.deepEqual(claimsFor(d, guest, "operator").acl, {});
});

test("the invite page shows a pending invitation and hides a spent one", () => {
  const d = db();
  addUser(d, "owner@example.com", "admin");
  bootstrapOrganization(d);
  const orgId = defaultOrganizationId(d);
  assert.ok(orgId);

  const id = addInvitation(d, orgId, "guest@example.com", { instanceId: "survival", instanceRole: "operator" });
  const view = publicInvitation(d, id);
  assert.equal(view?.email, "guest@example.com");
  assert.equal(view?.instanceId, "survival");
  assert.equal(view?.instanceRole, "operator");

  assert.equal(publicInvitation(d, randomUUID()), null);
  const expired = addInvitation(d, orgId, "late@example.com", {
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  assert.equal(publicInvitation(d, expired), null);
  assert.equal(listPendingInvitations(d).length, 1);
});

test("a blanket grant is surfaced as such, not hidden among the per-instance ones", () => {
  const d = db();
  addUser(d, "owner@example.com", "admin");
  addUser(d, "op@example.com", "operator");
  bootstrapOrganization(d); // gives the former global operator `operator` on every instance

  const [owner, op] = listMembers(d);
  assert.equal(owner.blanket, "manager", "an owner reaches everything through their role");
  assert.equal(op.blanket, "operator", "the migrated blanket grant must be visible to the UI");
  assert.deepEqual(op.grants, [], "and must not masquerade as a grant on an instance called '*'");
});

test("members are listed with their grants", () => {
  const d = db();
  const ownerId = addUser(d, "owner@example.com", "admin");
  const guestId = addUser(d, "guest@example.com", "operator");
  bootstrapOrganization(d);
  removeGrant(d, guestId, ALL_INSTANCES);
  const orgId = defaultOrganizationId(d);
  assert.ok(orgId);
  setGrant(d, { organizationId: orgId, userId: guestId, instanceId: "creative", role: "viewer" });

  const members = listMembers(d);
  assert.deepEqual(
    members.map((m) => [m.userId, m.orgRole, m.grants]),
    [
      [ownerId, "owner", []],
      [guestId, "member", [{ instanceId: "creative", role: "viewer" }]],
    ],
  );
});
