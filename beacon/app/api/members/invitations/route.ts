import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { isInstanceRole } from "@/lib/access";
import { auth } from "@/lib/auth";
import { badRequest, forbidden, jsonError } from "@/lib/http";
import { requireMemberManager } from "@/lib/members";

// Invitations (ADR-017 §6). No mail server: the caller shows the invitee the link.

export async function POST(req: NextRequest) {
  const manager = await requireMemberManager();
  if (!manager) return forbidden("Only owners and admins may invite");

  const body = (await req.json().catch(() => ({}))) as { email?: string; instanceId?: string; instanceRole?: string };
  const email = body.email?.trim().toLowerCase();
  if (!email) return badRequest("email is required");
  // An invitation always names what it gives access to; without it the guest would land on nothing.
  if (!body.instanceId || !isInstanceRole(body.instanceRole)) {
    return badRequest("instanceId and a valid instanceRole are required");
  }

  try {
    // nodeId is filled in by the invitation schema's default (lib/auth.ts).
    const invitation = await auth.api.createInvitation({
      body: {
        email,
        role: "member",
        organizationId: manager.organizationId,
        resend: true,
        instanceId: body.instanceId,
        instanceRole: body.instanceRole,
      },
      headers: await headers(),
    });
    return NextResponse.json({ id: invitation.id }, { status: 201 });
  } catch (e) {
    return jsonError(400, "invite_failed", e instanceof Error ? e.message : "Could not create the invitation");
  }
}

export async function DELETE(req: NextRequest) {
  const manager = await requireMemberManager();
  if (!manager) return forbidden("Only owners and admins may cancel invitations");

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return badRequest("id is required");
  try {
    await auth.api.cancelInvitation({ body: { invitationId: id }, headers: await headers() });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return jsonError(400, "cancel_failed", e instanceof Error ? e.message : "Could not cancel the invitation");
  }
}
