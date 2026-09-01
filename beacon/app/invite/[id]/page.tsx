import { BeaconMark } from "@warden/ui/components/brand";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@warden/ui/components/card";
import Link from "next/link";
import { InviteForm } from "@/components/invite-form";
import { getDb } from "@/lib/db";
import { publicInvitation } from "@/lib/org";
import { getSession } from "@/lib/session";

// Reached by someone who very likely has no account yet, so this page lives outside the dashboard
// and reads the invitation straight from the database (ADR-017 §6).
export default async function InvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [invitation, session] = await Promise.all([Promise.resolve(publicInvitation(getDb(), id)), getSession()]);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      {invitation ? (
        <InviteForm
          invitationId={id}
          email={invitation.email}
          organizationName={invitation.organizationName}
          instanceId={invitation.instanceId}
          instanceRole={invitation.instanceRole}
          signedInAs={session?.user.email ?? null}
        />
      ) : (
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BeaconMark />
              Invitation not valid
            </CardTitle>
            <CardDescription>
              This link has already been used, was cancelled, or has expired. Ask whoever invited you for a new one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/login" className="text-sm underline underline-offset-4">
              Go to sign in
            </Link>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
