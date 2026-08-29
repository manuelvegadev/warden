"use client";

import { Coffee, KeyRound, LogOut, Server, UserRound } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { SECTIONS } from "@/components/instance/sections";
import { InstanceSwitcher } from "@/components/instance-switcher";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
} from "@/components/ui/sidebar";
import { signOut } from "@/lib/auth-client";
import { instanceHref } from "@/lib/instance-routes";

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

export function AppSidebar({ user }: { user: { name: string; email: string; role: string } }) {
  const pathname = usePathname();
  const router = useRouter();
  const { id: instanceId } = useParams<{ id?: string }>();

  const main: Item[] = instanceId
    ? SECTIONS.map((s) => ({
        href: instanceHref(instanceId, s.slug),
        label: s.label,
        icon: s.icon,
        active: pathname === instanceHref(instanceId, s.slug),
      }))
    : [{ href: "/", label: "All instances", icon: Server, active: pathname === "/" }];
  const secondary: Item[] = [
    { href: "/settings/java", label: "Java runtimes", icon: Coffee, active: pathname.startsWith("/settings/java") },
  ];

  return (
    <Sidebar variant="inset" collapsible="offcanvas">
      <SidebarHeader className="gap-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton className="data-[slot=sidebar-menu-button]:!p-1.5" render={<Link href="/" />}>
              <Server className="!size-5" />
              <span className="text-base font-semibold">Beacon</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <InstanceSwitcher currentId={instanceId} />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          {instanceId && <SidebarGroupLabel>Instance</SidebarGroupLabel>}
          <SidebarGroupContent>
            <NavItems items={main} />
          </SidebarGroupContent>
        </SidebarGroup>
        {/* Secondary nav anchored above the footer (dashboard-01 pattern). */}
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <NavItems items={secondary} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="mt-3">
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
