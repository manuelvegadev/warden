/**
 * The MOTD, as the client sees it.
 *
 * server.properties stores the message of the day as legacy section-sign text: `§6` picks a colour,
 * `§l` a style, `§x§r§r§g§g§b§b` an arbitrary hex on Paper and Spigot 1.16+. Paper does not read
 * MiniMessage from this file, so section codes are the only thing we may write.
 *
 * Everything here works on the same shape — an array of hard lines, each an array of styled runs —
 * so the editor, the preview and the width meter cannot disagree about what a string means.
 */

export type Style = {
  color: string; // "#RRGGBB", always uppercase
  obf: boolean; // §k, the scrambling one
  bold: boolean; // §l
  strike: boolean; // §m
  under: boolean; // §n
  italic: boolean; // §o
};

export type Run = Style & { text: string };

/** The colour a client draws before any code is seen. */
const DEFAULT_COLOR = "#FFFFFF";

export const blankStyle = (): Style => ({
  color: DEFAULT_COLOR,
  obf: false,
  bold: false,
  strike: false,
  under: false,
  italic: false,
});

export const STYLE_KEYS = ["obf", "bold", "strike", "under", "italic"] as const;
export type StyleKey = (typeof STYLE_KEYS)[number];

/** `§0`–`§f`, in the order a palette should show them. */
export const COLORS: ReadonlyArray<{ code: string; name: string; hex: string }> = [
  { code: "0", name: "black", hex: "#000000" },
  { code: "1", name: "dark blue", hex: "#0000AA" },
  { code: "2", name: "dark green", hex: "#00AA00" },
  { code: "3", name: "dark aqua", hex: "#00AAAA" },
  { code: "4", name: "dark red", hex: "#AA0000" },
  { code: "5", name: "dark purple", hex: "#AA00AA" },
  { code: "6", name: "gold", hex: "#FFAA00" },
  { code: "7", name: "gray", hex: "#AAAAAA" },
  { code: "8", name: "dark gray", hex: "#555555" },
  { code: "9", name: "blue", hex: "#5555FF" },
  { code: "a", name: "green", hex: "#55FF55" },
  { code: "b", name: "aqua", hex: "#55FFFF" },
  { code: "c", name: "red", hex: "#FF5555" },
  { code: "d", name: "light purple", hex: "#FF55FF" },
  { code: "e", name: "yellow", hex: "#FFFF55" },
  { code: "f", name: "white", hex: "#FFFFFF" },
];

const COLOR_BY_CODE = new Map(COLORS.map((c) => [c.code, c.hex]));
const STYLE_BY_CODE: Record<string, StyleKey> = { k: "obf", l: "bold", m: "strike", n: "under", o: "italic" };
const CODE_BY_STYLE: Record<StyleKey, string> = { obf: "k", bold: "l", strike: "m", under: "n", italic: "o" };

export const SECTION = "\u00a7";

/**
 * Advance widths in Minecraft pixels, read out of MinecraftDefault-Regular with fontTools — see
 * app/fonts/README.md. Anything not listed is 6. Bold adds one to every glyph, which is why a bold
 * word is wider than the same word plain and not merely heavier.
 */
const WIDTH_GROUPS: Record<number, string> = {
  2: "!',.:;i|\u00a1\u00a6\u00b7",
  3: "`l\u00b4\u00ec\u00ed\u2022",
  4: ' "()*I[]t{}\u00a8\u00ad\u00b9\u00cc\u00cd\u00ce\u00cf\u00ee\u00ef\u2039\u203a\u266d\u266e',
  5: "<>fk\u00aa\u00b0\u00b2\u00b3\u00ba\u207f\u258c\u25cf",
  7: "@~\u00ab\u00b6\u00bb\u00d0\u2013\u221a\u2248\u25b7\u25c1\u2714\u2718",
  8: "\u00a4\u00a9\u00ae\u00bc\u00bd\u00be\u2026\u2190\u2192\u221e\u2302\u2551\u2557\u255d\u2563\u2591\u25ce\u2602\u2603\u2605\u2606\u2620\u266b\u266c\u2690\u2691\u2694\u2702\u2709\u270e\u2764",
  9: "\u2014\u2194\u21d2\u21d4\u2500\u250c\u2514\u251c\u252c\u2534\u253c\u2550\u2554\u255a\u2560\u2566\u2569\u256c\u2580\u2584\u2588\u2590\u2592\u2593\u2600\u2601\u26cf",
  10: "\u00c6\u00e6\u262e\u262f",
};

const WIDTHS = new Map<string, number>();
for (const [px, chars] of Object.entries(WIDTH_GROUPS)) {
  for (const ch of chars) WIDTHS.set(ch, Number(px));
}

/** Width of one glyph, in Minecraft pixels. */
export const glyphWidth = (ch: string, bold: boolean): number => (WIDTHS.get(ch) ?? 6) + (bold ? 1 : 0);

const runWidth = (r: Run): number => [...r.text].reduce((a, ch) => a + glyphWidth(ch, r.bold), 0);
export const lineWidth = (runs: Run[]): number => runs.reduce((w, r) => w + runWidth(r), 0);

/** The client wraps the MOTD at 270 pixels and draws the first two lines of the result. */
export const MAX_LINE_PX = 270;
export const MAX_LINES = 2;

/** Minecraft draws a one-pixel shadow in the text colour scaled to 25%. */
export function shadowColor(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const part = (v: number) => (v >> 2).toString(16).padStart(2, "0");
  return `#${part((n >> 16) & 255)}${part((n >> 8) & 255)}${part(n & 255)}`;
}

const sameStyle = (a: Style, b: Style) => a.color === b.color && STYLE_KEYS.every((k) => a[k] === b[k]);

/** Section-code text to hard lines of styled runs. `&` is accepted too, since people paste it. */
export function parseMotd(src: string): Run[][] {
  const lines: Run[][] = [[]];
  let style = blankStyle();
  let buf = "";
  const flush = () => {
    if (buf) {
      lines[lines.length - 1].push({ ...style, text: buf });
      buf = "";
    }
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\n") {
      flush();
      lines.push([]);
      continue;
    }
    if (ch !== SECTION && ch !== "&") {
      buf += ch;
      continue;
    }
    const code = (src[i + 1] ?? "").toLowerCase();
    if (code === "x") {
      // §x§r§r§g§g§b§b — the Spigot and Paper extension for arbitrary hex.
      const digits: string[] = [];
      let j = i + 2;
      while (digits.length < 6 && (src[j] === SECTION || src[j] === "&") && /[0-9a-f]/i.test(src[j + 1] ?? "")) {
        digits.push(src[j + 1]);
        j += 2;
      }
      if (digits.length === 6) {
        flush();
        style = { ...blankStyle(), color: `#${digits.join("").toUpperCase()}` };
        i = j - 1;
        continue;
      }
    }
    const color = COLOR_BY_CODE.get(code);
    if (color) {
      flush();
      style = { ...blankStyle(), color }; // a colour code also clears every style
      i++;
      continue;
    }
    const key = STYLE_BY_CODE[code];
    if (key) {
      flush();
      style = { ...style, [key]: true };
      i++;
      continue;
    }
    if (code === "r") {
      flush();
      style = blankStyle();
      i++;
      continue;
    }
    buf += ch; // a lone section sign the user actually typed
  }
  flush();
  return lines;
}

/** The code that selects a colour: one of the sixteen, or a §x run. */
function colorCode(hex: string): string {
  const known = COLORS.find((c) => c.hex.toLowerCase() === hex.toLowerCase());
  if (known) return SECTION + known.code;
  return `${SECTION}x${[...hex.slice(1).toLowerCase()].map((d) => SECTION + d).join("")}`;
}

/** Runs back to section-code text, emitting only what changed since the run before. */
export function serializeMotd(lines: Run[][]): string {
  return lines
    .map((runs) => {
      let out = "";
      let prev = blankStyle(); // the client starts white and unstyled
      for (const r of runs) {
        const dropped = STYLE_KEYS.some((k) => prev[k] && !r[k]);
        if (dropped || prev.color !== r.color) {
          out += colorCode(r.color); // the only way to turn a style off is to start over
          prev = { ...blankStyle(), color: r.color };
        }
        for (const k of STYLE_KEYS) {
          if (r[k] && !prev[k]) {
            out += SECTION + CODE_BY_STYLE[k];
            prev = { ...prev, [k]: true };
          }
        }
        out += r.text;
        prev = { ...r };
      }
      return out;
    })
    .join("\n");
}

/** Re-group per-character styles into runs. */
function mergeRuns(chars: { ch: string; style: Style }[]): Run[] {
  const runs: Run[] = [];
  for (const { ch, style } of chars) {
    const last = runs[runs.length - 1];
    if (last && sameStyle(last, style)) last.text += ch;
    else runs.push({ ...style, text: ch });
  }
  return runs;
}

/**
 * Wrap hard lines the way the client does: break at 270 pixels, preferring the last space, and
 * hard-break a word that is too long on its own. Lines past the second are still returned — the
 * caller shows them as dropped rather than pretending they do not exist.
 */
export function wrapMotd(hardLines: Run[][]): Run[][] {
  const out: Run[][] = [];
  for (const runs of hardLines) {
    const chars: { ch: string; style: Style }[] = [];
    for (const r of runs) for (const ch of r.text) chars.push({ ch, style: r });
    if (chars.length === 0) {
      out.push([]);
      continue;
    }
    let start = 0;
    do {
      let width = 0;
      let i = start;
      let lastSpace = -1;
      for (; i < chars.length; i++) {
        const w = glyphWidth(chars[i].ch, chars[i].style.bold);
        if (width + w > MAX_LINE_PX) break;
        width += w;
        if (chars[i].ch === " ") lastSpace = i;
      }
      let end: number;
      let next: number;
      if (i >= chars.length) {
        end = next = chars.length; // the rest fits
      } else if (lastSpace > start) {
        end = lastSpace; // break at the space, and drop it
        next = lastSpace + 1;
      } else {
        end = next = Math.max(i, start + 1); // one very long word
      }
      out.push(mergeRuns(chars.slice(start, end)));
      start = next;
    } while (start < chars.length);
  }
  return out;
}

/**
 * Obfuscated text swaps every glyph for a random one of the same advance width. That is what
 * FontSet.getRandomGlyph does, and it is why §k text does not jitter in game — or shove the rest
 * of the line around in the editor twenty times a second.
 */
const OBF_BUCKETS = (() => {
  const buckets = new Map<number, string[]>();
  const add = (ch: string) => {
    const w = glyphWidth(ch, false);
    const bucket = buckets.get(w) ?? [];
    if (!bucket.includes(ch)) bucket.push(ch);
    buckets.set(w, bucket);
  };
  for (let cp = 0x21; cp <= 0x7e; cp++) add(String.fromCharCode(cp));
  for (const ch of WIDTHS.keys()) if (ch !== " " && ch !== "\u00ad") add(ch); // no soft hyphen: it draws nothing
  return buckets;
})();

export function scrambleObfuscated(src: string): string {
  return [...src]
    .map((ch) => {
      if (ch === " ") return ch;
      const bucket = OBF_BUCKETS.get(glyphWidth(ch, false));
      return bucket ? bucket[Math.floor(Math.random() * bucket.length)] : ch;
    })
    .join("");
}

/** Flatten runs to plain text plus a style per character — the shape the editor edits. */
export function toChars(lines: Run[][]): { text: string; styles: Style[] } {
  let text = "";
  const styles: Style[] = [];
  lines.forEach((runs, i) => {
    if (i) {
      text += "\n";
      styles.push(blankStyle());
    }
    for (const r of runs) {
      const { text: _drop, ...style } = r;
      for (const ch of r.text) {
        text += ch;
        styles.push({ ...style });
      }
    }
  });
  return { text, styles };
}

/** The inverse of toChars. */
export function fromChars(text: string, styles: Style[]): Run[][] {
  const lines: Run[][] = [[]];
  let cur: Run | null = null;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      lines.push([]);
      cur = null;
      continue;
    }
    const style = styles[i] ?? blankStyle();
    if (cur && sameStyle(cur, style)) cur.text += text[i];
    else {
      cur = { ...style, text: text[i] };
      lines[lines.length - 1].push(cur);
    }
  }
  return lines;
}
