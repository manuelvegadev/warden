# Landing

Warden's marketing site (https://warden.manuelvega.dev): Astro (static output) with React islands
for the shared shadcn components (`@warden/ui`) and the same Tailwind 4 tokens as Beacon. Only the hero
demo and the install tabs hydrate (`client:visible`); every other section ships as HTML. Everything the
hero shows is simulated client-side (`src/components/demo/*`) — no daemon involved. `public/install.sh`
is the one-line installer served at `/install.sh`.

```bash
pnpm install           # at the repo root (workspace)
pnpm --filter landing dev     # http://localhost:3100
pnpm --filter landing build   # static site in landing/dist
pnpm --filter landing preview # serve landing/dist on http://localhost:3101
```

Deployed to GitHub Pages by `.github/workflows/pages.yml` on every push to `main` that touches
`landing/` or `packages/ui/`; `public/CNAME` sets the custom domain (see `docs/deploy.md`).
