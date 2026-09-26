import type { ConsoleLine } from "@/lib/api";

/**
 * Turns raw server log lines into something a person can scan: the time, who logged it (thread or
 * plugin), what kind of event it is and, for player events, who. Mirrors the events wardend
 * extracts (wardend/internal/mc/logparser.go) and adds the ones only the panel cares about.
 */
export type Kind =
  | "join"
  | "leave"
  | "chat"
  | "advancement"
  | "death"
  | "command"
  | "stdin"
  | "system"
  | "server"
  | "overload"
  | "warn"
  | "error"
  | "plugin"
  | "info";

export interface ParsedLine {
  time: string;
  level: ConsoleLine["level"];
  /** Logging thread when the line carries one (vanilla / Paper `[Server thread/INFO]`). */
  thread?: string;
  /** Plugin or logger name, e.g. `LuckPerms`. */
  source?: string;
  kind: Kind;
  player?: string;
  message: string;
  /** The line as the server printed it (for copying). */
  raw: string;
}

// Paper: "[12:00:01 INFO]: "; vanilla / older: "[12:00:01] [Server thread/INFO]: ".
const prefixRe = /^\[(\d{2}:\d{2}:\d{2})(?: [A-Z]+)?\](?: \[([^\]]*?)(?:\/[A-Z]+)?\])?: /;
// "[LuckPerms] message" — a plugin (or logger) tag at the start of the body.
const sourceRe = /^\[([A-Za-z][\w .-]{1,40})\] /;

const joinRe = /^(\S+) joined the game$/;
const leaveRe = /^(\S+) (?:left the game|lost connection: .*)$/;
const chatRe = /^<(\S+)> (.*)$/;
const advanceRe = /^(\S+) has (?:made the advancement|completed the challenge|reached the goal) \[(.+)\]$/;
const commandRe = /^(\S+) issued server command: (.*)$/;
const deathRe =
  /^(\S+) (?:was slain by|was shot by|was killed|was blown up|was fireballed|was pummeled|was squashed|was impaled|was struck by lightning|was burnt|was pricked|was stung|was poked|was doomed|was frozen|was skewered|fell from a high place|fell off|fell out of the world|drowned|burned to death|hit the ground too hard|tried to swim in lava|starved to death|suffocated|withered away|experienced kinetic energy|blew up|went up in flames|walked into|discovered the floor was lava|died)\b/;
const serverRe =
  /^(?:Done \([\d.]+s\)!|Starting minecraft server|Starting Minecraft server|Loading libraries|Preparing (?:level|spawn area|start region)|Stopping (?:the )?server|Saving (?:players|worlds|chunks)|Saved the game|Automatic saving|Time elapsed|This server is running|Loading properties|Default game type|Generating keypair|Closing Server|Server empty|Reloading ResourceManager|Loaded \d+ recipes|Loaded \d+ advancements)/;
const overloadRe = /^Can't keep up!/;

const time = (line: ConsoleLine, fromPrefix?: string) => {
  if (fromPrefix) return fromPrefix;
  const d = new Date(line.ts);
  return Number.isNaN(d.getTime()) ? "" : d.toTimeString().slice(0, 8);
};

export function parseConsoleLine(line: ConsoleLine): ParsedLine {
  const text = line.text.replace(/[\r\n]+$/, "");
  const m = prefixRe.exec(text);
  const body = m ? text.slice(m[0].length) : text;
  const thread = m?.[2] || undefined;
  const base = { time: time(line, m?.[1]), level: line.level, thread, raw: text };

  if (line.level === "STDIN") return { ...base, kind: "stdin", message: body.replace(/^> ?/, "") };
  if (line.level === "SYSTEM") return { ...base, kind: "system", message: body.replace(/^\[wardend\]:? ?/, "") };

  let source: string | undefined;
  let message = body;
  const s = sourceRe.exec(message);
  if (s && !/^(?:Server|Client|Rendering|Async|Craft|Netty|Worker)/.test(s[1])) {
    source = s[1];
    message = message.slice(s[0].length);
  }

  const withSource = { ...base, source };
  const player = (re: RegExp, kind: Kind, msg?: (m: RegExpExecArray) => string): ParsedLine | undefined => {
    const m = re.exec(message);
    return m ? { ...withSource, kind, player: m[1], message: msg ? msg(m) : message } : undefined;
  };
  const event =
    player(joinRe, "join") ??
    player(leaveRe, "leave") ??
    player(chatRe, "chat", (m) => m[2]) ??
    player(advanceRe, "advancement", (m) => m[2]) ??
    player(commandRe, "command", (m) => m[2]) ??
    player(deathRe, "death");
  if (event) return event;
  if (overloadRe.test(message)) return { ...withSource, kind: "overload", message };
  if (line.level === "ERROR" || line.level === "FATAL") return { ...withSource, kind: "error", message };
  if (line.level === "WARN") return { ...withSource, kind: "warn", message };
  if (serverRe.test(message)) return { ...withSource, kind: "server", message };
  if (source) return { ...withSource, kind: "plugin", message };
  return { ...withSource, kind: "info", message };
}

// The level in a log file's prefix: Paper "[12:00:01 WARN]: ", vanilla "[12:00:01] [Server thread/WARN]: ".
const fileLevelRe = /^\[\d{2}:\d{2}:\d{2}(?: ([A-Z]+))?\](?: \[[^\]]*?\/([A-Z]+)\])?/;
const LEVELS = new Set<ConsoleLine["level"]>(["INFO", "WARN", "ERROR", "FATAL", "DEBUG"]);
// Lines that belong to the entry above them: a stack trace's frames and causes…
const frameRe = /^\s|^Caused by: |^\.\.\. \d+ more/;
// …and the exception named on the line right after the log entry that reported it.
const exceptionRe = /^[a-z][\w$]*(?:\.[\w$]+)+(?:Exception|Error|Throwable)\b/;

/**
 * A log file read as console lines, for the pretty view (`logs/*.log`, `*.log.gz`, crash
 * reports): the level taken from each line's prefix, and every line that continues an entry — a
 * stack trace, most of all — folded into that entry, joined by newlines, so it can collapse.
 * Lines before the first entry, and files without prefixes, are entries of their own.
 */
export function logLines(text: string): ConsoleLine[] {
  const out: ConsoleLine[] = [];
  // Whether the entry above is a logged line (it has a prefix) with nothing blank since.
  let afterLogged = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line === "") {
      afterLogged = false;
      continue;
    }
    const last = out[out.length - 1];
    const m = fileLevelRe.exec(line);
    if (!m && last && (frameRe.test(line) || (afterLogged && exceptionRe.test(line)))) {
      last.text += `\n${line}`;
      continue;
    }
    const level = (m?.[2] ?? m?.[1]) as ConsoleLine["level"] | undefined;
    out.push({ ts: "", level: level && LEVELS.has(level) ? level : "INFO", text: line });
    afterLogged = Boolean(m);
  }
  return out;
}
