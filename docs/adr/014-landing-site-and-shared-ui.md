# ADR-014: Static landing site on GitHub Pages and a shared UI package

**Status**: accepted (2026-08-29).

## Context
The project needed a public page that explains Warden and shows the panel with realistic examples,
in Beacon's own look. Beacon's shadcn components lived inside `beacon/`, so a second Next.js app
could only copy them. The site must be free to host, static, and reachable under a custom domain.

## Decision
- The repository becomes a **pnpm workspace** (`pnpm-workspace.yaml`, one root lockfile) with
  three JavaScript packages: `beacon/`, `landing/` and `packages/ui`.
- **`@warden/ui`** (`packages/ui`) holds the shadcn/ui components (style `base-nova`, Base UI
  primitives), `cn()`, the `use-mobile` hook and the design tokens (`styles/theme.css`). It is
  consumed as TypeScript source: apps list it in `transpilePackages` and add
  `@source "../../packages/ui/src"` to their Tailwind CSS. The shadcn CLI runs inside the package
  (`packages/ui/components.json`). The shared badge palettes (`badge-tone.ts`) and the
  `font-console` utility live there too. Only the primitives moved; Beacon's feature components
  (console, plugins, players…) stay in `beacon/` because they depend on the daemon API and socket.
- **`landing/`** is an **Astro** site (static output) using React only as islands: the shared
  `@warden/ui` components render to HTML at build time and just two islands hydrate (the hero demo,
  the install tabs). Next.js was tried first and rejected as overkill for a static page — it hydrated
  every section (~820 KB of JS vs ~300 KB with Astro). Same Tailwind 4 tokens, dark-only, fonts
  self-hosted via fontsource. The hero is a simulated Beacon (`src/components/demo/*`, dummy data
  and timers, no daemon). `public/CNAME` pins the custom domain; `public/install.sh` is the
  one-line installer.
- **Deployment**: `.github/workflows/pages.yml` builds `landing/dist` and publishes it with
  `actions/deploy-pages` on every push to `main` that touches `landing/` or `packages/ui/`.
- Because Beacon now depends on a sibling package, its image is built from the **repository root**
  (`docker build -f beacon/Dockerfile .`); `release.yml`, `ci.yml`, `deploy/compose.yaml` and the
  Dokploy instructions were updated accordingly. `outputFileTracingRoot` points at the root so the
  standalone output keeps working.

## Consequences
- One place to add or update shadcn components; both apps stay visually identical by construction.
- `pnpm install` runs at the root, as do `pnpm lint` (one Biome config, packages extend it),
  `pnpm typecheck` and `pnpm build`; per-app scripts via `pnpm --filter <name> <script>`.
- The landing's demo is a deliberate simulation: when Beacon's UI changes, the demo must follow
  by hand (it mirrors the instance page layout, not its code).
- Dokploy "Dockerfile" builds must use build path `.` and Dockerfile `beacon/Dockerfile`; image
  deployments (`ghcr.io/manuelvegadev/warden-beacon`) are unaffected.
