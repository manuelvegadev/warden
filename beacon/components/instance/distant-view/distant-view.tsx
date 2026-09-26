"use client";

import { Switch } from "@warden/ui/components/switch";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ProviderCard } from "@/components/instance/distant-view/provider-card";
import { useInstance } from "@/components/instance/instance-context";
import { SectionCard, SettingRow } from "@/components/instance/section-card";
import { useAction } from "@/hooks/use-action";
import type { WsMessage } from "@/hooks/use-wardend-socket";
import { can } from "@/lib/access";
import { formatBytes, type LodInfo, type LodPregenStatus, lod } from "@/lib/api";
import { lodDiskTotal } from "@/lib/lod";

/**
 * Distant view (ADR-025): the server-side plugins that let players see far terrain — Distant
 * Horizons Support and Voxy Server Side / LOD Server Support. One card per family, installed or not;
 * pre-generation progress arrives on the hub (`lod.pregen`).
 */
export function DistantView() {
  const { manifest, status, role, subscribe, task } = useInstance();
  const id = manifest.id;
  const [info, setInfo] = useState<LodInfo | null>(null);

  const refresh = useCallback(() => {
    lod
      .get(id)
      .then(setInfo)
      .catch((e: Error) => toast.error(e.message));
  }, [id]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  // An install or a toggle from here changes what is installed.
  useEffect(() => {
    if (task?.type === "plugin.install" && task.status === "done") refresh();
  }, [task, refresh]);
  // A start or a stop changes what can run live and what the plugins report.
  const state = status.state;
  const seenState = useRef(state);
  useEffect(() => {
    if (seenState.current === state) return;
    seenState.current = state;
    refresh();
  }, [state, refresh]);
  const act = useAction(refresh);

  useEffect(
    () =>
      subscribe((msg: WsMessage) => {
        // The agent connects some time after the server is up, and leaves when it stops.
        if (msg.type === "world.agent") {
          refresh();
          return;
        }
        if (msg.type !== "lod.pregen") return;
        const d = msg.data as LodPregenStatus & { world: string };
        setInfo((prev) => {
          if (!prev) return prev;
          const rest = (prev.pregens ?? []).filter((p) => p.world !== d.world);
          if (d.state === "done" || d.state === "stopped") return { ...prev, pregens: rest };
          const old = (prev.pregens ?? []).find((p) => p.world === d.world);
          const now = new Date().toISOString();
          const next = { ...(old ?? { world: d.world, startedAt: now, session: now }), status: d };
          return { ...prev, pregens: [...rest, next] };
        });
        if (d.state === "done") toast.success(`LODs for ${d.world} are ready`);
      }),
    [subscribe, refresh],
  );

  if (!info) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!info.supported) {
    return <p className="text-sm text-muted-foreground">This server software cannot load plugins.</p>;
  }
  const installed = info.providers.filter((p) => p.installed);
  const bytes = lodDiskTotal(info);
  return (
    <div className="grid grid-cols-1 gap-8">
      {installed.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Let players see terrain far beyond the view distance. Each option needs its client mod on the players' side.
        </p>
      )}
      {installed.length > 0 && state === "running" && !info.agentRuns && (
        <p className="text-sm text-muted-foreground">
          Live actions need the Warden Agent: they apply after the next restart.
        </p>
      )}
      {installed.length > 0 && (
        <SectionCard title="Backups">
          <SettingRow
            id="lod-backup"
            label="Include LOD data in backups"
            description={`Left out by default: it rebuilds on its own${bytes > 0 ? `, and adds ${formatBytes(bytes)} to each backup` : ""}. Included, each store is copied whole as a snapshot, which needs as much free disk space and competes with the plugin's own writes; a store that cannot be copied is left out.`}
          >
            <Switch
              id="lod-backup"
              checked={info.backupIncludeData}
              disabled={!can(role, "backups.write")}
              onCheckedChange={(v) =>
                act(() =>
                  lod.settings(id, v).then(() => (v ? "LOD data will be backed up" : "LOD data left out of backups")),
                )
              }
            />
          </SettingRow>
        </SectionCard>
      )}
      {info.providers.map((p) => (
        <ProviderCard key={p.kind} info={info} provider={p} onChange={refresh} />
      ))}
    </div>
  );
}
