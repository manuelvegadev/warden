"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { instances, type InstanceStatus, type InstanceSummary } from "@/lib/api";
import { useWardendSocket, type WsMessage } from "@/hooks/use-wardend-socket";
import { StateBadge } from "@/components/state-badge";
import { CreateInstanceDialog } from "@/components/create-instance-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function InstanceList() {
  const [items, setItems] = useState<InstanceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    instances
      .list()
      .then((list) => {
        setItems(list);
        setError(null);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onMessage = useCallback((msg: WsMessage) => {
    if (msg.type === "state" && msg.instance) {
      const status = msg.data as InstanceStatus;
      setItems((prev) => prev?.map((i) => (i.id === msg.instance ? { ...i, status } : i)) ?? prev);
    }
  }, []);
  useWardendSocket(items?.map((i) => i.id) ?? [], onMessage);

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Instances</h1>
        <CreateInstanceDialog onCreated={refresh} />
      </div>
      {error && <p className="text-sm text-destructive">Cannot reach wardend: {error}</p>}
      {!items && !error && <Skeleton className="h-24 w-full" />}
      {items?.length === 0 && <p className="text-muted-foreground">No instances yet. Create one to get started.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {items?.map((i) => (
          <Link key={i.id} href={`/instances/${i.id}`}>
            <Card className="transition-colors hover:bg-accent/40">
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <div className="font-medium">{i.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {i.software} {i.mcVersion}
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
