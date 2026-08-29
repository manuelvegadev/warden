"use client";

import { Card, CardContent } from "@warden/ui/components/card";
import Link from "next/link";
import { useInstances } from "@/components/instances-store";
import { SoftwareBadge } from "@/components/software-badge";
import { StateBadge } from "@/components/state-badge";
import { hasBuilds } from "@/lib/api";
import { instanceHref } from "@/lib/instance-routes";
import { mono } from "@/lib/utils";

/** Instance cards. Status badges stay live because the parent (Home) feeds the store from the socket. */
export function InstanceList() {
  const { instances } = useInstances();
  if (instances.length === 0) {
    return <p className="text-sm text-muted-foreground">No instances yet. Create one to get started.</p>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {instances.map((i) => (
        <Link key={i.id} href={instanceHref(i.id)}>
          <Card className="py-0 transition-colors hover:bg-accent/40">
            <CardContent className="flex items-center justify-between gap-3 px-4 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{i.name}</span>
                  <SoftwareBadge software={i.software} />
                </div>
                <div className={`mt-1 text-xs text-muted-foreground ${mono}`}>
                  {i.mcVersion}
                  {hasBuilds(i.software) && i.build ? ` #${i.build}` : ""} · port {i.port} · {i.memoryMb} MB
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-sm">
                {i.status.state === "running" && (
                  <span className="text-muted-foreground">{i.status.players.length} online</span>
                )}
                <StateBadge state={i.status.state} />
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
