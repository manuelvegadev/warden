"use client";

import { useMemo, useState } from "react";

/**
 * Edit tracking for a form whose baseline comes from props: only the edits are state, so a
 * baseline that changes underneath (server refresh) resyncs automatically without touching
 * what the user is typing.
 */
export function useDraft<T extends object>(saved: T) {
  const [edits, setEdits] = useState<Partial<T>>({});
  const draft = useMemo(() => ({ ...saved, ...edits }) as T, [saved, edits]);
  const set = <K extends keyof T>(key: K, value: T[K]) => setEdits((e) => ({ ...e, [key]: value }));
  const changed = (Object.keys(edits) as (keyof T)[]).filter((k) => edits[k] !== saved[k]);
  return {
    draft,
    set,
    changed,
    dirty: changed.length > 0,
    reset: () => setEdits({}),
    isDirty: (k: keyof T) => draft[k] !== saved[k],
  };
}
