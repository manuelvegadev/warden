import { type Arg, argAt, COMMANDS, PAPER_COMMANDS, SELECTORS, type Tokens, tokenize } from "@/lib/command-grammar";
import { findCommand, matchingLabel, type ServerCommand } from "@/lib/command-remote";
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
  /** Short label for the list (e.g. "player", "item", or the plugin a command comes from). */
  kind: string;
  /** Muted text beside the value: the server's tooltip for it, or the command an alias stands for. */
  detail?: string;
  /** What the command does, shown on hover. */
  description?: string;
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
  /**
   * The commands the server can run, from its Warden Agent (ADR-024); absent while no agent is
   * connected. With it, command names come from the server, and the arguments of a command the
   * grammar does not know — or that a plugin took over — are the server's to complete.
   */
  commands?: readonly ServerCommand[];
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

/** The tokens of the command being typed: inside `execute … run`, the nested one. */
function commandTokens(tokens: Tokens): Tokens {
  const run = tokens.indexOf("run");
  if (tokens[0] === "execute" && run > 0) return commandTokens(tokens.slice(run + 1));
  return tokens;
}

/** Command names from the server's list, one row per command however many of its labels match. */
function serverCommands(commands: readonly ServerCommand[], q: string): Suggestion[] {
  const out: Suggestion[] = [];
  for (const c of commands) {
    const value = matchingLabel(c, q);
    if (value === undefined) continue;
    const kind = c.plugin ?? (PAPER_COMMANDS.has(c.name) ? "paper" : "");
    out.push({ value, kind, detail: value === c.name ? undefined : c.name, description: c.description });
  }
  return out;
}

export interface Completed extends Omit<CompletionState, "apply"> {
  /** Where the token under the caret starts. */
  start: number;
  /**
   * The line up to the caret when the server answers for this position (a plugin's command, or one
   * the grammar does not know); null when the grammar does. The suggestions then hold only hints.
   */
  remote: string | null;
}

/** Suggestions for the token under the caret. Pure; see `useCommandCompletion` for the hook. */
export function complete(o: Options, data: McData | null): Completed {
  const head = o.value.slice(0, o.caret);
  const { tokens, current, inJson } = tokenize(head);
  const start = o.caret - current.length;
  const empty = { suggestions: NONE, current, start, remote: null };
  if (inJson) return empty;

  const q = current.toLowerCase();
  const cmd = commandTokens(tokens);
  if (cmd.length > 0 && o.commands) {
    // Arguments: the grammar's, unless a plugin owns the command or the grammar does not know it.
    const owner = findCommand(o.commands, cmd[0]);
    if (owner?.plugin || !COMMANDS[cmd[0]]) {
      const hint = current === "" && owner?.usage ? [{ value: "", hint: owner.usage, kind: "" }] : NONE;
      return { suggestions: hint, current, start, remote: head };
    }
  }

  const arg = argAt(tokens);
  let all: Suggestion[];
  if (arg === "command") {
    all = o.commands
      ? serverCommands(o.commands, q)
      : Object.keys(COMMANDS)
          .filter((c) => (o.paper || !PAPER_COMMANDS.has(c)) && c.startsWith(q))
          .map((value) => ({ value, kind: PAPER_COMMANDS.has(value) ? "paper" : "" }));
  } else if (arg) {
    all = candidates(arg, q, o, data);
  } else {
    return empty;
  }

  // Only offer a hint while nothing has been typed for that argument.
  const suggestions = (current === "" ? all : all.filter((s) => !s.hint)).slice(0, MAX);
  return { suggestions, current, start, remote: null };
}
