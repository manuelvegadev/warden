"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, hasPlugins, instances } from "@/lib/api";
import { type CompletionState, complete, type McData, type Options, type Suggestion } from "@/lib/command-complete";
import { REMOTE_DELAY_MS, type RemoteAnswer, recall, rememberAnswer } from "@/lib/command-remote";

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

export interface CommandCompletion extends CompletionState {
  /** The server is being asked for this position; Tab waits for it rather than leaving the input. */
  pending: boolean;
}

/**
 * Completion for the console input. The grammar answers at once; where the server owns the
 * position (a plugin's command, ADR-024) the Warden Agent is asked after a short pause, a newer
 * keystroke cancels the request it replaces — through the proxy to the daemon — and answers are
 * remembered, so typing on through one argument narrows the last answer instead of asking again.
 * A new command list from the server (a plugin enabled or removed) forgets them.
 */
export function useCommandCompletion({
  value,
  caret,
  players,
  knownPlayers,
  software,
  commands,
  instanceId,
}: Omit<Options, "paper"> & { software?: string; instanceId?: string }): CommandCompletion {
  const [data, setData] = useState<McData | null>(mcData);
  useEffect(() => {
    if (!data) loadMcData().then(setData);
  }, [data]);

  // Array props are compared by identity; callers should memoize them.
  const r = useMemo(
    () => complete({ value, caret, players, knownPlayers, paper: hasPlugins(software ?? ""), commands }, data),
    [value, caret, players, knownPlayers, software, commands, data],
  );

  const memory = useRef(new Map<string, RemoteAnswer>());
  const inflight = useRef<{ line: string; ctl: AbortController } | null>(null);
  // The line the server could not answer (busy, too slow): not asked again until the line changes.
  const [failed, setFailed] = useState<string | null>(null);
  // Bumped when an answer lands or the memory is emptied, so `recall` below runs again.
  const [answers, setAnswers] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new list is the reason to forget.
  useEffect(() => {
    memory.current.clear();
    setAnswers((n) => n + 1);
  }, [commands]);

  const line = instanceId ? r.remote : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `answers` stands for the memory's contents.
  const known = useMemo(
    () => (line === null ? null : recall(memory.current, line, r.current)),
    [line, r.current, answers],
  );
  const ask = line !== null && known === null && failed !== line ? line : null;

  useEffect(() => {
    // A request for another line is abandoned as soon as the line changes.
    if (inflight.current && inflight.current.line !== ask) {
      inflight.current.ctl.abort();
      inflight.current = null;
    }
    if (ask === null || !instanceId || inflight.current) return;
    const t = setTimeout(async () => {
      const ctl = new AbortController();
      inflight.current = { line: ask, ctl };
      try {
        rememberAnswer(memory.current, ask, await instances.complete(instanceId, ask, ctl.signal));
      } catch (err) {
        if (ctl.signal.aborted) return;
        // No agent (a stopped server, an old agent): nothing to offer for this line, and no reason to
        // ask again. A busy server is asked again once the line changes.
        if (err instanceof ApiError && err.code === "agent_unavailable") {
          rememberAnswer(memory.current, ask, { suggestions: [] });
        } else {
          setFailed(ask);
        }
      } finally {
        if (inflight.current?.ctl === ctl) inflight.current = null;
        setAnswers((n) => n + 1);
      }
    }, REMOTE_DELAY_MS);
    return () => clearTimeout(t);
  }, [ask, instanceId]);

  useEffect(() => () => inflight.current?.ctl.abort(), []);

  return useMemo(() => {
    let suggestions: Suggestion[] = r.suggestions;
    if (known) {
      const fromServer = known.map((s) => ({ value: s.text, kind: "", detail: s.tooltip }));
      suggestions = [...fromServer, ...r.suggestions].slice(0, 50);
    }
    const apply = (text: string) => {
      const before = value.slice(0, r.start);
      const after = value.slice(caret).replace(/^\S*/, "");
      return { value: `${before}${text}${after}`, caret: before.length + text.length };
    };
    return { suggestions, current: r.current, apply, pending: ask !== null };
  }, [r, known, ask, value, caret]);
}
