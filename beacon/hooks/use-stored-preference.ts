"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A small view preference remembered in localStorage — console mode, line wrapping.
 *
 * It starts at `fallback` and adopts the stored value in an effect rather than reading during
 * render: the server has no localStorage, so reading it up front would hydrate-mismatch. Reads and
 * writes are guarded because localStorage throws outright in some private modes. Without an
 * `allowed` list any stored string is taken (a device id, say).
 */
export function useStoredPreference<T extends string>(
  key: string,
  fallback: T,
  allowed?: readonly T[],
): readonly [T, (value: T) => void] {
  const [value, setValue] = useState<T>(fallback);
  const current = useRef(value);
  current.current = value;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `allowed` is a literal at each call site
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null && (!allowed || (allowed as readonly string[]).includes(stored))) setValue(stored as T);
    } catch {
      /* private mode */
    }
  }, [key]);

  const choose = useCallback(
    (next: T) => {
      if (next === current.current) return;
      setValue(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        /* private mode */
      }
    },
    [key],
  );

  return [value, choose] as const;
}

const ON_OFF = ["on", "off"] as const;

/** A remembered switch, stored as "on" / "off". */
export function useStoredFlag(key: string, fallback: boolean): readonly [boolean, (on: boolean) => void] {
  const [value, choose] = useStoredPreference(key, fallback ? "on" : "off", ON_OFF);
  const set = useCallback((on: boolean) => choose(on ? "on" : "off"), [choose]);
  return [value === "on", set] as const;
}
