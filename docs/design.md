# Design conventions (Beacon)

## Typography
| Use | Font | Notes |
|---|---|---|
| UI text | Geist Sans | `--font-geist-sans`, loaded with `next/font/google` |
| Generic monospace (badges, paths) | Geist Mono | `--font-geist-mono` |
| **Console, log viewer, code** | **Google Sans Code** (public release of Google Sans Mono — the maintainer's preferred code font) | `--font-console`, **line-height 1.1** (`--console-line-height`) |

Rules:
- Any terminal-like or code surface (xterm console, log viewer, future file editor) must use `--font-console` and `--console-line-height`. Never hard-code a font family in a component; read the tokens from `beacon/app/globals.css`.
- Fonts are self-hosted through `next/font` (no runtime requests to Google Fonts).
- If a licensed Google Sans Mono file is added later, load it with `next/font/local` and point `--font-console` at it; components need no changes.

## Theme
- Dark theme by default (`<html class="dark">`), shadcn/ui tokens (`bg-background`, `text-muted-foreground`, …).
- Console background `#0a0a0a`; log levels: WARN amber, ERROR/FATAL red, STDIN cyan, SYSTEM magenta, DEBUG grey.
- State badges: running emerald, starting/stopping amber, crashed red, installing sky, stopped muted.

## Brand
Two marks, drawn on the lucide grid so they sit next to the UI icons without looking imported:
24 px viewBox, **1.5 px** round strokes (lucide's light weight), no fills, `currentColor`.
React components in `packages/ui/src/components/brand.tsx` (`WardenMark`, `BeaconMark`); SVG
masters and the app-icon tiles in `packages/ui/brand/`.

| Mark | Drawing | Where |
|---|---|---|
| **Warden** | The faceless guardian: a near-square head (10 × 10), horns leaving the sides at mid-height and rising diagonally with a short tip, an outlined mouth slot. No eyes — the mob has none. | Project/daemon: landing nav and favicon, README, release assets. |
| **Beacon** | The isometric block with its glowing core drawn *behind* the edges. | Panel: sidebar header, login card, favicon, PWA icons; landing demo. |

Palette **"Deep dark"** — Tailwind/shadcn steps closest to Mojang's textures (the deep dark's stone
for the guardian, the sculk/beacon light for the core). One CSS token, `--brand-core` (`cyan-600`
`#0891b2` light / `cyan-400` `#22d3ee` dark, Tailwind `brand-core`), colours the Beacon core, the
landing's glows and rings and any "light" accent — never text. In the UI the marks themselves use
`currentColor` like any lucide icon. Assets that cannot read CSS (tiles, favicons, the manifest) take
their hex from `packages/ui/src/lib/brand.ts`: tile `slate-900`, mark on tile `slate-300`, theme
colour `#252525` (Beacon's dark background).

Rules:
- Any terminal-like or code surface (xterm console, log viewer, future file editor) must use `--font-console` and `--console-line-height`. Never hard-code a font family in a component; read the tokens from `beacon/app/globals.css`.
- Fonts are self-hosted through `next/font` (no runtime requests to Google Fonts).
- If a licensed Google Sans Mono file is added later, load it with `next/font/local` and point `--font-console` at it; components need no changes.

## Theme
- Dark theme by default (`<html class="dark">`), shadcn/ui tokens (`bg-background`, `text-muted-foreground`, …).
- Console background `#0a0a0a`; log levels: WARN amber, ERROR/FATAL red, STDIN cyan, SYSTEM magenta, DEBUG grey.
- State badges: running emerald, starting/stopping amber, crashed red, installing sky, stopped muted.

## Brand
Two marks, drawn on the lucide grid so they sit next to the UI icons without looking imported:
24 px viewBox, **1.5 px** round strokes (lucide's light weight), no fills, `currentColor`.
React components in `packages/ui/src/components/brand.tsx` (`WardenMark`, `BeaconMark`); SVG
masters and the app-icon tiles in `packages/ui/brand/`.

| Mark | Drawing | Where |
|---|---|---|
| **Warden** | The faceless guardian: a near-square head (10 × 10), horns leaving the sides at mid-height and rising diagonally with a short tip, an outlined mouth slot. No eyes — the mob has none. | Project/daemon: landing nav and favicon, README, release assets. |
| **Beacon** | The isometric block with its glowing core drawn *behind* the edges. | Panel: sidebar header, login card, favicon, PWA icons; landing demo. |

Palette **"Deep dark"** — Tailwind/shadcn steps closest to Mojang's textures (the deep dark's stone
for the guardian, the sculk/beacon light for the core), exposed as tokens in
`packages/ui/src/styles/theme.css` and as Tailwind colours `brand-mark`, `brand-core`, `brand-tile`:

| Token | Light | Dark | Use |
|---|---|---|---|
| `--brand-mark` | `slate-700` `#334155` | `slate-300` `#cbd5e1` | Mark strokes when shown in brand colour (marketing). In the UI the marks use `currentColor` like any lucide icon. |
| `--brand-core` | `cyan-600` `#0891b2` | `cyan-400` `#22d3ee` | The Beacon core, the landing's glows and rings, any "light" accent. Never as text colour. |
| `--brand-tile` | `slate-900` `#0f172a` | same | Ground of app icons and the PWA tile. |

Rules:
- From 20 px up the Beacon core keeps `--brand-core`; at 16 px (favicon, tabs) use `BeaconMark mono`
  or the `beacon-mono.svg` master — a coloured 1.5 px line blurs at that size.
- Do not recolour the marks with the semantic palette (emerald/amber/red are for state badges).
- All SVG/PNG assets (masters, tiles at ~90 % / maskable at ~75 % inside Android's safe circle,
  both favicons, PWA icons) are generated by `pnpm --filter @warden/ui brand:build` from
  `packages/ui/src/lib/brand.ts` — edit the paths there, never the files in `packages/ui/brand/`.

## PWA (Beacon)
`app/manifest.ts`, `public/sw.js` (registered from `app/layout.tsx` in production) and the Apple
web-app metadata make Beacon installable; the worker caches nothing on purpose (live server state).
`proxy.ts` treats any path with a file extension as public, which covers the manifest, the worker and
the icons. Chrome/Android show the install prompt; iOS never prompts — Share → Add to Home Screen.
