"use client";

import { createContext, useContext, useState } from "react";
import type { DashboardLayout } from "@/lib/dashboard-layout";

interface LayoutState {
  layout: DashboardLayout;
  setLayout: (next: DashboardLayout) => void;
  /** No layout of the user's own is stored: the preset is showing (Reset has nothing to do). */
  isDefault: boolean;
  setIsDefault: (v: boolean) => void;
}

const Ctx = createContext<LayoutState | null>(null);

/**
 * The user's Overview layout (ADR-026), read by the instance layout on the server (no flash of the
 * preset) and held here, above the sections: leaving the Overview for another section, or another
 * instance, and coming back shows the layout as last edited, not as first loaded.
 */
export function DashboardLayoutProvider({
  initial,
  isDefault: initialIsDefault,
  children,
}: {
  initial: DashboardLayout;
  isDefault: boolean;
  children: React.ReactNode;
}) {
  const [layout, setLayout] = useState(initial);
  const [isDefault, setIsDefault] = useState(initialIsDefault);
  return <Ctx.Provider value={{ layout, setLayout, isDefault, setIsDefault }}>{children}</Ctx.Provider>;
}

export function useDashboardLayout(): LayoutState {
  const state = useContext(Ctx);
  if (!state) throw new Error("useDashboardLayout outside DashboardLayoutProvider");
  return state;
}
