# @warden/ui

shadcn/ui components (style `base-nova`, Base UI primitives, neutral palette) and the design tokens
shared by [`beacon/`](../../beacon) and [`landing/`](../../landing). Consumed as TypeScript source:
Beacon lists it in `transpilePackages` (Astro/Vite needs nothing).

- `src/components/*` — one file per shadcn component (`@warden/ui/components/button`).
- `src/lib/utils.ts` — `cn()`; `src/lib/badge-tone.ts` — the tinted badge palettes (software, state, plugin status).
- `src/hooks/use-mobile.ts` — used by the sidebar.
- `src/styles/theme.css` — `@theme inline` + light/dark tokens, the `dark` variant, the base layer, the package `@source` and the `font-console` utility. Apps only need `@import "tailwindcss"; @import "shadcn/tailwind.css"; @import "@warden/ui/styles/theme.css";` plus their font variables.

Add components from this directory so the shadcn CLI writes here: `pnpm dlx shadcn@latest add <name>`.
