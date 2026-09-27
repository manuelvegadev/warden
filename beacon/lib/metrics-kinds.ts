/** The charts of the Metrics section and of the dashboard's Metrics module (ADR-026). */

export const METRIC_KINDS = ["cpu", "memory", "tps", "players", "disk", "network"] as const;
export type MetricKind = (typeof METRIC_KINDS)[number];

export const METRIC_LABEL: Record<MetricKind, string> = {
  cpu: "CPU",
  memory: "Memory",
  tps: "TPS",
  players: "Players",
  disk: "Disk",
  network: "Host network",
};

export const isMetricKind = (v: unknown): v is MetricKind =>
  typeof v === "string" && (METRIC_KINDS as readonly string[]).includes(v);

/** The kinds (charts, or key figures) that apply to this software: TPS only where the software reports it. */
export const applicableKinds = <K extends string>(kinds: readonly K[], tpsAvailable: boolean): K[] =>
  kinds.filter((k) => k !== "tps" || tpsAvailable);
