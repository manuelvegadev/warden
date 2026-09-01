"use client";

import { Avatar, AvatarFallback } from "@warden/ui/components/avatar";
import { BeaconMark } from "@warden/ui/components/brand";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@warden/ui/components/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@warden/ui/components/sidebar";
import { Coffee, Download, House, KeyRound, LogOut, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { sectionGroupsFor } from "@/components/instance/sections";
import { InstanceSwitcher } from "@/components/instance-switcher";
import { useInstances } from "@/components/instances-store";
import { Versions } from "@/components/versions";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { DEFAULT_SOFTWARE } from "@/lib/api";
import { signOut } from "@/lib/auth-client";
import { HOME, instanceHref } from "@/lib/instance-routes";

type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; active: boolean };

function NavItems({ items }: { items: Item[] }) {
  return (
    <SidebarMenu>
      {items.map(({ href, label, icon: Icon, active }) => (
        <SidebarMenuItem key={href}>
          <SidebarMenuButton isActive={active} tooltip={label} render={<Link href={href} />}>
            <Icon />
            <span>{label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}

export function AppSidebar({
  user,
  canManageMembers,
}: {
  user: { name: string; email: string; role: string };
  canManageMembers: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const install = useInstallPrompt();
  const { id: instanceId } = useParams<{ id?: string }>();
  const { instances, roleOf } = useInstances();
  const software = instances.find((i) => i.id === instanceId)?.software ?? DEFAULT_SOFTWARE;

  // Nine flat entries were a wall; the registry buckets them into Server / World / Players.
  const groups = instanceId
    ? sectionGroupsFor(software, roleOf(instanceId)).map(({ group, sections }) => ({
        label: group,
        items: sections.map((s) => ({
          href: instanceHref(instanceId, s.slug),
          label: s.label,
          icon: s.icon,
          active: pathname === instanceHref(instanceId, s.slug),
        })),
      }))
    : [{ label: undefined, items: [{ ...HOME, icon: House, active: pathname === HOME.href }] }];
  const secondary: Item[] = [
    ...(canManageMembers
      ? [{ href: "/settings/members", label: "Members", icon: Users, active: pathname.startsWith("/settings/members") }]
      : []),
    { href: "/settings/java", label: "Java runtimes", icon: Coffee, active: pathname.startsWith("/settings/java") },
  ];

  return (
    <Sidebar variant="inset" collapsible="offcanvas">
      <SidebarHeader className="gap-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton className="data-[slot=sidebar-menu-button]:!p-1.5" render={<Link href="/" />}>
              <BeaconMark className="!size-5" />
              <span className="text-base font-semibold">Beacon</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <InstanceSwitcher currentId={instanceId} />
      </SidebarHeader>

      <SidebarContent>
        {groups.map(({ label, items }) => (
          <SidebarGroup key={label ?? "root"}>
            {label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <NavItems items={items} />
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
        {/* Secondary nav anchored above the footer (dashboard-01 pattern). */}
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <NavItems items={secondary} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="mt-3 gap-2">
        <Versions />
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent" />}
              >
                <Avatar className="size-8 rounded-md">
                  <AvatarFallback className="rounded-md">{user.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="grid min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="grid leading-tight">
                    <span className="font-medium">{user.name}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {user.email} · {user.role}
                    </span>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem render={<Link href="/settings/account" />}>
                    <UserRound /> Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem render={<Link href="/settings/account#password" />}>
                    <KeyRound /> Change password
                  </DropdownMenuItem>
                  {install && (
                    <DropdownMenuItem onClick={install}>
                      <Download /> Install app
                    </DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => signOut({ fetchOptions: { onSuccess: () => router.push("/login") } })}>
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
