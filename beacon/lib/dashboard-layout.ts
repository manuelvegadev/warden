/**
 * The Overview dashboard's layout (ADR-026): columns of modules, sizes in percent, one per user, the
 * same on every instance. Pure: the preset, and the normalisation every stored or received layout
 * goes through.
 */
import { moduleMeta } from "@/lib/dashboard-modules";
import { DEFAULT_KPIS, type KpiKind, normalizeKpis } from "@/lib/kpis";

export const LAYOUT_VERSION = 1;
export const MAX_COLUMNS = 4;
export const MAX_MODULES = 6;
export const MAX_LAYOUT_BYTES = 32 * 1024;

export interface DashboardModule {
  id: string;
  kind: string;
  size: number;
  settings?: Record<string, unknown>;
  /** A kind this Beacon does not know: kept, shown as unavailable. */
  unavailable?: boolean;
}

export interface DashboardColumn {
  id: string;
  size: number;
  modules: DashboardModule[];
}

export interface DashboardLayout {
  version: number;
  /** The KPI strip across the top, in order; empty when the user hid it. */
  kpis: KpiKind[];
  columns: DashboardColumn[];
}

const mod = (id: string, kind: string, size: number): DashboardModule => {
  const d = moduleMeta(kind)?.defaultSettings;
  return d ? { id, kind, size, settings: { ...d } } : { id, kind, size };
};

/**
 * The key figures across the top (their detail is the Metrics section's); under them, the live console
 * as the page's centrepiece, with the server's state, its backups and the recent activity beside it.
 */
export function defaultLayout(): DashboardLayout {
  return {
    version: LAYOUT_VERSION,
    kpis: [...DEFAULT_KPIS],
    columns: [
      { id: "c1", size: 64, modules: [mod("m1", "console", 100)] },
      { id: "c2", size: 36, modules: [mod("m2", "status", 30), mod("m3", "backups", 25), mod("m4", "activity", 45)] },
    ],
  };
}

/** Brings an older layout up to the current version. v1 is the first; later versions add steps here. */
export function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, version: LAYOUT_VERSION };
}

/** Sizes as shares of 100 (2 decimals); a missing or non-positive size takes an equal share. */
function shares<T extends { size: number }>(items: T[]): T[] {
  if (items.length === 0) return items;
  const valid = items.map((x) => (Number.isFinite(x.size) && x.size > 0 ? x.size : 0));
  const known = valid.filter((v) => v > 0);
  const fallback = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
  const sizes = valid.map((v) => (v > 0 ? v : fallback));
  const total = sizes.reduce((a, b) => a + b, 0);
  return items.map((x, i) => ({ ...x, size: Math.round((sizes[i] / total) * 10000) / 100 }));
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * The layout as it may be shown and stored, or null when `raw` is not a layout at all: 1–4 columns,
 * 0–6 modules each, unique ids, sizes adding up to 100, settings checked per kind (the defaults
 * replace bad ones), at most one of a unique kind, unknown kinds kept and marked.
 */
export function normalizeLayout(raw: unknown): DashboardLayout | null {
  const top = obj(raw);
  if (!top || !Array.isArray(top.columns) || top.columns.length === 0) return null;
  const src = migrate(top);
  const used = new Set<string>();
  let n = 0;
  const unique = (id: unknown, prefix: string) => {
    let v = typeof id === "string" && id && !used.has(id) ? id : "";
    while (!v || used.has(v)) v = `${prefix}${++n}`;
    used.add(v);
    return v;
  };
  const seenUnique = new Set<string>();
  const columns: DashboardColumn[] = [];
  for (const rawCol of (src.columns as unknown[]).slice(0, MAX_COLUMNS)) {
    const c = obj(rawCol);
    if (!c) continue;
    const modules: DashboardModule[] = [];
    for (const rawMod of (Array.isArray(c.modules) ? c.modules : []).slice(0, MAX_MODULES)) {
      const m = obj(rawMod);
      if (!m || typeof m.kind !== "string" || !m.kind) continue;
      const meta = moduleMeta(m.kind);
      if (meta?.unique) {
        if (seenUnique.has(meta.kind)) continue;
        seenUnique.add(meta.kind);
      }
      const out: DashboardModule = { id: unique(m.id, "m"), kind: m.kind, size: Number(m.size) };
      if (!meta) {
        out.unavailable = true;
        // A kind this Beacon does not know yet may still carry settings a newer Beacon understands;
        // kept as-is (when they are at least a plain object) rather than dropped, so round-tripping an
        // unavailable module through this Beacon does not erase them.
        const settings = obj(m.settings);
        if (settings) out.settings = settings;
      } else if (meta.settings) out.settings = meta.settings(m.settings) ?? { ...meta.defaultSettings };
      modules.push(out);
    }
    columns.push({ id: unique(c.id, "c"), size: Number(c.size), modules: shares(modules) });
  }
  if (columns.length === 0) return null;
  return { version: LAYOUT_VERSION, kpis: normalizeKpis(src.kpis), columns: shares(columns) };
}
