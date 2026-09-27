"use client";

import { Button } from "@warden/ui/components/button";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Canvas } from "@/components/dashboard/canvas";
import { KpiStrip } from "@/components/dashboard/kpi-strip";
import { useDashboardLayout } from "@/components/dashboard/layout-context";
import { PageActions } from "@/components/slots";
import { useLayoutSaver } from "@/hooks/use-layout-saver";
import { api } from "@/lib/api";
import { addColumn } from "@/lib/dashboard-edit";
import { type DashboardLayout, MAX_COLUMNS } from "@/lib/dashboard-layout";

const LAYOUT_URL = "/api/dashboard-layout";

/**
 * The instance's Overview (ADR-026): its key figures across the top, and under them its modules on a
 * canvas the user arranges — Edit, "+ Column" and Reset in the header's page actions — the layout
 * kept per user and the same on every instance.
 */
export function OverviewDashboard() {
  const { layout, setLayout: setLayoutState, isDefault, setIsDefault } = useDashboardLayout();
  const [editing, setEditing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  // Bumped by Reset to remount the canvas (see below).
  const [resets, setResets] = useState(0);
  const saver = useLayoutSaver(layout);

  // Refused ops (dashboard-edit.ts) and a no-op resize return the very same object: skip touching
  // `isDefault` for those, rather than flipping it false for a call that changed nothing.
  const setLayout = (next: DashboardLayout) => {
    setLayoutState(next);
    if (next !== layout) setIsDefault(false);
  };

  async function handleReset() {
    setConfirmReset(false);
    // Cancel any save from an edit made just before this click — before the DELETE even starts, so
    // it cannot land on the server afterwards (however long the DELETE takes) and resurrect the old
    // layout under a request that looks perfectly normal.
    saver.cancel();
    try {
      const res = await api<{ layout: DashboardLayout; isDefault: boolean }>(LAYOUT_URL, {
        method: "DELETE",
        own: true,
      });
      // The server already holds the preset: the saver must not send it straight back.
      saver.markSaved(res.layout);
      setResets((n) => n + 1);
      setLayoutState(res.layout);
      setIsDefault(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reset the Overview");
    }
  }

  return (
    // The key figures across the top, the canvas of modules filling the rest. On a phone, where the
    // modules are one stack, the whole of it scrolls — the negative margin and matching padding keep
    // the cards' borders clear of the scroll area's edge.
    <div className="flex min-h-0 flex-1 flex-col gap-5 max-md:-m-4 max-md:gap-4 max-md:overflow-y-auto max-md:p-4">
      <PageActions.Fill>
        {editing && (
          <>
            {/* No drag on phones, and one stack there: columns are a desktop thing. */}
            <Button
              size="sm"
              variant="outline"
              className="max-md:hidden"
              disabled={layout.columns.length >= MAX_COLUMNS}
              onClick={() => setLayout(addColumn(layout))}
            >
              <Plus />
              Column
            </Button>
            <Button size="sm" variant="outline" disabled={isDefault} onClick={() => setConfirmReset(true)}>
              Reset
            </Button>
          </>
        )}
        <Button size="sm" variant={editing ? "default" : "outline"} onClick={() => setEditing((e) => !e)}>
          {editing ? "Done" : "Edit"}
        </Button>
      </PageActions.Fill>
      <KpiStrip kpis={layout.kpis} editing={editing} onKpis={(kpis) => setLayout({ ...layout, kpis })} />
      {/* Remounted by Reset: react-resizable-panels caches each group's sizes by its panel ids, and
          the preset reuses the very same ids, so a Reset that only changes sizes would otherwise leave
          the old dividers in place. */}
      <Canvas key={resets} layout={layout} onLayout={setLayout} editing={editing} />
      <ConfirmDialog
        open={confirmReset}
        title="Reset the Overview?"
        description="Back to the default layout; your current one is lost."
        confirmLabel="Reset"
        destructive
        onClose={() => setConfirmReset(false)}
        onConfirm={handleReset}
      />
    </div>
  );
}
