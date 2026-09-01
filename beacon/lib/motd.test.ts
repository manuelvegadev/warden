import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blankStyle,
  fromChars,
  glyphWidth,
  lineWidth,
  MAX_LINE_PX,
  parseMotd,
  scrambleObfuscated,
  serializeMotd,
  toChars,
  wrapMotd,
} from "./motd.ts";

const text = (runs: { text: string }[]) => runs.map((r) => r.text).join("");

test("parses colours, styles, hex and newlines", () => {
  const lines = parseMotd("§6§lMaincra §r§7survival\n§x§0§0§d§4§f§fneon");
  assert.equal(lines.length, 2);
  assert.deepEqual(
    lines[0].map((r) => [r.text, r.color, r.bold]),
    [
      ["Maincra ", "#FFAA00", true],
      ["survival", "#AAAAAA", false],
    ],
  );
  assert.equal(lines[1][0].color, "#00D4FF");
});

test("a colour code clears the styles before it, the way the client does", () => {
  const [line] = parseMotd("§lbold§ethen not");
  assert.equal(line[0].bold, true);
  assert.equal(line[1].bold, false);
});

test("a lone section sign is text, not a broken code", () => {
  const [line] = parseMotd("100§ off");
  assert.equal(text(line), "100§ off");
});

test("serialize round-trips a normalised string byte for byte", () => {
  for (const src of [
    "plain",
    "§6§lMaincra §7survival\n§aOpen now §8· §fbring friends",
    "§x§0§0§d§4§f§f§lMAINCRA",
    "§4§k§l!! §c§lPVP",
    "",
  ]) {
    assert.equal(serializeMotd(parseMotd(src)), src, `round trip of ${JSON.stringify(src)}`);
  }
});

test("style codes come out in one fixed order, since the client does not care", () => {
  assert.equal(serializeMotd(parseMotd("§4§l§k!!")), "§4§k§l!!");
  assert.deepEqual(parseMotd("§4§l§k!!"), parseMotd("§4§k§l!!"));
});

test("a redundant §r before a colour is dropped, because the colour already resets", () => {
  const src = "§6§lMaincra §r§7survival";
  const once = serializeMotd(parseMotd(src));
  assert.equal(once, "§6§lMaincra §7survival");
  assert.equal(serializeMotd(parseMotd(once)), once, "and the shorter form is stable");
  // the two strings mean the same thing to a client
  assert.deepEqual(parseMotd(src), parseMotd(once));
});

test("plain white text needs no codes at all", () => {
  assert.equal(serializeMotd(parseMotd("just words")), "just words");
});

test("advance widths come from the font, not from folklore", () => {
  // the seven characters every generator on the web gets wrong
  for (const [ch, px] of [
    ['"', 4],
    ["'", 2],
    ["(", 4],
    [")", 4],
    ["*", 4],
    ["{", 4],
    ["}", 4],
  ] as const) {
    assert.equal(glyphWidth(ch, false), px, `width of ${ch}`);
  }
  assert.equal(glyphWidth("A", false), 6);
  assert.equal(glyphWidth("A", true), 7, "bold costs one pixel per glyph");
  assert.equal(glyphWidth(" ", false), 4);
});

test("wraps at 270px on spaces, keeping the overflow visible to the caller", () => {
  const long =
    "§eThis is a deliberately long single line that must wrap at two hundred and seventy pixels and then drop the rest of it entirely";
  const wrapped = wrapMotd(parseMotd(long));
  assert.equal(wrapped.length, 3, "the third line is returned so the editor can warn about it");
  for (const line of wrapped) assert.ok(lineWidth(line) <= MAX_LINE_PX, `${lineWidth(line)}px fits`);
  assert.ok(
    wrapped[0].every((r) => !r.text.endsWith(" ")),
    "the break space is dropped",
  );
  assert.equal(
    wrapped.map(text).join(" "),
    "This is a deliberately long single line that must wrap at two hundred and seventy pixels and then drop the rest of it entirely",
  );
});

test("a single word longer than the line is broken mid-word", () => {
  const wrapped = wrapMotd(parseMotd("s".repeat(80)));
  assert.ok(wrapped.length > 1);
  assert.ok(lineWidth(wrapped[0]) <= MAX_LINE_PX);
});

test("bold is measured as bold when wrapping", () => {
  const plain = wrapMotd(parseMotd("word ".repeat(11).trim()));
  const bold = wrapMotd(parseMotd(`§l${"word ".repeat(11).trim()}`));
  assert.ok(lineWidth(bold[0]) !== lineWidth(plain[0]) || bold.length !== plain.length);
});

test("obfuscated text keeps its advance width", () => {
  const src = "Maincra survival !!";
  const width = (s: string) => [...s].reduce((a, ch) => a + glyphWidth(ch, false), 0);
  for (let i = 0; i < 20; i++) {
    assert.equal(width(scrambleObfuscated(src)), width(src));
  }
});

test("chars and runs are inverses", () => {
  const src = "§6§lMaincra §r§7survival\n§aOpen §8· §fnow";
  const { text: plain, styles } = toChars(parseMotd(src));
  assert.equal(plain, "Maincra survival\nOpen · now");
  assert.equal(styles.length, plain.length);
  assert.deepEqual(fromChars(plain, styles), parseMotd(src), "the runs survive the trip through characters");
});

test("a character with no style falls back to the client default", () => {
  const runs = fromChars("ab", [blankStyle()]);
  assert.equal(runs[0].length, 1, "both characters share the default style");
  assert.equal(text(runs[0]), "ab");
});
