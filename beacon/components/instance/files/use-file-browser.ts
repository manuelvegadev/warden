"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type FsEntry, type FsListing, fs } from "@/lib/api";
import { ancestors, baseName, joinPath } from "@/lib/fs-path";

/** One Miller column: a directory, its listing once it arrives, and the entry chosen in it. */
export interface Column {
  path: string;
  listing: FsListing | null;
  error: string | null;
  selected: string | null;
}

const root = (): Column => ({ path: "", listing: null, error: null, selected: null });

/**
 * The columns of the file manager (ADR-020): one per directory on the way to the open one. The
 * chosen file, when there is one, is the entry selected in the last column (a chosen directory
 * always opens a column of its own, so it is never the last column's selection). Listings are
 * fetched per column and kept while the column stays on screen; `refresh` re-reads one.
 */
export function useFileBrowser(id: string) {
  const [columns, setColumns] = useState<Column[]>(() => [root()]);
  const current = useRef(columns);
  current.current = columns;

  const load = useCallback(
    (path: string) => {
      fs.list(id, path)
        .then((listing) =>
          setColumns((cols) => cols.map((c) => (c.path === path ? { ...c, listing, error: null } : c))),
        )
        .catch((e: Error) => setColumns((cols) => cols.map((c) => (c.path === path ? { ...c, error: e.message } : c))));
    },
    [id],
  );

  // A fresh root whenever the instance changes.
  useEffect(() => {
    setColumns([root()]);
    load("");
  }, [load]);

  const last = columns[columns.length - 1];
  const file = last?.selected ? joinPath(last.path, last.selected) : null;

  /** Opens a directory: a column for it and each ancestor; listings already there are kept, the rest fetched. */
  const open = useCallback(
    (target: string) => {
      const segments = ancestors(target);
      const prev = current.current;
      const next = segments.map((path, i) => {
        const old = prev.find((c) => c.path === path);
        const below = segments[i + 1];
        return { path, listing: old?.listing ?? null, error: null, selected: below ? baseName(below) : null };
      });
      setColumns(next);
      for (const c of next) if (c.listing === null) load(c.path);
    },
    [load],
  );

  /** Picks an entry in a column: a directory opens as the next column, a file becomes the preview. */
  const choose = useCallback(
    (columnPath: string, entry: FsEntry) => {
      const cols = current.current;
      const idx = cols.findIndex((c) => c.path === columnPath);
      if (idx < 0) return;
      const path = joinPath(columnPath, entry.name);
      // Choosing the directory that is already open next to this column changes nothing.
      if (entry.dir && cols[idx].selected === entry.name && cols[idx + 1]?.path === path) return;
      const kept = cols.slice(0, idx).concat({ ...cols[idx], selected: entry.name });
      setColumns(entry.dir ? [...kept, { path, listing: null, error: null, selected: null }] : kept);
      if (entry.dir) load(path);
    },
    [load],
  );

  /** Drops the chosen file, leaving its directory open. */
  const deselect = useCallback(
    () => setColumns((cols) => cols.map((c, i) => (i === cols.length - 1 ? { ...c, selected: null } : c))),
    [],
  );

  return { columns, file, open, choose, deselect, refresh: load };
}
