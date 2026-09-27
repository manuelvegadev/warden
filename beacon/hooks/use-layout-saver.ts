"use client";

import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { DashboardLayout } from "@/lib/dashboard-layout";

const SAVE_URL = "/api/dashboard-layout";

/**
 * Saves the layout 500 ms after the last change. The layout it mounts with (what the server sent,
 * or what Reset returned) is the saved one and is not sent back — compared by identity rather than
 * with a first-render flag, which Strict Mode's second effect run in development would defeat. A
 * change made less than 500 ms before the tab closes or navigates away would otherwise be lost: on
 * unmount, and on `pagehide`, a still-pending save is flushed immediately with a `keepalive` request
 * instead (the layout is at most 32 KB, well under the 64 KB keepalive cap) — never both, since
 * flushing clears the pending flag the debounced save also checks.
 *
 * Returns `cancel`, which drops a pending save without sending it — for Reset, which is about to
 * delete the row a lingering edit from the last 500 ms would otherwise resurrect — and `markSaved`,
 * which records a layout the server already holds (Reset's preset) so it is not sent back.
 */
export function useLayoutSaver(layout: DashboardLayout) {
  const saved = useRef(layout);
  const layoutRef = useRef(layout);
  const pending = useRef(false);
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    layoutRef.current = layout;
    if (layout === saved.current) {
      // Back to the last saved value while a save was pending (cancelled, or an edit that reverted
      // itself within the debounce window): nothing to send, and nothing left pending.
      pending.current = false;
      return;
    }
    pending.current = true;
    timeout.current = setTimeout(() => {
      pending.current = false;
      saved.current = layout;
      api(SAVE_URL, { method: "PUT", own: true, body: JSON.stringify(layout) }).catch(() =>
        toast.error("Could not save the dashboard layout", { id: "dashboard-save" }),
      );
    }, 500);
    return () => clearTimeout(timeout.current);
  }, [layout]);

  useEffect(() => {
    const flush = () => {
      if (!pending.current) return;
      pending.current = false;
      saved.current = layoutRef.current;
      fetch(SAVE_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(layoutRef.current),
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  return useMemo(() => {
    const cancel = () => {
      clearTimeout(timeout.current);
      pending.current = false;
    };
    const markSaved = (next: DashboardLayout) => {
      cancel();
      saved.current = next;
    };
    return { cancel, markSaved };
  }, []);
}
