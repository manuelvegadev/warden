"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { type PluginHit, plugins } from "@/lib/api";
import { normalizeQuery, remember, SEARCH_DELAY_MS, searchKey, worthSearching } from "@/lib/plugin-search";

/** The hits on screen and the query they answer, which lags the typed one while a search runs. */
export interface PluginResults {
  query: string;
  hits: PluginHit[];
}

/**
 * The install dialog's catalog search, run as the admin types: it waits for a pause, asks for a
 * query once (a repeat, or a query with extra spaces, is not asked again), cancels the request a
 * newer query replaces — through the proxy to the daemon — and answers from memory when the admin
 * erases back to an earlier query. The shown hits stay until the next answer arrives, so the list
 * never blanks between keystrokes. Closing (`active` false) forgets it all.
 */
export function usePluginSearch(mcVersion: string, active: boolean) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [results, setResults] = useState<PluginResults | null>(null);
  const [searching, setSearching] = useState(false);
  const memory = useRef(new Map<string, PluginHit[]>());
  const wanted = useRef<string | null>(null);
  const inflight = useRef<AbortController | null>(null);

  const q = normalizeQuery(query);

  const run = useCallback(
    async (q: string, src: string) => {
      const key = searchKey(src, q);
      if (key === wanted.current) return;
      wanted.current = key;
      inflight.current?.abort();
      inflight.current = null;
      const known = memory.current.get(key);
      if (known) {
        setResults({ query: q, hits: known });
        setSearching(false);
        return;
      }
      const ctl = new AbortController();
      inflight.current = ctl;
      setSearching(true);
      try {
        const { hits } = await plugins.search(q, mcVersion, src, ctl.signal);
        remember(memory.current, key, hits);
        setResults({ query: q, hits });
      } catch (err) {
        if (ctl.signal.aborted) return;
        wanted.current = null; // the next keystroke or Enter asks again
        // One toast however many keystrokes fail in a row (the daemon is down, say).
        toast.error(err instanceof Error ? err.message : "Search failed", { id: "plugin-search" });
      } finally {
        if (inflight.current === ctl) {
          inflight.current = null;
          setSearching(false);
        }
      }
    },
    [mcVersion],
  );

  // Typing waits for a pause; opening, clearing the field and switching source answer at once.
  useEffect(() => {
    if (!active || !worthSearching(q)) return;
    const sameSource = wanted.current?.startsWith(searchKey(source, ""));
    const t = setTimeout(() => void run(q, source), sameSource && q ? SEARCH_DELAY_MS : 0);
    return () => clearTimeout(t);
  }, [active, q, source, run]);

  useEffect(() => {
    if (active) return;
    inflight.current?.abort();
    inflight.current = null;
    wanted.current = null;
    memory.current.clear();
    setQuery("");
    setResults(null);
    setSearching(false);
  }, [active]);

  useEffect(() => () => inflight.current?.abort(), []);

  /** Enter: search now rather than after the pause. */
  const searchNow = useCallback(() => {
    if (worthSearching(q)) void run(q, source);
  }, [q, source, run]);

  return { query, setQuery, source, setSource, results, searching, searchNow };
}
