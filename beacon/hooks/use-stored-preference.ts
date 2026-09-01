"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A small view preference remembered in localStorage — console mode, line wrapping.
 *
 * It starts at `fallback` and adopts the stored value in an effect rather than reading during
 * render: the server has no localStorage, so reading it up front would hydrate-mismatch. Reads and
 * writes are guarded because localStorage throws outright in some private modes.
 */
export function useStoredPreference<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): readonly [T, (value: T) => void] {
  const [value, setValue] = useState<T>(fallback);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `allowed` is a literal at each call site
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null && (allowed as readonly string[]).includes(stored)) setValue(stored as T);
    } catch {
      /* private mode */
    }
  }, [key]);

  const choose = useCallback(
    (next: T) => {
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
