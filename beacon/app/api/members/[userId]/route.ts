import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { INSTANCE_ROLES, isInstanceRole } from "@/lib/access";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { badRequest, forbidden, jsonError } from "@/lib/http";
import { type Membership, requireMemberManager, revokeLiveSessions } from "@/lib/members";
import { membershipOf, removeAllGrants, removeGrant, setGrant } from "@/lib/org";

// Per-instance grants and membership removal (ADR-017 §2, §7). Every change that can take something
// away also drops the user's live connections, so it does not linger until their token expires.

type Target = Membership & { memberId: string };

/** The manager making the change and the member being changed, or the response that refuses it. */
async function resolve(
  params: Promise<{ userId: string }>,
  action: string,
): Promise<{ manager: Membership; target: Target } | NextResponse> {
  const manager = await requireMemberManager();
  if (!manager) return forbidden(`Only owners and admins may ${action}`);
  const { userId } = await params;
  const membership = membershipOf(getDb(), userId);
  if (!membership || membership.organizationId !== manager.organizationId) {
    return badRequest("Not a member of your organization");
  }
  return { manager, target: { ...membership, userId } };
}

/** PATCH: grant, change or drop one instance for this member. `role: null` removes the grant. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const resolved = await resolve(ctx.params, "change access");
  if (resolved instanceof NextResponse) return resolved;
  const { manager, target } = resolved;
  // Owners and admins already reach every instance; a grant on top would be noise, and lowering an
  // owner from here would be a way around the organization roles.
  if (target.role !== "member") {
    return badRequest(`A member with the ${target.role} role already reaches every instance`);
  }

  const body = (await req.json().catch(() => ({}))) as { instanceId?: string; role?: string | null };
  const instanceId = body.instanceId?.trim();
  if (!instanceId) return badRequest("instanceId is required");

  const db = getDb();
  if (body.role === null) {
    removeGrant(db, target.userId, instanceId);
  } else if (isInstanceRole(body.role)) {
    setGrant(db, { organizationId: manager.organizationId, userId: target.userId, instanceId, role: body.role });
  } else {
    return badRequest(`role must be null or one of ${INSTANCE_ROLES.join(", ")}`);
  }

  await revokeLiveSessions(target.userId);
  return new NextResponse(null, { status: 204 });
}

/** DELETE: remove the member from the organization, grants included. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const resolved = await resolve(ctx.params, "remove members");
  if (resolved instanceof NextResponse) return resolved;
  const { manager, target } = resolved;
  if (target.userId === manager.userId) return badRequest("You cannot remove yourself");
  if (target.role === "owner") return badRequest("The owner cannot be removed");

  try {
    await auth.api.removeMember({
      body: { memberIdOrEmail: target.memberId, organizationId: manager.organizationId },
      headers: await headers(),
    });
  } catch (e) {
    return jsonError(400, "remove_failed", e instanceof Error ? e.message : "Could not remove the member");
  }
  removeAllGrants(getDb(), target.userId);
  await revokeLiveSessions(target.userId);
  return new NextResponse(null, { status: 204 });
}
