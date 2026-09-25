"use client";

import { useCallback, useSyncExternalStore } from "react";
import { parseHistory, record } from "@/lib/command-history";

// One copy per key for every console on the page, and the `storage` event for the other windows:
// the console and its pop-out share one history.
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; parsed: string[] }>();
// Where history lives when localStorage throws (some private modes): this tab, until it closes.
const memory = new Map<string, string>();
const EMPTY: string[] = [];

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function save(key: string, raw: string) {
  try {
    localStorage.setItem(key, raw);
  } catch {
    memory.set(key, raw);
  }
}

/** The parsed history, the same array until the stored text changes (useSyncExternalStore needs that). */
function read(key: string): string[] {
  const raw = load(key);
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.parsed;
  const parsed = parseHistory(raw);
  cache.set(key, { raw, parsed });
  return parsed;
}

/**
 * The commands this person sent to this instance, newest first, remembered in localStorage.
 * `key` is null until the session is known, and history is empty meanwhile. The server snapshot
 * is empty too, so the first render hydrates cleanly.
 */
export function useCommandHistory(key: string | null): readonly [readonly string[], (command: string) => void] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      listeners.add(onChange);
      const onStorage = (e: StorageEvent) => {
        if (e.key === key) onChange();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(onChange);
        window.removeEventListener("storage", onStorage);
      };
    },
    [key],
  );
  const history = useSyncExternalStore(
    subscribe,
    () => (key ? read(key) : EMPTY),
    () => EMPTY,
  );
  const push = useCallback(
    (command: string) => {
      if (!key) return;
      // Re-read before writing, so a command sent from the other window is not overwritten.
      save(key, JSON.stringify(record(read(key), command)));
      for (const fn of listeners) fn();
    },
    [key],
  );
  return [history, push] as const;
}
