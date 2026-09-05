"use client";

import { Button } from "@warden/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@warden/ui/components/dialog";
import { Input } from "@warden/ui/components/input";
import { useEffect, useState } from "react";
import { isValidName } from "@/lib/fs-path";
import { mono } from "@/lib/utils";

/**
 * Asks for a file or folder name: new folder, new file, rename. `open` doubles as the payload —
 * pass null to close. `taken` names what already exists in the directory, so a collision is
 * refused before the daemon has to.
 */
export function NameDialog({
  open,
  onClose,
  onSubmit,
  taken,
}: {
  open: {
    title: string;
    description?: React.ReactNode;
    submitLabel: string;
    initial?: string;
    /** Select the name without its extension on focus (renaming a file). */
    selectStem?: boolean;
  } | null;
  onClose: () => void;
  onSubmit: (name: string) => void;
  taken: readonly string[];
}) {
  const [name, setName] = useState("");
  useEffect(() => {
    if (open) setName(open.initial ?? "");
  }, [open]);

  const trimmed = name.trim();
  const unchanged = open?.initial !== undefined && trimmed === open.initial;
  const exists = !unchanged && taken.includes(trimmed);
  const valid = isValidName(trimmed) && !unchanged && !exists;

  return (
    <Dialog open={open !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {open && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) onSubmit(trimmed);
            }}
            className="grid gap-4"
          >
            <DialogHeader>
              <DialogTitle>{open.title}</DialogTitle>
              {open.description && <DialogDescription>{open.description}</DialogDescription>}
            </DialogHeader>
            <div className="grid gap-1.5">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                spellCheck={false}
                className={mono}
                aria-invalid={exists || undefined}
                onFocus={(e) => {
                  const dot = e.target.value.lastIndexOf(".");
                  if (open.selectStem && dot > 0) e.target.setSelectionRange(0, dot);
                  else e.target.select();
                }}
              />
              {exists && <p className="text-xs text-destructive">Something with that name is already there.</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!valid}>
                {open.submitLabel}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
