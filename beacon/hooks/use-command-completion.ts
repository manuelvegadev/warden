"use client";

import { useEffect, useMemo, useState } from "react";
import { hasPlugins } from "@/lib/api";
import { type CompletionState, complete, type McData, type Options } from "@/lib/command-complete";

export type { CompletionState, Suggestion } from "@/lib/command-complete";

let mcData: McData | null = null;
let mcDataLoading: Promise<McData> | null = null;
const loadMcData = () => {
  mcDataLoading ??= import("@/lib/mc/data.json").then((m) => {
    mcData = m.default as McData;
    return mcData;
  });
  return mcDataLoading;
};

export function useCommandCompletion({
  value,
  caret,
  players,
  knownPlayers,
  software,
}: Omit<Options, "paper"> & { software?: string }): CompletionState {
  const [data, setData] = useState<McData | null>(mcData);
  useEffect(() => {
    if (!data) loadMcData().then(setData);
  }, [data]);

  // Array props are compared by identity; callers should memoize them.
  return useMemo(() => {
    const r = complete({ value, caret, players, knownPlayers, paper: hasPlugins(software ?? "") }, data);
    const apply = (text: string) => {
      const before = value.slice(0, r.start);
      const after = value.slice(caret).replace(/^\S*/, "");
      return { value: `${before}${text}${after}`, caret: before.length + text.length };
    };
    return { suggestions: r.suggestions, current: r.current, apply };
  }, [value, caret, players, knownPlayers, software, data]);
}
