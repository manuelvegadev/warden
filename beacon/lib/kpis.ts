/** The key figures the Overview's KPI strip can show, across its full width (ADR-026). Pure. */

export const KPI_KINDS = ["cpu", "memory", "tps", "players", "uptime", "network", "disk"] as const;

export type KpiKind = (typeof KPI_KINDS)[number];

export const KPI_LABEL: Record<KpiKind, string> = {
  cpu: "CPU",
  memory: "RAM",
  tps: "TPS",
  players: "Players",
  uptime: "Uptime",
  network: "Host network",
  disk: "Disk",
};

/** The strip a new layout starts with. */
export const DEFAULT_KPIS: readonly KpiKind[] = ["cpu", "memory", "tps", "players", "uptime", "network"];

export const isKpiKind = (v: unknown): v is KpiKind => typeof v === "string" && KPI_KINDS.includes(v as KpiKind);

/**
 * A stored strip as it may be shown: known kinds, each once, in the order given. Anything that is not
 * a list takes the default; an empty list is kept — the strip is hidden.
 */
export function normalizeKpis(raw: unknown): KpiKind[] {
  if (!Array.isArray(raw)) return [...DEFAULT_KPIS];
  return [...new Set(raw.filter(isKpiKind))];
}
