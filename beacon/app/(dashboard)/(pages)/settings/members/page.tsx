import { MembersManager } from "@/components/settings/members-manager";
import { getDb } from "@/lib/db";
import { canManageMembers, currentMembership } from "@/lib/members";
import { defaultOrganizationId, listMembers, listPendingInvitations } from "@/lib/org";
import { loadInstances } from "@/lib/wardend";

export default async function MembersPage() {
  // Only the instances the caller can see, so the invite dialog cannot offer what they do not have.
  const [membership, instances] = await Promise.all([currentMembership(), loadInstances()]);

  if (!canManageMembers(membership)) {
    return (
      <div className="max-w-4xl">
        <Heading />
        <p className="mt-6 rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          Only the owner and the admins of this organization can manage members.
        </p>
      </div>
    );
  }

  const db = getDb();
  const organizationId = defaultOrganizationId(db);
  return (
    <div className="max-w-4xl">
      <Heading />
      <MembersManager
        members={listMembers(db, organizationId)}
        invitations={listPendingInvitations(db, organizationId)}
        instances={instances.map((i) => ({ id: i.id, name: i.name }))}
        currentUserId={membership.userId}
      />
    </div>
  );
}

function Heading() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Members</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Who can reach this panel, and which servers each of them may touch. Beacon has no mail server, so an invitation
        is a link you copy and send yourself.
      </p>
    </>
  );
}
