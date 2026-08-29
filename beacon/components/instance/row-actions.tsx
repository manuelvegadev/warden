"use client";

import { Button } from "@warden/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@warden/ui/components/dropdown-menu";
import { MoreHorizontal } from "lucide-react";

/** The "…" menu at the end of a table row. Items go inside DropdownMenuGroup/DropdownMenuItem. */
export function RowActions({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={label} />}>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
