"use client";

import { useSyncExternalStore } from "react";
import { type SystemInfo, system } from "@/lib/api";

const REFRESH_MS = 5000;

// One shared poll for the whole page: several dashboard modules (Wardend, Host) may all want the
// same figures, and would otherwise each start their own 5 s interval. A module-level store
// polls once, while at least one caller is subscribed, and every caller reads the same value.
let latest: SystemInfo | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
// Bumped when the last subscriber leaves, so a fetch already in flight from the poll it stopped
// cannot revive `latest` (or notify listeners) after nobody is watching any more.
let epoch = 0;

function poll(myEpoch: number) {
  system.get().then(
    (s) => {
      if (myEpoch !== epoch) return;
      latest = s;
      for (const listener of listeners) listener();
    },
    () => {},
  );
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  if (listeners.size === 1) {
    poll(epoch);
    timer = setInterval(() => poll(epoch), REFRESH_MS);
  }
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0) {
      epoch++;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    }
  };
}

function getSnapshot(): SystemInfo | null {
  return latest;
}

function getServerSnapshot(): SystemInfo | null {
  return null;
}

/**
 * The daemon's and host's live figures (the Wardend and Host dashboard tiles, WardendUpdate),
 * polled every 5 s while at least one caller wants them. A new subscriber gets whatever value the
 * shared poll last read at once, rather than waiting out a fresh interval.
 */
export function useSystemInfo(): SystemInfo | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
