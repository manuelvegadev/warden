/*
 * Brand geometry and the few colours rasters need (docs/design.md → "Brand"). Single source for the
 * React marks (components/brand.tsx) and the generated SVG/PNG assets (packages/ui/brand/build.ts).
 * Paths sit on the lucide grid: 24 px viewBox, 1.5 px round strokes, no fills.
 */

/** Warden: the faceless guardian — near-square head, horns rising from the sides, a mouth slot. */
export const WARDEN_PATHS = [
  "M8.5 9h7A1.5 1.5 0 0 1 17 10.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 17.5v-7A1.5 1.5 0 0 1 8.5 9z",
  "M7 13l-2.5-1.5v-5H6",
  "M17 13l2.5-1.5v-5H18",
  "M10.25 13.75h3.5a.75.75 0 0 1 .75.75v1a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1-.75-.75v-1a.75.75 0 0 1 .75-.75z",
];

/** Beacon: the isometric block; the core is drawn first so it sits behind the edges. */
export const BEACON_CORE_PATH = "M12 7l3.5 2v4l-3.5 2-3.5-2V9z";
export const BEACON_PATHS = ["M12 3.5l6 3.5-6 3.5-6-3.5z", "M6 7v8l6 3.5 6-3.5V7", "M12 10.5v8"];

/** "Deep dark" palette as hex, for assets that cannot read CSS tokens (tiles, favicons, manifest). */
export const BRAND = {
  core: "#22d3ee", // cyan-400 = --brand-core (dark)
  tile: "#0f172a", // slate-900
  tileMark: "#cbd5e1", // slate-300
  /** Beacon's dark --background, used as the PWA theme colour. */
  theme: "#252525",
} as const;
