"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Fragment } from "react";
import { sectionBySlug } from "@/components/instance/sections";
import { useInstances } from "@/components/instances-store";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { HOME } from "@/lib/instance-routes";

const PAGES: Record<string, string> = {
  "/settings/java": "Java runtimes",
  "/settings/account": "Account",
};

/** Sidebar trigger + breadcrumb. Two shapes: Beacon › <instance> › <section>, or Beacon › <page>. */
export function SiteHeader() {
  const pathname = usePathname();
  const { id, section } = useParams<{ id?: string; section?: string }>();
  const { instances } = useInstances();

  const crumbs: { href: string; label: string }[] = [];
  if (id) {
    crumbs.push({ href: `/instances/${id}`, label: instances.find((i) => i.id === id)?.name ?? id });
    const def = section ? sectionBySlug(section) : undefined;
    if (def) crumbs.push({ href: pathname, label: def.label });
  } else if (PAGES[pathname]) {
    crumbs.push({ href: pathname, label: PAGES[pathname] });
  }

  return (
    <header className="flex h-12 shrink-0 items-stretch gap-2 border-b bg-background px-4">
      <SidebarTrigger variant="ghost" size="icon-sm" className="-ml-1 self-center" aria-label="Toggle sidebar" />
      <Separator
        orientation="vertical"
        className="mr-2 data-[orientation=vertical]:h-auto data-[orientation=vertical]:self-stretch"
      />
      <Breadcrumb className="self-center">
        <BreadcrumbList>
          <BreadcrumbItem>
            {crumbs.length === 0 ? (
              <BreadcrumbPage>{HOME.label}</BreadcrumbPage>
            ) : (
              <BreadcrumbLink render={<Link href={HOME.href} />}>{HOME.label}</BreadcrumbLink>
            )}
          </BreadcrumbItem>
          {crumbs.map((c, i) => (
            <Fragment key={c.href}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {i === crumbs.length - 1 ? (
                  <BreadcrumbPage>{c.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink render={<Link href={c.href} />}>{c.label}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  );
}
