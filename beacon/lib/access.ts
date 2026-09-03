// The access model shared by Beacon's UI and its token minting (ADR-017). wardend carries the same
// tables in Go (`internal/auth/access.go`); the two must stay in sync — `access.test.ts` pins the
// vectors that `TestAccessVectors` checks on the daemon side.

/** Roles a member can hold on one instance. Ordered: each one includes the previous. */
export const INSTANCE_ROLES = ["viewer", "operator", "manager"] as const;
export type InstanceRole = (typeof INSTANCE_ROLES)[number];

/** Roles inside an organization (Better Auth `organization` plugin). */
export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Host and organization powers that are not tied to a single instance. */
export const CAPS = ["system.update", "java.manage", "instances.create", "instances.delete", "members.manage"] as const;
export type Cap = (typeof CAPS)[number];

/** Grant covering every instance of a node, stored as an `instanceAccess` row with this id. */
export const ALL_INSTANCES = "*";

export const isInstanceRole = (v: unknown): v is InstanceRole => INSTANCE_ROLES.includes(v as InstanceRole);

const RANK: Record<InstanceRole, number> = { viewer: 1, operator: 2, manager: 3 };

/** True when `have` is at least as strong as `need`. */
export const atLeast = (have: InstanceRole | undefined, need: InstanceRole): boolean =>
  have !== undefined && RANK[have] >= RANK[need];

/** The stronger of two roles; `undefined` counts as "no access". */
export function strongest(a: InstanceRole | undefined, b: InstanceRole | undefined): InstanceRole | undefined {
  if (!a) return b;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

/** Actions the UI gates on. wardend enforces the same mapping on the routes listed in ADR-017 §5. */
export type InstanceAction =
  | "read"
  | "power" // start, stop, restart, kill
  | "console.send"
  | "players.action" // message, kick
  | "access.write" // whitelist, bans
  | "ops.write"
  | "config.write" // server.properties, raw properties, config files
  | "plugins.write"
  | "backups.write"
  | "settings.write" // instance settings, upgrade, eula, install
  | "voice.listen" // hear the players from the live view (ADR-019)
  | "voice.speak"; // talk to the players from the live view

const NEEDS: Record<InstanceAction, InstanceRole> = {
  read: "viewer",
  power: "operator",
  "console.send": "operator",
  "players.action": "operator",
  "access.write": "operator",
  "ops.write": "manager",
  "config.write": "manager",
  "plugins.write": "manager",
  "backups.write": "manager",
  "settings.write": "manager",
  "voice.listen": "manager",
  "voice.speak": "operator",
};

export const can = (role: InstanceRole | undefined, action: InstanceAction): boolean => atLeast(role, NEEDS[action]);

/** What an organization role grants by itself, before any per-instance grant. */
export function orgGrants(role: OrgRole): { caps: Cap[]; aclAll?: InstanceRole } {
  switch (role) {
    case "owner":
      return { caps: ["instances.create", "instances.delete", "members.manage"], aclAll: "manager" };
    case "admin":
      return { caps: ["members.manage"], aclAll: "manager" };
    default:
      return { caps: [] };
  }
}

/** Everything a signed token says about one user, and what the daemon reads out of it. */
export type Access = {
  /** Host-level and organization-level powers. */
  caps: Cap[];
  /** Role held on every instance of the node, when the user has a blanket grant. */
  aclAll?: InstanceRole;
  /** Role held on specific instances, keyed by instance id. */
  acl: Record<string, InstanceRole>;
};

/** The role a user holds on one instance, blanket grant included. */
export const roleFor = (access: Access, instanceId: string): InstanceRole | undefined =>
  strongest(access.aclAll, access.acl[instanceId]);

export const labelForInstanceRole: Record<InstanceRole, string> = {
  viewer: "Viewer",
  operator: "Operator",
  manager: "Manager",
};

export const describeInstanceRole: Record<InstanceRole, string> = {
  viewer: "Read the console, metrics and players.",
  operator: "Also start, stop and send commands; manage the whitelist and bans.",
  manager: "Also edit configuration, plugins and backups.",
};

export const labelForOrgRole: Record<OrgRole, string> = { owner: "Owner", admin: "Admin", member: "Member" };
