"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-client";

export function UserMenu({ name, email, role }: { name: string; email: string; role: string }) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-muted-foreground" title={email}>
        {name}
      </span>
      <Badge variant="secondary">{role}</Badge>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => signOut({ fetchOptions: { onSuccess: () => router.push("/login") } })}
      >
        Sign out
      </Button>
    </div>
  );
}
