import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { BRAND } from "@warden/ui/lib/brand";

// BRAND carries hex copies of two CSS tokens, because a manifest and a <meta> cannot read CSS. A
// comment saying "this mirrors --background" is what was there before, and it still drifted two
// shades. This reads the stylesheet instead.

const THEME_CSS = join(import.meta.dirname, "..", "..", "packages", "ui", "src", "styles", "theme.css");

/** oklch(L C H) → sRGB hex, enough for a flat UI colour (D65, no gamut mapping needed for greys). */
function oklchToHex(L: number, C: number, H: number): string {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const channel = (v: number) => {
    const srgb = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, srgb)) * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${linear.map(channel).join("")}`;
}

/** The value of `--name` inside the `.dark { … }` rule of theme.css. */
function darkToken(name: string): string {
  const css = readFileSync(THEME_CSS, "utf8");
  // Anchored on the rule, not on the substring ".dark": `@custom-variant dark (&:is(.dark *))`
  // appears first and would hand back the light palette.
  const start = css.search(/^\.dark\s*\{/m);
  assert.notEqual(start, -1, "no `.dark { … }` rule in theme.css");
  const dark = css.slice(start, css.indexOf("\n}", start));
  const match = dark.match(new RegExp(`--${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`));
  assert.ok(match, `--${name} not found as an oklch() value in the .dark block of theme.css`);
  return oklchToHex(Number(match[1]), Number(match[2]), Number(match[3]));
}

test("BRAND.theme is the dark --background, the surface behind the app", () => {
  assert.equal(BRAND.theme, darkToken("background"));
});

test("BRAND.shell is the dark --sidebar, the surface behind the sidebar and header", () => {
  assert.equal(BRAND.shell, darkToken("sidebar"));
});
