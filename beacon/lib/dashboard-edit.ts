/**
 * Edit-mode operations on the dashboard layout (ADR-026): add/remove a module, add/remove a column,
 * move a module (phones' up/down buttons), and apply a drag-and-drop result. Pure: every operation
 * takes a layout and returns a new one (or the same object, `===`, when the operation is refused),
 * passed through `normalizeLayout` to renormalise sizes and enforce the limits.
 */
import {
  type DashboardColumn,
  type DashboardLayout,
  MAX_COLUMNS,
  MAX_MODULES,
  normalizeLayout,
} from "@/lib/dashboard-layout";
import { MODULES, type ModuleMeta, moduleMeta } from "@/lib/dashboard-modules";

const normalize = (raw: unknown): DashboardLayout => {
  const n = normalizeLayout(raw);
  if (!n) throw new Error("dashboard-edit: layout became invalid");
  return n;
};

/** Every kind, minus the unique ones already present in the layout. */
export function addableKinds(layout: DashboardLayout): ModuleMeta[] {
  const present = new Set(layout.columns.flatMap((c) => c.modules.map((m) => m.kind)));
  return MODULES.filter((m) => !m.unique || !present.has(m.kind));
}

/** Adds a module of `kind` to the end of column `columnId`, an equal share of that column's size. */
export function addModule(layout: DashboardLayout, columnId: string, kind: string): DashboardLayout {
  const meta = moduleMeta(kind);
  if (!meta) return layout;
  if (meta.unique && layout.columns.some((c) => c.modules.some((m) => m.kind === kind))) return layout;
  const column = layout.columns.find((c) => c.id === columnId);
  if (!column || column.modules.length >= MAX_MODULES) return layout;
  const id = `m${crypto.randomUUID().slice(0, 8)}`;
  const size = 100 / (column.modules.length + 1);
  const module = { id, kind, size, ...(meta.defaultSettings ? { settings: { ...meta.defaultSettings } } : {}) };
  const columns = layout.columns.map((c) => (c.id === columnId ? { ...c, modules: [...c.modules, module] } : c));
  return normalize({ ...layout, columns });
}

/** Removes a module; its share goes back to the rest of its column. */
export function removeModule(layout: DashboardLayout, moduleId: string): DashboardLayout {
  const present = layout.columns.some((c) => c.modules.some((m) => m.id === moduleId));
  if (!present) return layout;
  const columns = layout.columns.map((c) => ({ ...c, modules: c.modules.filter((m) => m.id !== moduleId) }));
  return normalize({ ...layout, columns });
}

/** Adds an empty column (up to `MAX_COLUMNS`), an equal share of the dashboard's width. */
export function addColumn(layout: DashboardLayout): DashboardLayout {
  if (layout.columns.length >= MAX_COLUMNS) return layout;
  const id = `c${crypto.randomUUID().slice(0, 8)}`;
  const size = 100 / (layout.columns.length + 1);
  const column: DashboardColumn = { id, size, modules: [] };
  return normalize({ ...layout, columns: [...layout.columns, column] });
}

/** Removes a column, only when it is empty and at least one other column remains. */
export function removeColumn(layout: DashboardLayout, columnId: string): DashboardLayout {
  if (layout.columns.length <= 1) return layout;
  const column = layout.columns.find((c) => c.id === columnId);
  if (!column || column.modules.length > 0) return layout;
  const columns = layout.columns.filter((c) => c.id !== columnId);
  return normalize({ ...layout, columns });
}

/**
 * Moves a module up/down within its column, or across columns at the ends (phones' up/down
 * buttons). Does nothing at the top of the first column or the bottom of the last.
 */
export function moveModule(layout: DashboardLayout, moduleId: string, dir: -1 | 1): DashboardLayout {
  const colIndex = layout.columns.findIndex((c) => c.modules.some((m) => m.id === moduleId));
  if (colIndex === -1) return layout;
  const column = layout.columns[colIndex];
  const modIndex = column.modules.findIndex((m) => m.id === moduleId);
  const target = modIndex + dir;

  if (target >= 0 && target < column.modules.length) {
    const modules = [...column.modules];
    [modules[modIndex], modules[target]] = [modules[target], modules[modIndex]];
    const columns = layout.columns.map((c, i) => (i === colIndex ? { ...c, modules } : c));
    return normalize({ ...layout, columns });
  }

  const targetColIndex = colIndex + dir;
  if (targetColIndex < 0 || targetColIndex >= layout.columns.length) return layout;
  if (layout.columns[targetColIndex].modules.length >= MAX_MODULES) return layout;
  const module = column.modules[modIndex];
  const fromModules = column.modules.filter((_, i) => i !== modIndex);
  const columns = layout.columns.map((c, i) => {
    if (i === colIndex) return { ...c, modules: fromModules };
    if (i === targetColIndex) {
      const toModules = dir === 1 ? [module, ...c.modules] : [...c.modules, module];
      return { ...c, modules: toModules };
    }
    return c;
  });
  return normalize({ ...layout, columns });
}

const sameOrder = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Rebuilds each column's modules from a drag-and-drop result: `order[columnId]` is its module ids.
 * Robust to whatever `order` holds: an id that is not in the layout is skipped; an id listed twice
 * (in one column or across several) keeps only its first occurrence; a module missing from `order`
 * altogether goes back to the end of its original column; a column absent from `order` keeps its
 * remaining modules in their current order. Refuses (returns the same layout, `===`) when a column
 * would end up over `MAX_MODULES`, or when the result is the same order as today.
 */
export function applyOrder(layout: DashboardLayout, order: Record<string, string[]>): DashboardLayout {
  const byId = new Map(layout.columns.flatMap((c) => c.modules.map((m) => [m.id, m] as const)));
  const placed = new Set<string>();
  const nextIds: Record<string, string[]> = {};

  for (const column of layout.columns) {
    const ids = order[column.id];
    if (!ids) continue;
    const list: string[] = [];
    for (const id of ids) {
      if (placed.has(id) || !byId.has(id)) continue;
      placed.add(id);
      list.push(id);
    }
    nextIds[column.id] = list;
  }

  for (const column of layout.columns) {
    if (!nextIds[column.id]) nextIds[column.id] = [];
    const list = nextIds[column.id];
    for (const m of column.modules) {
      if (placed.has(m.id)) continue;
      placed.add(m.id);
      list.push(m.id);
    }
  }

  if (layout.columns.some((c) => nextIds[c.id].length > MAX_MODULES)) return layout;
  if (
    layout.columns.every((c) =>
      sameOrder(
        nextIds[c.id],
        c.modules.map((m) => m.id),
      ),
    )
  )
    return layout;

  const columns = layout.columns.map((c) => ({
    ...c,
    modules: nextIds[c.id].map((id) => byId.get(id)).filter((m): m is (typeof c.modules)[number] => m !== undefined),
  }));
  return normalize({ ...layout, columns });
}
