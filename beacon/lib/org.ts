import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import {
  type Access,
  ALL_INSTANCES,
  type Cap,
  type InstanceRole,
  isInstanceRole,
  type OrgRole,
  orgGrants,
  strongest,
} from "./access";
import { stmt, tableExists } from "./db";

// Organization membership and per-instance grants (ADR-017). The organization is the tenant; the
// grants are ours, because Better Auth's access control is per resource type, not per object.

/** Which wardend these grants are for. One node today; the column is here so multi-node needs no migration. */
export const NODE_ID = process.env.WARDEND_NODE_ID ?? "default";

const DEFAULT_ORG = { name: "Beacon", slug: "default" };

type MemberRow = { id: string; organizationId: string; role: string };
type GrantRow = { instanceId: string; role: string };

/** Better Auth stores multiple roles comma-separated, here and in `user.role`. */
const hasRole = (raw: string | null | undefined, name: string): boolean =>
  (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .includes(name);

/** The strongest organization role we understand out of a comma-separated list. */
const parseOrgRole = (raw: string): OrgRole =>
  hasRole(raw, "owner") ? "owner" : hasRole(raw, "admin") ? "admin" : "member";

/** Dates arrive as an ISO string or as epoch millis depending on how the row was written. */
function asDate(v: unknown): Date | undefined {
  if (typeof v === "number") return new Date(v);
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return v instanceof Date ? v : undefined;
}

const ready = (db: Database) => tableExists(db, "organization") && tableExists(db, "member");

export function defaultOrganizationId(db: Database): string | undefined {
  if (!ready(db)) return undefined;
  const row = stmt(db, "SELECT id FROM organization ORDER BY createdAt LIMIT 1").get() as { id: string } | undefined;
  return row?.id;
}

function createDefaultOrganization(db: Database): string {
  const id = randomUUID();
  stmt(db, "INSERT INTO organization (id, name, slug, createdAt) VALUES (?, ?, ?, ?)").run(
    id,
    DEFAULT_ORG.name,
    DEFAULT_ORG.slug,
    new Date().toISOString(),
  );
  return id;
}

function addMember(db: Database, organizationId: string, userId: string, role: OrgRole): void {
  const existing = stmt(db, "SELECT id FROM member WHERE organizationId = ? AND userId = ?").get(
    organizationId,
    userId,
  );
  if (existing) return;
  stmt(db, "INSERT INTO member (id, organizationId, userId, role, createdAt) VALUES (?, ?, ?, ?, ?)").run(
    randomUUID(),
    organizationId,
    userId,
    role,
    new Date().toISOString(),
  );
}

/**
 * Upgrades a database that predates ADR-017: everyone lands in one organization, the global admins
 * own it, and the former global operators keep the reach they had — `operator` on every instance —
 * as an explicit blanket grant. A no-op once an organization exists, and on a fresh install (there
 * the first sign-up creates it).
 */
export function bootstrapOrganization(db: Database): void {
  try {
    if (!ready(db) || defaultOrganizationId(db)) return;
    const users = stmt(db, "SELECT id, role FROM user").all() as { id: string; role: string | null }[];
    if (users.length === 0) return;
    const organizationId = createDefaultOrganization(db);
    for (const u of users) {
      const isAdmin = hasRole(u.role, "admin");
      addMember(db, organizationId, u.id, isAdmin ? "owner" : "member");
      if (!isAdmin) setGrant(db, { organizationId, userId: u.id, instanceId: ALL_INSTANCES, role: "operator" });
    }
    console.warn(
      `[beacon] ADR-017: migrated ${users.length} user(s) into the default organization; review Settings → Members`,
    );
  } catch (e) {
    // A panel that cannot migrate must still boot and let people sign in.
    console.error("[beacon] organization bootstrap failed; run `pnpm auth:migrate`", e);
  }
}

/** A pending, unexpired invitation is what allows a new account to be created (ADR-017 §6). */
export function hasPendingInvitation(db: Database, email: string): boolean {
  if (!tableExists(db, "invitation")) return false;
  const rows = stmt(db, "SELECT expiresAt FROM invitation WHERE lower(email) = lower(?) AND status = 'pending'").all(
    email,
  ) as { expiresAt: unknown }[];
  return rows.some((r) => {
    const d = asDate(r.expiresAt);
    return d === undefined || d.getTime() > Date.now();
  });
}

/**
 * Membership for a freshly created account. The first user owns the organization; an invited user
 * is added by `acceptInvitation`, so only open-signup arrivals need a row here.
 */
export function joinDefaultOrganization(
  db: Database,
  userId: string,
  email: string,
  { openSignup }: { openSignup: boolean },
): void {
  try {
    if (!ready(db)) return;
    const existing = defaultOrganizationId(db);
    if (!existing) {
      addMember(db, createDefaultOrganization(db), userId, "owner");
      return;
    }
    if (hasPendingInvitation(db, email)) return; // acceptInvitation will add them, with their grant
    if (openSignup) addMember(db, existing, userId, "member");
  } catch (e) {
    console.error("[beacon] could not add the new user to the default organization", e);
  }
}

/** The instance carried by an invitation becomes a grant once it is accepted. */
export function grantFromInvitation(db: Database, invitation: Record<string, unknown>, userId: string): void {
  const instanceId = invitation.instanceId;
  const role = invitation.instanceRole;
  if (typeof instanceId !== "string" || !instanceId || !isInstanceRole(role)) return;
  setGrant(db, {
    organizationId: String(invitation.organizationId),
    userId,
    instanceId,
    role,
    nodeId: typeof invitation.nodeId === "string" ? invitation.nodeId : NODE_ID,
  });
}

export function membershipOf(
  db: Database,
  userId: string,
): { memberId: string; organizationId: string; role: OrgRole } | undefined {
  if (!ready(db)) return undefined;
  const row = stmt(db, "SELECT id, organizationId, role FROM member WHERE userId = ? ORDER BY createdAt LIMIT 1").get(
    userId,
  ) as MemberRow | undefined;
  return row ? { memberId: row.id, organizationId: row.organizationId, role: parseOrgRole(row.role) } : undefined;
}

/** Per-instance grants held by one user on this node. */
export function grantsOf(db: Database, userId: string): Record<string, InstanceRole> {
  const rows = stmt(db, "SELECT instanceId, role FROM instanceAccess WHERE userId = ? AND nodeId = ?").all(
    userId,
    NODE_ID,
  ) as GrantRow[];
  const out: Record<string, InstanceRole> = {};
  for (const r of rows) if (isInstanceRole(r.role)) out[r.instanceId] = r.role;
  return out;
}

/**
 * Everything the JWT says about a user: host capabilities from the global role, instance reach from
 * the organization role, and the explicit grants on top (ADR-017 §4).
 */
export function claimsFor(db: Database, userId: string, globalRole: string | null | undefined): Access {
  const caps: Cap[] = [];
  if (hasRole(globalRole, "admin")) caps.push("system.update", "java.manage");

  let aclAll: InstanceRole | undefined;
  const acl: Record<string, InstanceRole> = {};

  const membership = membershipOf(db, userId);
  if (membership) {
    const granted = orgGrants(membership.role);
    caps.push(...granted.caps);
    aclAll = granted.aclAll;
  }
  for (const [instanceId, role] of Object.entries(grantsOf(db, userId))) {
    if (instanceId === ALL_INSTANCES) aclAll = strongest(aclAll, role);
    else acl[instanceId] = role;
  }
  return { caps, aclAll, acl };
}

export function setGrant(
  db: Database,
  g: { organizationId: string; userId: string; instanceId: string; role: InstanceRole; nodeId?: string },
): void {
  stmt(
    db,
    `INSERT INTO instanceAccess (id, organizationId, userId, nodeId, instanceId, role, createdAt, createdBy)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (userId, nodeId, instanceId) DO UPDATE SET role = excluded.role`,
  ).run(
    randomUUID(),
    g.organizationId,
    g.userId,
    g.nodeId ?? NODE_ID,
    g.instanceId,
    g.role,
    new Date().toISOString(),
    null,
  );
}

export function removeGrant(db: Database, userId: string, instanceId: string, nodeId = NODE_ID): void {
  stmt(db, "DELETE FROM instanceAccess WHERE userId = ? AND instanceId = ? AND nodeId = ?").run(
    userId,
    instanceId,
    nodeId,
  );
}

export function removeAllGrants(db: Database, userId: string): void {
  stmt(db, "DELETE FROM instanceAccess WHERE userId = ?").run(userId);
}

export type MemberView = {
  userId: string;
  name: string;
  email: string;
  orgRole: OrgRole;
  /** Role held on every instance of the node, from a blanket grant. Owners and admins get it from their role. */
  blanket?: InstanceRole;
  /** Roles held on named instances. */
  grants: { instanceId: string; role: InstanceRole }[];
};

/**
 * Members of the organization with their grants, for Settings → Members. Two queries regardless of
 * how many members there are: the grants are fetched in one go and grouped here.
 */
export function listMembers(db: Database, organizationId = defaultOrganizationId(db)): MemberView[] {
  if (!organizationId) return [];
  const rows = stmt(
    db,
    `SELECT m.role AS orgRole, u.id AS userId, u.name AS name, u.email AS email
       FROM member m JOIN user u ON u.id = m.userId
      WHERE m.organizationId = ?
      ORDER BY m.createdAt`,
  ).all(organizationId) as { orgRole: string; userId: string; name: string; email: string }[];

  const byUser = new Map<string, { instanceId: string; role: InstanceRole }[]>();
  const blankets = new Map<string, InstanceRole>();
  for (const g of stmt(db, "SELECT userId, instanceId, role FROM instanceAccess WHERE nodeId = ?").all(
    NODE_ID,
  ) as (GrantRow & { userId: string })[]) {
    if (!isInstanceRole(g.role)) continue;
    if (g.instanceId === ALL_INSTANCES) blankets.set(g.userId, g.role);
    else byUser.set(g.userId, [...(byUser.get(g.userId) ?? []), { instanceId: g.instanceId, role: g.role }]);
  }

  return rows.map((r) => {
    const orgRole = parseOrgRole(r.orgRole);
    return {
      userId: r.userId,
      name: r.name,
      email: r.email,
      orgRole,
      blanket: strongest(orgGrants(orgRole).aclAll, blankets.get(r.userId)),
      grants: byUser.get(r.userId) ?? [],
    };
  });
}

export type InvitationView = {
  id: string;
  email: string;
  instanceId: string | null;
  instanceRole: InstanceRole | null;
  expiresAt: string;
};

export function listPendingInvitations(db: Database, organizationId = defaultOrganizationId(db)): InvitationView[] {
  if (!organizationId || !tableExists(db, "invitation")) return [];
  const rows = stmt(
    db,
    `SELECT id, email, expiresAt, instanceId, instanceRole
       FROM invitation WHERE organizationId = ? AND status = 'pending' AND expiresAt > ?`,
  ).all(organizationId, new Date().toISOString()) as {
    id: string;
    email: string;
    expiresAt: unknown;
    instanceId: string | null;
    instanceRole: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    instanceId: r.instanceId,
    instanceRole: isInstanceRole(r.instanceRole) ? r.instanceRole : null,
    expiresAt: (asDate(r.expiresAt) ?? new Date(0)).toISOString(),
  }));
}

/**
 * What the /invite/{id} page may show a signed-out visitor. Read straight from the table on purpose:
 * the plugin's `getInvitation` requires a session, and the invited person does not have one yet.
 */
export function publicInvitation(
  db: Database,
  id: string,
): { email: string; organizationName: string; instanceId: string | null; instanceRole: InstanceRole | null } | null {
  if (!tableExists(db, "invitation")) return null;
  const row = stmt(
    db,
    `SELECT i.email, i.status, i.expiresAt, i.instanceId, i.instanceRole, o.name AS organizationName
       FROM invitation i JOIN organization o ON o.id = i.organizationId
      WHERE i.id = ?`,
  ).get(id) as
    | {
        email: string;
        status: string;
        expiresAt: unknown;
        instanceId: string | null;
        instanceRole: string | null;
        organizationName: string;
      }
    | undefined;
  if (row?.status !== "pending") return null;
  const expires = asDate(row.expiresAt);
  if (expires && expires.getTime() <= Date.now()) return null;
  return {
    email: row.email,
    organizationName: row.organizationName,
    instanceId: row.instanceId,
    instanceRole: isInstanceRole(row.instanceRole) ? row.instanceRole : null,
  };
}
