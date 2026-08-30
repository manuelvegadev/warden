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
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@warden/ui/components/sidebar";
import { Check, ChevronsUpDown, Plus, Server, Upload } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useInstances } from "@/components/instances-store";
import { StateBadge } from "@/components/state-badge";
import { softwareLabel } from "@/lib/api";
import { instanceHref } from "@/lib/instance-routes";

/** Sidebar header control: shows the open instance and switches between instances (sidebar-07 "team switcher" pattern). */
export function InstanceSwitcher({ currentId }: { currentId?: string }) {
  const { instances, refresh, openCreate, openImport } = useInstances();
  const [open, setOpen] = useState(false);
  const current = instances.find((i) => i.id === currentId);
  const title = current?.name ?? currentId ?? "All instances";
  const subtitle = current
    ? softwareLabel(current)
    : `${instances.length} instance${instances.length === 1 ? "" : "s"}`;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (o) void refresh(); // fresh states while the menu is open
          }}
        >
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="border border-sidebar-border bg-sidebar-accent/40 data-[state=open]:bg-sidebar-accent"
              />
            }
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Server className="size-4" />
            </div>
            <div className="grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate font-semibold">{title}</span>
              <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
            </div>
            <ChevronsUpDown className="ml-auto size-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" sideOffset={4} className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">Instances</DropdownMenuLabel>
              {instances.map((i) => (
                <DropdownMenuItem key={i.id} className="gap-2" render={<Link href={instanceHref(i.id)} />}>
                  <Server className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{i.name}</span>
                  <StateBadge state={i.status.state} />
                  {i.id === currentId && <Check className="size-4" />}
                </DropdownMenuItem>
              ))}
              {instances.length === 0 && <DropdownMenuItem disabled>No instances yet</DropdownMenuItem>}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem render={<Link href="/" />}>All instances</DropdownMenuItem>
              <DropdownMenuItem onClick={openCreate}>
                <Plus className="size-4" /> New instance
              </DropdownMenuItem>
              <DropdownMenuItem onClick={openImport}>
                <Upload className="size-4" /> Import server
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
