/**
 * Console completion answered by the server (ADR-024): the command list the Warden Agent sends, and
 * a memory of its live answers so that typing on through one argument costs one request, not one
 * per keystroke. Pure; `useCommandCompletion` does the asking.
 */
import { remember } from "@/lib/plugin-search";

/** A command the console can run, as the agent lists it. `plugin` is absent for the server's own. */
export interface ServerCommand {
  name: string;
  aliases?: string[];
  plugin?: string;
  description?: string;
  usage?: string;
}

/** The agent's answer for one line: completions of the token that ends it. */
export interface RemoteAnswer {
  suggestions: { text: string; tooltip?: string }[];
  /** The agent capped the list: it cannot be narrowed locally for a longer token. */
  truncated?: boolean;
}

/** Quiet time after the last keystroke before the server is asked. */
export const REMOTE_DELAY_MS = 120;

/** Answers remembered per console; the oldest are forgotten first. */
export const REMOTE_MEMORY = 50;

export const rememberAnswer = (memory: Map<string, RemoteAnswer>, line: string, answer: RemoteAnswer) =>
  remember(memory, line, answer, REMOTE_MEMORY);

/** The command a label (name or alias, any case) names, if the server has it. */
export function findCommand(commands: readonly ServerCommand[] | undefined, label: string): ServerCommand | undefined {
  if (!commands) return undefined;
  const l = label.toLowerCase();
  return commands.find((c) => c.name === l || c.aliases?.includes(l));
}

/** The first label of a command (its name, then its aliases) that starts with `q`, if any. */
export function matchingLabel(c: ServerCommand, q: string): string | undefined {
  if (c.name.startsWith(q)) return c.name;
  return c.aliases?.find((a) => a.startsWith(q));
}

/**
 * Whether a suggestion completes the typed token, the way Minecraft's own suggestions match: from
 * the start, or from the start of a word inside it — after a namespace (`minecraft:stone` for
 * `stone`) or a separator (`oak_planks` for `plank`s). Case does not matter.
 */
export const matchesToken = (text: string, token: string): boolean => matchAt(text, token) >= 0;

/** Where the typed token matches inside a suggestion, as `matchesToken` matches; -1 when it does not. */
export function matchAt(text: string, token: string): number {
  if (!token) return 0;
  const t = text.toLowerCase();
  const q = token.toLowerCase();
  if (t.startsWith(q)) return 0;
  for (let i = 0; i < t.length; i++) {
    if (":_.-/".includes(t[i]) && t.startsWith(q, i + 1)) return i + 1;
  }
  return -1;
}

/**
 * What the memory already knows for `line`, whose last `current.length` characters are the token
 * being completed: the answer for the line itself, or one for a shorter token of the same argument
 * narrowed to this one (unless that answer was capped). Null when the server must be asked.
 */
export function recall(
  memory: ReadonlyMap<string, RemoteAnswer>,
  line: string,
  current: string,
): RemoteAnswer["suggestions"] | null {
  const narrow = (a: RemoteAnswer) => a.suggestions.filter((s) => matchesToken(s.text, current));
  const exact = memory.get(line);
  if (exact) return narrow(exact);
  const base = line.slice(0, line.length - current.length);
  for (let k = current.length - 1; k >= 0; k--) {
    const shorter = memory.get(base + current.slice(0, k));
    if (shorter) return shorter.truncated ? null : narrow(shorter);
  }
  return null;
}
