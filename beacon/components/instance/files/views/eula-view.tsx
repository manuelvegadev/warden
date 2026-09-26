"use client";

import { Button } from "@warden/ui/components/button";
import { badgeTone } from "@warden/ui/lib/badge-tone";
import { cn } from "@warden/ui/lib/utils";
import { Check, ExternalLink, FileWarning } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { instances } from "@/lib/api";

const EULA_URL = "https://aka.ms/MinecraftEULA";

/**
 * eula.txt as the one question it asks (ADR-020): whether Mojang's EULA is accepted, which the
 * server needs before it starts, and the button that accepts it.
 */
export function EulaView({
  id,
  text,
  canManage,
  onChanged,
}: {
  id: string;
  text: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const accepted = /^\s*eula\s*=\s*true\s*$/im.test(text);
  const [busy, setBusy] = useState(false);
  const accept = async () => {
    setBusy(true);
    try {
      await instances.acceptEula(id);
      toast.success("EULA accepted");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not accept the EULA");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="grid max-w-sm gap-3 text-center">
        <div
          className={cn(
            "mx-auto flex size-12 items-center justify-center rounded-full border",
            accepted ? badgeTone.emerald : badgeTone.amber,
          )}
        >
          {accepted ? <Check className="size-6" /> : <FileWarning className="size-6" />}
        </div>
        <p className="font-medium">{accepted ? "The EULA is accepted" : "The EULA is not accepted"}</p>
        <p className="text-sm text-muted-foreground text-balance">
          {accepted
            ? "The server may run: its operator has agreed to Mojang's end user licence agreement."
            : "The server will not start until its operator agrees to Mojang's end user licence agreement."}
        </p>
        <a
          href={EULA_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
        >
          Read the EULA <ExternalLink className="size-3" />
        </a>
        {!accepted && canManage && (
          <Button className="mx-auto" onClick={accept} disabled={busy}>
            <Check /> I accept the EULA
          </Button>
        )}
      </div>
    </div>
  );
}
