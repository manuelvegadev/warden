"use client";

import Link from "next/link";
import { useCallback } from "react";
import { useInstances } from "@/components/instances-store";
import { StateBadge } from "@/components/state-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useWardendSocket, type WsMessage } from "@/hooks/use-wardend-socket";
import { type InstanceStatus, softwareLabel } from "@/lib/api";
import { instanceHref } from "@/lib/instance-routes";

export function InstanceList() {
  const { instances, setStatus, openCreate } = useInstances();

  // Keep the badges live while the list is on screen.
  const onMessage = useCallback(
    (msg: WsMessage) => {
      if (msg.type === "state" && msg.instance) setStatus(msg.instance, msg.data as InstanceStatus);
    },
    [setStatus],
  );
  useWardendSocket(
    instances.map((i) => i.id),
    onMessage,
  );

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Instances</h1>
        <Button onClick={openCreate}>New instance</Button>
      </div>
      {instances.length === 0 && <p className="text-muted-foreground">No instances yet. Create one to get started.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {instances.map((i) => (
          <Link key={i.id} href={instanceHref(i.id)}>
            <Card className="transition-colors hover:bg-accent/40">
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <div className="font-medium">{i.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {softwareLabel(i)}
                    {i.build ? ` #${i.build}` : ""} · port {i.port} · {i.memoryMb} MB
                  </div>
                </div>
                <div className="flex items-center gap-3 text-sm">
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
    </>
  );
}
