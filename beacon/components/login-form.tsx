"use client";

import { BeaconMark } from "@warden/ui/components/brand";
import { Button } from "@warden/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@warden/ui/components/card";
import { Input } from "@warden/ui/components/input";
import { Label } from "@warden/ui/components/label";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { signIn, signUp } from "@/lib/auth-client";

export function LoginForm({ next = "/" }: { next?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email"));
    const password = String(fd.get("password"));
    const res =
      mode === "login"
        ? await signIn.email({ email, password })
        : await signUp.email({ email, password, name: String(fd.get("name")) });
    setPending(false);
    if (res.error) {
      toast.error(res.error.message ?? "Authentication error");
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BeaconMark />
          Beacon
        </CardTitle>
        <CardDescription>
          {mode === "login" ? "Sign in to manage your servers." : "Create the administrator account."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          {mode === "signup" && (
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required autoComplete="name" />
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={12}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "…" : mode === "login" ? "Sign in" : "Create account"}
          </Button>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:underline"
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
          >
            {mode === "login" ? "First time? Create an administrator account" : "I already have an account"}
          </button>
        </form>
      </CardContent>
    </Card>
  );
}
