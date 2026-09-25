// Console command history, shell-style: pure functions so the key handling can be tested without a DOM.

/** As many sent commands as the game's own chat keeps. */
export const HISTORY_MAX = 100;

/**
 * Records a sent command, newest first. A command sent before moves to the front instead of
 * appearing twice (zsh's HIST_IGNORE_ALL_DUPS): a console's commands repeat a lot, and a list
 * without repeats reaches further back.
 */
export function record(history: readonly string[], command: string, max = HISTORY_MAX): string[] {
  const cmd = command.trim();
  if (!cmd) return history.slice(0, max);
  return [cmd, ...history.filter((h) => h !== cmd)].slice(0, max);
}

/** Where ↑/↓ are in the history: `index` −1 means not navigating, the line shows the draft. */
export interface HistoryNav {
  index: number;
  /** What was typed before the first ↑, restored past the newest entry. */
  draft: string;
}

export const NOT_NAVIGATING: HistoryNav = { index: -1, draft: "" };

/**
 * One step through the history. The first ↑ keeps what was typed as the draft, and only entries
 * that start with it are visited (every entry, for an empty line; zsh's up-line-or-beginning-search).
 * ↑ stops at the oldest match; ↓ past the newest brings the draft back. `null` means nothing moves.
 */
export function navigate(
  nav: HistoryNav,
  dir: "up" | "down",
  history: readonly string[],
  value: string,
): { nav: HistoryNav; value: string } | null {
  const draft = nav.index === -1 ? value : nav.draft;
  const matches = (h: string) => h !== draft && h.startsWith(draft);
  if (dir === "up") {
    for (let i = nav.index + 1; i < history.length; i++) {
      if (matches(history[i])) return { nav: { index: i, draft }, value: history[i] };
    }
    return null;
  }
  if (nav.index === -1) return null;
  for (let i = nav.index - 1; i >= 0; i--) {
    if (matches(history[i])) return { nav: { index: i, draft }, value: history[i] };
  }
  return { nav: NOT_NAVIGATING, value: draft };
}

/**
 * Who takes ↑/↓: the suggestion list while it is open over typed text, history otherwise — an
 * empty line always walks history, and once history navigation has begun it keeps the arrows.
 */
export function arrowTarget({
  listOpen,
  value,
  navigating,
}: {
  listOpen: boolean;
  value: string;
  navigating: boolean;
}): "list" | "history" {
  if (navigating || value === "") return "history";
  return listOpen ? "list" : "history";
}

/** A stored history, or none: anything that is not a list of strings is dropped. */
export function parseHistory(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}
