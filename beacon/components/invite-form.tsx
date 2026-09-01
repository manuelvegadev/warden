"use client";

import { BeaconMark } from "@warden/ui/components/brand";
import { Button } from "@warden/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@warden/ui/components/card";
import { Input } from "@warden/ui/components/input";
import { Label } from "@warden/ui/components/label";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { type InstanceRole, labelForInstanceRole } from "@/lib/access";
import { authClient, signIn, signOut, signUp } from "@/lib/auth-client";

/**
 * Accepting turns the invitation into a real grant (the `afterAcceptInvitation` hook), so a guest
 * with no account signs up first — the sign-up hook lets them through precisely because this
 * invitation is pending for their address.
 */
export function InviteForm({
  invitationId,
  email,
  organizationName,
  instanceId,
  instanceRole,
  signedInAs,
}: {
  invitationId: string;
  email: string;
  organizationName: string;
  instanceId: string | null;
  instanceRole: InstanceRole | null;
  signedInAs: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [pending, setPending] = useState(false);

  // The instance id, not its display name: this page has no session, so it cannot ask wardend.
  const grant =
    instanceId && instanceRole ? `the ${labelForInstanceRole[instanceRole]} role on ${instanceId}` : "access";

  async function accept() {
    const { error } = await authClient.organization.acceptInvitation({ invitationId });
    if (error) {
      toast.error(error.message ?? "Could not accept the invitation");
      return false;
    }
    router.push("/");
    router.refresh();
    return true;
  }

  async function onAcceptClick() {
    setPending(true);
    await accept();
    setPending(false);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get("password"));
    setPending(true);
    const res =
      mode === "signup"
        ? await signUp.email({ email, password, name: String(fd.get("name")) })
        : await signIn.email({ email, password });
    if (res.error) {
      setPending(false);
      toast.error(res.error.message ?? "Authentication error");
      return;
    }
    await accept();
    setPending(false);
  }

  const header = (
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <BeaconMark />
        Join {organizationName}
      </CardTitle>
      <CardDescription>
        You were invited as <span className="font-medium text-foreground">{email}</span> with {grant}.
      </CardDescription>
    </CardHeader>
  );

  // Signed in as somebody else: accepting would attach the grant to the wrong account.
  if (signedInAs && signedInAs.toLowerCase() !== email.toLowerCase()) {
    return (
      <Card className="w-full max-w-sm">
        {header}
        <CardContent className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            You are signed in as <span className="font-medium text-foreground">{signedInAs}</span>. Sign out to accept
            this invitation.
          </p>
          <Button variant="outline" onClick={() => signOut({ fetchOptions: { onSuccess: () => router.refresh() } })}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (signedInAs) {
    return (
      <Card className="w-full max-w-sm">
        {header}
        <CardContent>
          <Button className="w-full" onClick={onAcceptClick} disabled={pending}>
            {pending ? "…" : "Accept invitation"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      {header}
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input id="invite-email" value={email} readOnly disabled />
          </div>
          {mode === "signup" && (
            <div className="grid gap-2">
              <Label htmlFor="invite-name">Name</Label>
              <Input id="invite-name" name="name" required autoFocus autoComplete="name" />
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="invite-password">Password</Label>
            <Input
              id="invite-password"
              name="password"
              type="password"
              required
              minLength={12}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "…" : mode === "signup" ? "Create account and join" : "Sign in and join"}
          </Button>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:underline"
            onClick={() => setMode(mode === "signup" ? "login" : "signup")}
          >
            {mode === "signup" ? "I already have a Beacon account" : "I need to create an account"}
          </button>
        </form>
      </CardContent>
    </Card>
  );
}
