"use client";

import { move } from "@dnd-kit/helpers";
import { DragDropProvider, useDroppable } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import {
  ResizableHandle,
  type ResizableLayout,
  type ResizableLayoutMeta,
  ResizablePanel,
  ResizablePanelGroup,
} from "@warden/ui/components/resizable";
import { useIsMobileState } from "@warden/ui/hooks/use-mobile";
import { cn } from "@warden/ui/lib/utils";
import { X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { AddModuleMenu } from "@/components/dashboard/add-module-menu";
import { ModuleFrame } from "@/components/dashboard/module-frame";
import { ModuleBody, ModuleSettings } from "@/components/dashboard/modules";
import { applyOrder, moveModule, removeColumn, removeModule } from "@/lib/dashboard-edit";
import type { DashboardColumn, DashboardLayout, DashboardModule } from "@/lib/dashboard-layout";
import { moduleMeta } from "@/lib/dashboard-modules";

// @dnd-kit/abstract's CollisionPriority.Low, spelled out: it's a transitive dependency (pulled in by
// @dnd-kit/react and @dnd-kit/dom), not a direct beacon one, and neither @dnd-kit/react nor
// @dnd-kit/dom re-exports the enum itself — only types that reference it.
const COLLISION_PRIORITY_LOW = 1;

/** The least height of a fill module on desktop, in rem: the canvas never scrolls, so it squeezes down to this. */
const FILL_MIN_REM = 8;

// react-resizable-panels rounds to a lot of decimals; the stored layout keeps 2 (dashboard-layout.ts's
// `shares`) — round the same way before comparing, so a resize that lands back on the same value
// (or the group's initial-mount callback) never produces a new layout object.
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * `items` with each one's size taken from `sizes` (as a share of `scale`, rounded to 2 decimals)
 * when it changed; null when every size is the same as before, so no new array/object is built for
 * a same-value or non-user layout change (a rounding no-op, or the group's initial-mount callback).
 */
function resized<T extends { id: string; size: number }>(items: T[], sizes: ResizableLayout, scale = 100): T[] | null {
  let changed = false;
  const next = items.map((it) => {
    const raw = sizes[it.id];
    const size = raw === undefined ? it.size : round2((raw * scale) / 100);
    if (size !== it.size) changed = true;
    return size === it.size ? it : { ...it, size };
  });
  return changed ? next : null;
}

/** Each column's module ids, in order, as the drag-and-drop `order` state and `applyOrder` expect. */
const orderFromLayout = (l: DashboardLayout): Record<string, string[]> =>
  Object.fromEntries(l.columns.map((c) => [c.id, c.modules.map((m) => m.id)]));

const isFill = (m: DashboardModule) => Boolean(moduleMeta(m.kind)?.fill);

type RunModule = { module: DashboardModule; index: number; size: number };

/**
 * A column's modules as it lays them out: each module that is as tall as its content on its own,
 * and each run of consecutive fill modules together, sharing the height the column leaves them.
 */
type Segment = { fill: false; module: DashboardModule; index: number } | { fill: true; modules: RunModule[] };

function segments(modules: DashboardModule[], sizeOf: (m: DashboardModule) => number): Segment[] {
  const out: Segment[] = [];
  modules.forEach((m, index) => {
    if (!isFill(m)) {
      out.push({ fill: false, module: m, index });
      return;
    }
    const last = out[out.length - 1];
    const entry = { module: m, index, size: sizeOf(m) };
    if (last?.fill) last.modules.push(entry);
    else out.push({ fill: true, modules: [entry] });
  });
  return out;
}

/** Per-module edit handles a wrapper (desktop drag, phone up/down) passes down into its frame. */
interface ModuleEditHandlers {
  handleRef?: (element: Element | null) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

type RenderModule = (m: DashboardModule, edit?: ModuleEditHandlers) => React.ReactNode;

export interface CanvasProps {
  layout: DashboardLayout;
  onLayout: (next: DashboardLayout) => void;
  editing: boolean;
}

/**
 * The canvas of columns and modules (ADR-026). On desktop, resizable columns; in each, modules as
 * tall as their content, and the fill modules sharing what is left — resizable against each other.
 * It fits the screen and never scrolls. On a phone, one stack, and the page scrolls.
 */
export function Canvas(props: CanvasProps) {
  const mobile = useIsMobileState();
  const { layout, onLayout, editing } = props;

  // Drag state: kept local, and reset from the layout whenever its ids (or their arrangement) change
  // — a drag in progress, an outside edit (add/remove/reset), or the initial mount. Adjusting state
  // during render (rather than in an effect) avoids an extra render on every such change.
  const idsKey = layout.columns.flatMap((c) => [c.id, ...c.modules.map((m) => m.id)]).join("|");
  const [order, setOrder] = useState<Record<string, string[]>>(() => orderFromLayout(layout));
  const [orderKey, setOrderKey] = useState(idsKey);
  if (idsKey !== orderKey) {
    setOrderKey(idsKey);
    setOrder(orderFromLayout(layout));
  }

  // Snapshot of `order` from just before the current drag, so a cancelled drag (Escape) can restore
  // it exactly — otherwise the preview stays rearranged, and the next committed drag would save that
  // stray rearrangement too.
  const orderBeforeDrag = useRef<Record<string, string[]> | null>(null);

  // Every module by id, across columns: the drag preview renders a column from ids that may come from
  // any other. Built once per layout, not per column on every frame of a drag.
  const byId = useMemo(
    () => new Map(layout.columns.flatMap((c) => c.modules.map((m) => [m.id, m] as const))),
    [layout],
  );

  const setModuleSettings = (moduleId: string, settings: Record<string, unknown>) =>
    onLayout({
      ...layout,
      columns: layout.columns.map((c) => ({
        ...c,
        modules: c.modules.map((m) => (m.id === moduleId ? { ...m, settings } : m)),
      })),
    });

  const render: RenderModule = (m, edit) => (
    <ModuleFrame
      module={m}
      editing={editing}
      mobile={mobile}
      fill={isFill(m)}
      handleRef={edit?.handleRef}
      onMoveUp={edit?.onMoveUp}
      onMoveDown={edit?.onMoveDown}
      onRemove={() => onLayout(removeModule(layout, m.id))}
      settings={
        m.kind === "metrics" ? <ModuleSettings module={m} onSettings={(s) => setModuleSettings(m.id, s)} /> : undefined
      }
    >
      <ModuleBody module={m} onSettings={(s) => setModuleSettings(m.id, s)} />
    </ModuleFrame>
  );

  // Unknown on the very first render (no `window` to measure yet): rendering nothing avoids
  // mounting the desktop canvas — Console and Live view included — only to tear it down and restack
  // a moment later once the media query resolves on a phone.
  if (mobile === undefined) return null;

  if (mobile) {
    // No drag on phones: modules are a flat stack; up/down moves within and across columns
    // (dashboard-edit.ts's `moveModule`), disabled at the very first/last module. A fill module
    // takes a fixed height here, there being no screen's worth of height to share (the Overview
    // scrolls as a whole on a phone).
    const allModules = layout.columns.flatMap((c) => c.modules);
    return (
      <div className="grid gap-4">
        {allModules.map((m, i) => {
          const fill = moduleMeta(m.kind)?.fill;
          return (
            <div key={m.id} style={fill ? { height: fill.mobileHeight } : undefined}>
              {render(
                m,
                editing
                  ? {
                      onMoveUp: i > 0 ? () => onLayout(moveModule(layout, m.id, -1)) : undefined,
                      onMoveDown: i < allModules.length - 1 ? () => onLayout(moveModule(layout, m.id, 1)) : undefined,
                    }
                  : undefined,
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <DragDropProvider
      onDragStart={() => {
        orderBeforeDrag.current = order;
      }}
      onDragOver={(event) => setOrder((o) => move(o, event))}
      onDragEnd={(event) => {
        if (event.canceled) {
          if (orderBeforeDrag.current) setOrder(orderBeforeDrag.current);
          orderBeforeDrag.current = null;
          return;
        }
        orderBeforeDrag.current = null;
        const next = applyOrder(layout, order);
        if (next !== layout) onLayout(next);
      }}
    >
      <div className="flex min-h-0 flex-1">
        <ResizablePanelGroup
          orientation="horizontal"
          onLayoutChanged={(sizes, meta: ResizableLayoutMeta) => {
            if (!meta.isUserInteraction) return;
            const columns = resized(layout.columns, sizes);
            if (columns) onLayout({ ...layout, columns });
          }}
        >
          {layout.columns.map((c, i) => (
            <ColumnPanel
              key={c.id}
              column={c}
              first={i === 0}
              layout={layout}
              onLayout={onLayout}
              order={order}
              byId={byId}
              editing={editing}
              render={render}
            />
          ))}
        </ResizablePanelGroup>
      </div>
    </DragDropProvider>
  );
}

/** A separator between columns or fill modules: a line while editing, only on hover otherwise. */
const handleClass = (editing: boolean) =>
  cn("transition-colors", editing ? "bg-border" : "bg-transparent hover:bg-border");

/** One column: a resizable panel holding its modules, a run of fill modules sharing what is left. */
function ColumnPanel({
  column,
  first,
  layout,
  onLayout,
  order,
  byId,
  editing,
  render,
}: {
  column: DashboardColumn;
  first: boolean;
  layout: DashboardLayout;
  onLayout: (next: DashboardLayout) => void;
  order: Record<string, string[]>;
  byId: Map<string, DashboardModule>;
  editing: boolean;
  render: RenderModule;
}) {
  // Registered on the column's module area so an empty column (with no sortable module of its own to
  // hover over) still accepts a drop. Low priority so a module dropped near the edge of another
  // module still lands on that module's own (sortable) collision rather than the whole column.
  const { ref: dropRef } = useDroppable({
    id: column.id,
    type: "column",
    accept: "module",
    collisionPriority: COLLISION_PRIORITY_LOW,
  });

  // While editing, render from the live drag `order` (ids may span the whole layout mid-drag, hence
  // the lookup across every column) so the preview moves; outside edit mode, straight from the layout.
  const modules = editing
    ? (order[column.id] ?? column.modules.map((m) => m.id))
        .map((id) => byId.get(id))
        .filter((m): m is DashboardModule => m !== undefined)
    : column.modules;

  // A module only passing through this column mid-drag (not yet, or not really, one of its own) has
  // no size that makes sense here — the average of the column's is a sane stand-in until the drop
  // commits and normalizeLayout renormalises for real.
  const average = column.modules.length ? 100 / column.modules.length : 100;
  const sizeOf = (m: DashboardModule) => (column.modules.some((cm) => cm.id === m.id) ? m.size : average);

  // A resize within one run of fill modules: the run's panels report shares of 100, scaled back to
  // the run's own total so its weight against the column's other runs stays what it was. Always from
  // the layout's modules, never the drag preview's: a resize mid-drag must not read (and then save) a
  // module that only appears here because it is passing through on its way somewhere else.
  const onRunResized = (sizes: ResizableLayout, runTotal: number) => {
    const resizedModules = resized(column.modules, sizes, runTotal);
    if (!resizedModules) return;
    onLayout({
      ...layout,
      columns: layout.columns.map((c) => (c.id === column.id ? { ...c, modules: resizedModules } : c)),
    });
  };

  return (
    <>
      {!first && <ResizableHandle className={cn("mx-2.5", handleClass(editing))} />}
      <ResizablePanel id={column.id} defaultSize={String(column.size)} minSize="15" className="flex flex-col gap-5">
        <div ref={dropRef} className="flex min-h-0 flex-1 flex-col gap-5">
          {modules.length === 0 && editing && (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
              Empty column
            </div>
          )}
          {segments(modules, sizeOf).map((s) =>
            s.fill ? (
              <FillRun
                key={`run-${s.modules[0].module.id}`}
                run={s.modules}
                columnId={column.id}
                editing={editing}
                render={render}
                onResized={onRunResized}
              />
            ) : (
              <SortableModule
                key={s.module.id}
                module={s.module}
                index={s.index}
                columnId={column.id}
                editing={editing}
                render={render}
              />
            ),
          )}
        </div>
        {editing && (
          <div className="flex shrink-0 items-center gap-1.5">
            <AddModuleMenu layout={layout} columnId={column.id} onLayout={onLayout} />
            {column.modules.length === 0 && layout.columns.length > 1 && (
              <button
                type="button"
                aria-label="Remove column"
                onClick={() => onLayout(removeColumn(layout, column.id))}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        )}
      </ResizablePanel>
    </>
  );
}

/**
 * Consecutive fill modules of a column: together they take the height the column leaves (weighted
 * against any other run by their sizes, never below `FILL_MIN_REM` each), split between them by
 * their sizes and resizable against each other.
 */
function FillRun({
  run,
  columnId,
  editing,
  render,
  onResized,
}: {
  run: RunModule[];
  columnId: string;
  editing: boolean;
  render: RenderModule;
  onResized: (sizes: ResizableLayout, runTotal: number) => void;
}) {
  const total = run.reduce((n, r) => n + r.size, 0) || 100;
  return (
    // The run's own content never sets its height (it is absolutely placed): the column's flex does,
    // so the Console or the charts fill exactly the space left, however little.
    <div className="relative" style={{ flexGrow: total, flexBasis: 0, minHeight: `${run.length * FILL_MIN_REM}rem` }}>
      <div className="absolute inset-0">
        {run.length === 1 ? (
          <SortableModule
            module={run[0].module}
            index={run[0].index}
            columnId={columnId}
            editing={editing}
            render={render}
            className="h-full"
          />
        ) : (
          <ResizablePanelGroup
            orientation="vertical"
            onLayoutChanged={(sizes, meta: ResizableLayoutMeta) => {
              if (meta.isUserInteraction) onResized(sizes, total);
            }}
          >
            {run.flatMap((r, i) => [
              ...(i > 0
                ? [<ResizableHandle key={`${r.module.id}-handle`} className={cn("my-2.5", handleClass(editing))} />]
                : []),
              <ResizablePanel
                key={r.module.id}
                id={r.module.id}
                defaultSize={String(round2((r.size / total) * 100))}
                minSize={String(moduleMeta(r.module.kind)?.fill?.minSize ?? 20)}
              >
                <SortableModule
                  module={r.module}
                  index={r.index}
                  columnId={columnId}
                  editing={editing}
                  render={render}
                  className="h-full"
                />
              </ResizablePanel>,
            ])}
          </ResizablePanelGroup>
        )}
      </div>
    </div>
  );
}

/** One draggable module; `useSortable` makes it a drop target for its neighbours too. */
function SortableModule({
  module,
  index,
  columnId,
  editing,
  render,
  className,
}: {
  module: DashboardModule;
  index: number;
  columnId: string;
  editing: boolean;
  render: RenderModule;
  className?: string;
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id: module.id,
    index,
    group: columnId,
    type: "module",
    accept: "module",
    disabled: !editing,
  });

  return (
    <div ref={ref} className={className} style={{ opacity: isDragging ? 0.4 : 1 }}>
      {render(module, { handleRef })}
    </div>
  );
}
