"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { instances as api, type InstanceStatus, type InstanceSummary } from "@/lib/api";

interface InstancesState {
  instances: InstanceSummary[];
  refresh: () => Promise<void>;
  setStatus: (id: string, status: InstanceStatus) => void;
  openCreate: () => void;
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
}

const Ctx = createContext<InstancesState | null>(null);

/** One client-side copy of the instance list, seeded by the server layout and shared by the sidebar, switcher, breadcrumb and list. */
export function InstancesProvider({ initial, children }: { initial: InstanceSummary[]; children: React.ReactNode }) {
  const [instances, setInstances] = useState(initial);
  const [createOpen, setCreateOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setInstances(await api.list());
    } catch {
      /* the caller surfaces errors where it matters */
    }
  }, []);
  const setStatus = useCallback((id: string, status: InstanceStatus) => {
    setInstances((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
  }, []);
  const openCreate = useCallback(() => setCreateOpen(true), []);

  const value = useMemo<InstancesState>(
    () => ({ instances, refresh, setStatus, openCreate, createOpen, setCreateOpen }),
    [instances, refresh, setStatus, openCreate, createOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The store when one is mounted; pages outside the dashboard shell (the console pop-out) have none. */
export function useOptionalInstances(): InstancesState | null {
  return useContext(Ctx);
}

export function useInstances(): InstancesState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useInstances must be used inside InstancesProvider");
  return v;
}
