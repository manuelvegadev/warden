import { type Arg, argAt, COMMANDS, PAPER_COMMANDS, SELECTORS, tokenize } from "@/lib/command-grammar";
import { GAMERULES } from "@/lib/mc/gamerules";
import { STRUCTURES } from "@/lib/mc/structures";

export type McData = {
  items: string[];
  entities: string[];
  effects: string[];
  biomes: string[];
  enchantments: string[];
};

export interface Suggestion {
  /** Text inserted in place of the current token. */
  value: string;
  /** Placeholder shown in place of the value when nothing can be completed (e.g. `<seconds>`). */
  hint?: string;
  /** Short label for the list (e.g. "player", "item"). */
  kind: string;
}

export interface CompletionState {
  suggestions: Suggestion[];
  /** New input value and caret after replacing the current token with `text`. */
  apply: (text: string) => { value: string; caret: number };
  /** The token under the caret (what the suggestions were matched against). */
  current: string;
}

export interface Options {
  value: string;
  caret: number;
  /** Players online (first in the list). */
  players?: readonly string[];
  /** Players that have ever joined. */
  knownPlayers?: readonly string[];
  /** Offer the Paper-only commands. */
  paper?: boolean;
}

const MAX = 12;

const NONE: Suggestion[] = [];

/** Values for an argument that start with `q`; the catalogues are big, so filter before allocating. */
function candidates(arg: Arg, q: string, o: Options, data: McData | null): Suggestion[] {
  const of = (kind: string, xs: readonly string[]) =>
    xs.filter((x) => x.toLowerCase().startsWith(q)).map((value) => ({ value, kind }));
  switch (arg.type) {
    case "literal":
      return of("", arg.values);
    case "player": {
      const online = o.players ?? [];
      const seen = new Set(online);
      const known = (o.knownPlayers ?? []).filter((p) => !seen.has(p));
      return [...of("online", online), ...of("player", known), ...of("selector", SELECTORS)];
    }
    case "item":
      return of("item", data?.items ?? []);
    case "entity":
      return of("entity", data?.entities ?? []);
    case "effect":
      return of("effect", data?.effects ?? []);
    case "biome":
      return of("biome", data?.biomes ?? []);
    case "enchantment":
      return of("enchantment", data?.enchantments ?? []);
    case "structure":
      return of("structure", STRUCTURES);
    case "gamerule":
      return of("gamerule", GAMERULES);
    case "objective":
      return NONE;
    case "text":
    case "number":
      return arg.hint ? [{ value: "", hint: arg.hint, kind: "" }] : NONE;
    case "coords":
      return [{ value: "", hint: "<x> <y> <z>", kind: "" }];
  }
}

/** Suggestions for the token under the caret. Pure; see `useCommandCompletion` for the hook. */
export function complete(o: Options, data: McData | null): Omit<CompletionState, "apply"> & { start: number } {
  const head = o.value.slice(0, o.caret);
  const { tokens, current, inJson } = tokenize(head);
  const start = o.caret - current.length;
  const empty = { suggestions: NONE, current, start };
  if (inJson) return empty;

  const arg = argAt(tokens);
  const q = current.toLowerCase();
  let all: Suggestion[];
  if (arg === "command") {
    all = Object.keys(COMMANDS)
      .filter((c) => (o.paper || !PAPER_COMMANDS.has(c)) && c.startsWith(q))
      .map((value) => ({ value, kind: PAPER_COMMANDS.has(value) ? "paper" : "" }));
  } else if (arg) {
    all = candidates(arg, q, o, data);
  } else {
    return empty;
  }

  // Only offer a hint while nothing has been typed for that argument.
  const suggestions = (current === "" ? all : all.filter((s) => !s.hint)).slice(0, MAX);
  return { suggestions, current, start };
}
