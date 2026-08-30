/**
 * Declarative grammar for console command completion. Each command maps to the shape of its
 * arguments, either a fixed list or a function of the tokens typed so far (for subcommands). Only
 * shapes we are sure of are listed; unknown positions fall back to free text.
 */
export type Arg =
  | { type: "literal"; values: readonly string[] }
  | { type: "player" }
  | { type: "item" }
  | { type: "entity" }
  | { type: "effect" }
  | { type: "biome" }
  | { type: "structure" }
  | { type: "gamerule" }
  | { type: "enchantment" }
  | { type: "objective" }
  | { type: "text"; hint?: string }
  | { type: "number"; hint?: string }
  | { type: "coords" };

/** Tokens already typed before the one being completed (the command name included). */
export type Tokens = readonly string[];
export type Shape = readonly Arg[] | ((tokens: Tokens) => readonly Arg[]);

const lit = (...values: string[]): Arg => ({ type: "literal", values });
const player: Arg = { type: "player" };
const text = (hint?: string): Arg => ({ type: "text", hint });
const num = (hint: string): Arg => ({ type: "number", hint });
const coords: Arg = { type: "coords" };

const GAMEMODES = ["survival", "creative", "adventure", "spectator"] as const;
const DIFFICULTIES = ["peaceful", "easy", "normal", "hard"] as const;
const DISPLAY_SLOTS = ["list", "sidebar", "below_name"] as const;
export const SELECTORS = ["@a", "@p", "@r", "@e", "@s"] as const;

/** Shape after `scoreboard`. */
const scoreboard = (t: Tokens): readonly Arg[] => {
  const [, group, sub] = t;
  if (group === "objectives") {
    switch (sub) {
      case "add":
        return [
          lit("objectives"),
          lit("add"),
          text("<objective>"),
          lit("dummy", "health", "playerKillCount", "totalKillCount", "deathCount", "trigger"),
          text("<display name>"),
        ];
      case "remove":
        return [lit("objectives"), lit("remove"), { type: "objective" }];
      case "setdisplay":
        return [lit("objectives"), lit("setdisplay"), lit(...DISPLAY_SLOTS), { type: "objective" }];
      case "modify":
        return [
          lit("objectives"),
          lit("modify"),
          { type: "objective" },
          lit("rendertype", "displayname"),
          lit("hearts", "integer"),
        ];
      case "list":
        return [lit("objectives"), lit("list")];
      default:
        return [lit("objectives"), lit("add", "remove", "setdisplay", "modify", "list")];
    }
  }
  if (group === "players") {
    switch (sub) {
      case "set":
      case "add":
      case "remove":
        return [lit("players"), lit(sub), player, { type: "objective" }, num("<score>")];
      case "reset":
        return [lit("players"), lit("reset"), player, { type: "objective" }];
      case "list":
        return [lit("players"), lit("list"), player];
      default:
        return [lit("players"), lit("set", "add", "remove", "reset", "list")];
    }
  }
  return [lit("objectives", "players")];
};

const effect = (t: Tokens): readonly Arg[] =>
  t[1] === "clear"
    ? [lit("clear"), player, { type: "effect" }]
    : [
        lit("give", "clear"),
        player,
        { type: "effect" },
        num("<seconds|infinite>"),
        num("<amplifier>"),
        lit("true", "false"),
      ];

const time = (t: Tokens): readonly Arg[] => {
  switch (t[1]) {
    case "set":
      return [lit("set"), lit("day", "noon", "night", "midnight")];
    case "add":
      return [lit("add"), num("<ticks>")];
    case "query":
      return [lit("query"), lit("daytime", "gametime", "day")];
    default:
      return [lit("set", "add", "query")];
  }
};

const whitelist = (t: Tokens): readonly Arg[] =>
  t[1] === "add" || t[1] === "remove" ? [lit(t[1]), player] : [lit("on", "off", "add", "remove", "list", "reload")];

const worldborder = (t: Tokens): readonly Arg[] => {
  switch (t[1]) {
    case "set":
    case "add":
      return [lit(t[1]), num("<blocks>"), num("<seconds>")];
    case "center":
      return [lit("center"), num("<x>"), num("<z>")];
    default:
      return [lit("set", "add", "center", "get")];
  }
};

const locate = (t: Tokens): readonly Arg[] =>
  t[1] === "biome" ? [lit("biome"), { type: "biome" }] : [lit("structure", "biome", "poi"), { type: "structure" }];

const xp = (t: Tokens): readonly Arg[] =>
  t[1] === "query"
    ? [lit("query"), player, lit("points", "levels")]
    : [lit("add", "set", "query"), player, num("<amount>"), lit("points", "levels")];

const paper: readonly Arg[] = [
  lit("entity", "chunkinfo", "mobcaps", "fixlight", "heap", "reload", "version"),
  lit("list"),
];

const execute = (t: Tokens): readonly Arg[] => {
  // `execute as <player> at @s run <command…>`: after `run` the rest is a nested command.
  const run = t.indexOf("run");
  if (run > 0) return [];
  const last = t[t.length - 1];
  if (last === "as" || last === "at") return [...t.slice(1).map((x) => lit(x)), player];
  return [...t.slice(1).map((x) => lit(x)), lit("as", "at", "run", "in", "positioned")];
};

export const COMMANDS: Record<string, Shape> = {
  help: [text("<command>")],
  list: [lit("uuids")],
  say: [text("<message>")],
  tellraw: [player, text("<json text>")],
  title: [player, lit("title", "subtitle", "actionbar", "times", "clear", "reset"), text("<json text>")],
  kick: [player, text("<reason>")],
  ban: [player, text("<reason>")],
  "ban-ip": [text("<ip|player>"), text("<reason>")],
  banlist: [lit("players", "ips")],
  pardon: [player],
  "pardon-ip": [text("<ip>")],
  whitelist,
  op: [player],
  deop: [player],
  gamemode: [lit(...GAMEMODES), player],
  tp: [player, player],
  teleport: [player, player],
  give: [player, { type: "item" }, num("<count>")],
  clear: [player, { type: "item" }, num("<max count>")],
  effect,
  xp,
  experience: xp,
  kill: [player],
  spawnpoint: [player, coords],
  setworldspawn: [coords],
  time,
  weather: [lit("clear", "rain", "thunder"), num("<duration>")],
  difficulty: [lit(...DIFFICULTIES)],
  gamerule: [{ type: "gamerule" }, lit("true", "false")],
  worldborder,
  locate,
  seed: [],
  "save-all": [lit("flush")],
  "save-off": [],
  "save-on": [],
  stop: [],
  scoreboard,
  execute,
  enchant: [player, { type: "enchantment" }, num("<level>")],
  summon: [{ type: "entity" }, coords],
  setblock: [coords, { type: "item" }],
  fill: [coords, coords, { type: "item" }],
  // Paper / Purpur only (see PAPER_COMMANDS).
  tps: [],
  mspt: [],
  plugins: [],
  version: [text("<plugin>")],
  paper,
  purpur: [lit("reload", "version")],
  ping: [player],
  uptime: [],
};

export const PAPER_COMMANDS = new Set(["tps", "mspt", "plugins", "version", "paper", "purpur", "ping", "uptime"]);

/** Splits the input into tokens; the trailing token is what is being completed (may be ""). */
export function tokenize(input: string): { tokens: string[]; current: string; inJson: boolean } {
  const opens = (input.match(/{/g) ?? []).length;
  const closes = (input.match(/}/g) ?? []).length;
  const parts = input.split(/\s+/);
  const current = input.endsWith(" ") || input === "" ? "" : (parts.pop() ?? "");
  const tokens = parts.filter((p) => p !== "");
  return { tokens, current, inJson: opens > closes };
}

/** The argument at the position being completed, given the tokens typed before it. */
export function argAt(tokens: Tokens): Arg | "command" | undefined {
  if (tokens.length === 0) return "command";
  // Inside `execute … run`, complete the nested command from scratch.
  const run = tokens.indexOf("run");
  if (tokens[0] === "execute" && run > 0) return argAt(tokens.slice(run + 1));
  const shape = COMMANDS[tokens[0]];
  if (!shape) return undefined;
  const args = typeof shape === "function" ? shape(tokens) : shape;
  return args[tokens.length - 1];
}
