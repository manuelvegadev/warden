import "server-only";
import { cache } from "react";
import { type Access, type InstanceRole, type OrgRole, roleFor } from "@/lib/access";
import { getDb } from "@/lib/db";
import { claimsFor, membershipOf } from "@/lib/org";
import { getSession } from "@/lib/session";
import { wardendFetch } from "@/lib/wardend";

// Who may manage members, and how a change reaches the daemon (ADR-017 §2 and §7).

export type Membership = { userId: string; organizationId: string; role: OrgRole };

/** The caller's membership, or undefined when they are not in an organization at all. */
export const currentMembership = cache(async (): Promise<Membership | undefined> => {
  const session = await getSession();
  if (!session) return undefined;
  const membership = membershipOf(getDb(), session.user.id);
  return membership ? { userId: session.user.id, ...membership } : undefined;
});

/** Only an organization owner or admin may invite people and change who reaches what. */
export const canManageMembers = (m: Membership | undefined): m is Membership => m !== undefined && m.role !== "member";

export async function requireMemberManager(): Promise<Membership | undefined> {
  const membership = await currentMembership();
  return canManageMembers(membership) ? membership : undefined;
}

/**
 * Everything the caller may reach, resolved exactly the way the JWT claims are, so the UI never
 * offers a control the daemon would refuse. Memoized per request.
 */
export const currentAccess = cache(async (): Promise<Access | undefined> => {
  const session = await getSession();
  return session ? claimsFor(getDb(), session.user.id, session.user.role) : undefined;
});

/** The caller's role on one instance. */
export async function instanceRoleOf(instanceId: string): Promise<InstanceRole | undefined> {
  const access = await currentAccess();
  return access && roleFor(access, instanceId);
}

/**
 * Closes a user's live WebSocket connections so a revoked or lowered grant takes effect at once
 * instead of lasting until their token expires. Best effort: the change is already persisted, and
 * the 15-minute token lifetime bounds the damage if the daemon is unreachable.
 */
export async function revokeLiveSessions(userId: string): Promise<void> {
  try {
    const res = await wardendFetch("/sessions/revoke", { method: "POST", body: JSON.stringify({ userId }) });
    if (!res.ok) console.warn(`[beacon] wardend refused the session revoke for ${userId}: ${res.status}`);
  } catch (e) {
    console.warn(`[beacon] could not reach wardend to revoke sessions for ${userId}`, e);
  }
}
