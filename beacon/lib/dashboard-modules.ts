/** The kinds of dashboard module (ADR-026): what each is, its scope and its limits. Pure. */

import { isMetricsRange, type MetricsRange } from "@/lib/metrics-axis";
import { isMetricKind, type MetricKind } from "@/lib/metrics-kinds";

export type ModuleScope = "global" | "server";

export interface ModuleMeta {
  kind: string;
  title: string;
  scope: ModuleScope;
  /** At most one per dashboard. */
  unique?: boolean;
  /**
   * Fills the height its column leaves (Console, Metrics, Live view, the activity feed), sharing it
   * with the other fill modules by their sizes; every other module is as tall as its content and
   * never scrolls.
   */
  fill?: { minSize: number; mobileHeight: number };
  defaultSettings?: Record<string, unknown>;
  /** Checks settings; null when they cannot be used (the defaults are taken instead). */
  settings?: (raw: unknown) => Record<string, unknown> | null;
}

export type MetricsSettings = { charts: MetricKind[]; range: MetricsRange };

const metricsSettings = (raw: unknown): MetricsSettings | null => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { charts?: unknown; range?: unknown };
  const charts = Array.isArray(r.charts) ? [...new Set(r.charts.filter(isMetricKind))] : [];
  if (charts.length === 0 || !isMetricsRange(r.range)) return null;
  return { charts, range: r.range };
};

export const MODULES: readonly ModuleMeta[] = [
  { kind: "wardend", title: "Wardend", scope: "global" },
  { kind: "host", title: "Host", scope: "global" },
  { kind: "console", title: "Console", scope: "server", fill: { minSize: 20, mobileHeight: 440 } },
  {
    kind: "metrics",
    title: "Metrics",
    scope: "server",
    fill: { minSize: 20, mobileHeight: 380 },
    defaultSettings: { charts: ["cpu", "memory"], range: "1h" },
    settings: metricsSettings,
  },
  { kind: "liveview", title: "Live view", scope: "server", unique: true, fill: { minSize: 25, mobileHeight: 440 } },
  { kind: "resources", title: "Resources", scope: "server" },
  { kind: "status", title: "Status", scope: "server" },
  { kind: "players", title: "Players online", scope: "server" },
  { kind: "facts", title: "Server facts", scope: "server" },
  { kind: "activity", title: "Recent activity", scope: "server", fill: { minSize: 20, mobileHeight: 360 } },
  { kind: "backups", title: "Backups", scope: "server" },
];

export const moduleMeta = (kind: string): ModuleMeta | undefined => MODULES.find((m) => m.kind === kind);
