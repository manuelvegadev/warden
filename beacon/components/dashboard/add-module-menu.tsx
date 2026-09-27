"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@warden/ui/components/dropdown-menu";
import { Plus } from "lucide-react";
import { addableKinds, addModule } from "@/lib/dashboard-edit";
import { type DashboardLayout, MAX_MODULES } from "@/lib/dashboard-layout";

/**
 * "+ Add module" at the foot of a column in edit mode (ADR-026): every kind not already at its
 * unique limit: the server's first, then the daemon's and its host's. Hidden once the column holds `MAX_MODULES`.
 */
export function AddModuleMenu({
  layout,
  columnId,
  onLayout,
}: {
  layout: DashboardLayout;
  columnId: string;
  onLayout: (layout: DashboardLayout) => void;
}) {
  const column = layout.columns.find((c) => c.id === columnId);
  if (!column || column.modules.length >= MAX_MODULES) return null;

  const kinds = addableKinds(layout);
  const global = kinds.filter((k) => k.scope === "global");
  const server = kinds.filter((k) => k.scope === "server");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-dashed text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
        <Plus className="size-3.5" />
        Add module
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" sideOffset={4} className="w-56">
        {server.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Server</DropdownMenuLabel>
            {server.map((k) => (
              <DropdownMenuItem key={k.kind} onClick={() => onLayout(addModule(layout, columnId, k.kind))}>
                {k.title}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
        {global.length > 0 && server.length > 0 && <DropdownMenuSeparator />}
        {global.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Wardend and host</DropdownMenuLabel>
            {global.map((k) => (
              <DropdownMenuItem key={k.kind} onClick={() => onLayout(addModule(layout, columnId, k.kind))}>
                {k.title}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
