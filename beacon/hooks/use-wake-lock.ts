"use client";

import { useEffect } from "react";

/**
 * Keeps the screen on while `active` — the Screen Wake Lock API. Watching a server boot is exactly
 * the case it exists for: the page is worth looking at but nobody is touching it, so the phone dims
 * and locks.
 *
 * The browser drops the lock whenever the document stops being visible (tab switch, screen off), so
 * it is re-acquired on `visibilitychange`. It also refuses on low battery or in power-saving mode,
 * and needs a secure context: everything here degrades to doing nothing, which is the right
 * fallback for a convenience.
 *
 * Support is Chrome/Edge, Firefox 126+ and Safari 16.4+ (iOS included); on iOS there are reports of
 * it not working inside an installed PWA before 18.4.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    const acquire = async () => {
      if (released || document.visibilityState !== "visible") return;
      try {
        const next = await navigator.wakeLock.request("screen");
        // The effect may have been cleaned up while the request was in flight.
        if (released) {
          void next.release().catch(() => {});
          return;
        }
        sentinel = next;
      } catch {
        // Low battery, power saving, or the browser said no. Not worth telling the user about.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
