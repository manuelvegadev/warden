"use client";

import { Button } from "@warden/ui/components/button";
import { Input } from "@warden/ui/components/input";
import { Label } from "@warden/ui/components/label";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { SectionCard } from "@/components/instance/section-card";
import { authClient } from "@/lib/auth-client";

export function AccountForms({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<"profile" | "password" | null>(null);

  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending("profile");
    const { error } = await authClient.updateUser({ name: String(fd.get("name")) });
    setPending(null);
    if (error) return toast.error(error.message ?? "Could not update profile");
    toast.success("Profile updated");
    router.refresh();
  }

  async function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const next = String(fd.get("new"));
    if (next !== String(fd.get("confirm"))) return toast.error("New passwords do not match");
    setPending("password");
    const { error } = await authClient.changePassword({
      currentPassword: String(fd.get("current")),
      newPassword: next,
      revokeOtherSessions: true,
    });
    setPending(null);
    if (error) return toast.error(error.message ?? "Could not change password");
    toast.success("Password changed; other sessions were signed out");
    form.reset();
  }

  return (
    <div className="mt-6 grid gap-8">
      <SectionCard title="Profile" subtitle="How you appear in the panel and in ban records.">
        <form onSubmit={saveProfile} className="grid gap-4 px-5 py-4">
          <div className="grid gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" defaultValue={name} required maxLength={64} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={email} readOnly disabled />
          </div>
          <Button type="submit" className="w-fit" disabled={pending === "profile"}>
            {pending === "profile" ? "Saving…" : "Save profile"}
          </Button>
        </form>
      </SectionCard>

      <SectionCard id="password" title="Password" subtitle="Changing it signs out your other sessions.">
        <form onSubmit={changePassword} className="grid gap-4 px-5 py-4">
          <div className="grid gap-1.5">
            <Label htmlFor="current">Current password</Label>
            <Input id="current" name="current" type="password" required autoComplete="current-password" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="new">New password</Label>
              <Input id="new" name="new" type="password" required minLength={12} autoComplete="new-password" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="confirm">Confirm</Label>
              <Input id="confirm" name="confirm" type="password" required minLength={12} autoComplete="new-password" />
            </div>
          </div>
          <Button type="submit" className="w-fit" disabled={pending === "password"}>
            {pending === "password" ? "Changing…" : "Change password"}
          </Button>
        </form>
      </SectionCard>
    </div>
  );
}
