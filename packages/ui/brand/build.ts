/*
 * Generates every brand asset from src/lib/brand.ts: SVG masters, app-icon tiles, Beacon's favicon,
 * the landing favicon and the PWA PNGs (needs `rsvg-convert`: brew install librsvg).
 *   pnpm --filter @warden/ui brand:build
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BEACON_CORE_PATH, BEACON_PATHS, BRAND, WARDEN_PATHS } from "../src/lib/brand.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const STROKE = 'fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
const paths = (ds: readonly string[]) => ds.map((d) => `<path d="${d}"/>`).join("");
const warden = paths(WARDEN_PATHS);
const beacon = `<path d="${BEACON_CORE_PATH}" stroke="${BRAND.core}"/>${paths(BEACON_PATHS)}`;

/** Mark on the 24 grid, `currentColor` unless a colour is given. */
const mark = (body: string, color = "currentColor") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${STROKE} stroke="${color}">${body}</svg>\n`;
/** 512 px tile. The marks fill ~15 of the 24 units, so scale 19 ≈ 90 % of the tile (rounded icons)
 *  and 16 ≈ 75 % (maskable: inside Android's 80 % safe circle). */
const tile = (body: string, maskable: boolean) => {
  const scale = maskable ? 16 : 19;
  const off = (512 - 24 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${maskable ? 0 : 96}" fill="${BRAND.tile}"/><g transform="translate(${off} ${off}) scale(${scale})" ${STROKE} stroke="${BRAND.tileMark}">${body}</g></svg>\n`;
};

const out: Record<string, string> = {
  "packages/ui/brand/warden.svg": mark(warden),
  "packages/ui/brand/beacon.svg": mark(beacon),
  "packages/ui/brand/warden-tile.svg": tile(warden, false),
  "packages/ui/brand/warden-tile-maskable.svg": tile(warden, true),
  "packages/ui/brand/beacon-tile.svg": tile(beacon, false),
  "packages/ui/brand/beacon-tile-maskable.svg": tile(beacon, true),
  // Favicons: a coloured 1.5 px core blurs at 16 px, so Beacon's is monochrome.
  "beacon/app/icon.svg": mark(paths([BEACON_CORE_PATH, ...BEACON_PATHS]), BRAND.tileMark),
  "landing/public/favicon.svg": tile(warden, false),
};
for (const [file, svg] of Object.entries(out)) writeFileSync(join(root, file), svg);

const png = (svg: string, size: number, file: string) =>
  execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size), join(root, svg), "-o", join(root, file)]);
png("packages/ui/brand/beacon-tile.svg", 192, "beacon/public/icons/icon-192.png");
png("packages/ui/brand/beacon-tile.svg", 512, "beacon/public/icons/icon-512.png");
png("packages/ui/brand/beacon-tile-maskable.svg", 512, "beacon/public/icons/icon-512-maskable.png");
png("packages/ui/brand/beacon-tile.svg", 180, "beacon/app/apple-icon.png");
// biome-ignore lint/suspicious/noConsole: CLI output
console.log(`brand: ${Object.keys(out).length} SVGs + 4 PNGs written`);
