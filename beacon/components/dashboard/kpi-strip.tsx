"use client";

import { Button } from "@warden/ui/components/button";
import { Clock, X } from "lucide-react";
import { EditChrome, iconButton, KindPicker } from "@/components/dashboard/edit-chrome";
import { useInstance } from "@/components/instance/instance-context";
import { ResourceTile, useResourceTiles } from "@/components/instance/resource-cards";
import { StatTile } from "@/components/stat-tile";
import { Uptime } from "@/hooks/use-uptime";
import { hasTps } from "@/lib/api";
import { DEFAULT_KPIS, KPI_KINDS, KPI_LABEL, type KpiKind } from "@/lib/kpis";
import { applicableKinds } from "@/lib/metrics-kinds";

/**
 * The Overview's key figures in one row across the top (ADR-026): each a tile with its trend, as
 * many as the user picked, sharing the width. While editing, a dashed outline and a bar to pick them
 * (the gear) or hide the strip (✕); a hidden strip leaves a line to bring it back.
 */
export function KpiStrip({
  kpis,
  editing,
  onKpis,
}: {
  kpis: KpiKind[];
  editing: boolean;
  onKpis: (next: KpiKind[]) => void;
}) {
  const { manifest, status, metrics, history } = useInstance();
  const { live, plot, tiles } = useResourceTiles({
    metrics,
    history,
    state: status.state,
    tps: status.tps,
    memoryMb: manifest.memoryMb,
  });
  const tps = hasTps(manifest.software);
  const shown = applicableKinds(kpis, tps);

  if (shown.length === 0) {
    if (!editing) return null;
    return (
      <div className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground">
        The key figures are hidden.
        <Button size="sm" variant="ghost" onClick={() => onKpis([...DEFAULT_KPIS])}>
          Show them
        </Button>
      </div>
    );
  }

  const strip = (
    // As many tiles as fit side by side, each at least 10rem, sharing the row; the rest wrap.
    <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-4 sm:gap-5">
      {shown.map((k) =>
        k === "uptime" ? (
          <StatTile
            key={k}
            label="Uptime"
            icon={Clock}
            value={live ? <Uptime startedAt={status.startedAt} /> : "—"}
            detail={live ? "since the last start" : status.state}
            className="h-28"
          />
        ) : (
          <ResourceTile key={k} spec={tiles[k]} plot={plot} live={live} />
        ),
      )}
    </div>
  );
  if (!editing) return <div className="@container shrink-0">{strip}</div>;

  // A kind is put back where it belongs in the canonical order, not at the end.
  const toggle = (kind: KpiKind, checked: boolean) =>
    onKpis(checked ? KPI_KINDS.filter((k) => k === kind || kpis.includes(k)) : kpis.filter((k) => k !== kind));

  return (
    <EditChrome
      title="Key figures"
      className="@container shrink-0"
      trailing={
        <>
          <KindPicker
            label="Choose the key figures"
            kinds={applicableKinds(KPI_KINDS, tps)}
            labels={KPI_LABEL}
            checked={kpis}
            onToggle={toggle}
          />
          <button type="button" aria-label="Hide the key figures" onClick={() => onKpis([])} className={iconButton}>
            <X />
          </button>
        </>
      }
    >
      {strip}
    </EditChrome>
  );
}
