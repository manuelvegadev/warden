# Beacon

Warden's web panel (Next.js 16, App Router, Tailwind 4, shadcn/ui, Better Auth). Talks to `wardend` through the BFF proxy `/api/wardend/*` (see `../docs/security.md`, ADR-008/009).

```bash
cp .env.example .env.local        # BETTER_AUTH_SECRET=$(openssl rand -base64 32), WARDEND_PANEL_KEY=$(openssl rand -hex 32)
pnpm install
pnpm auth:migrate                 # creates data/beacon.db (re-run when adding Better Auth plugins)
pnpm dev                          # http://localhost:3000 → the first registered user is admin
```

Check: `curl localhost:3000/api/auth/ok` → `{"ok":true}`; JWKS at `/api/auth/jwks`.

## Deployment
See [`docs/deploy.md`](../docs/deploy.md) (Dokploy for Beacon, systemd + TLS for wardend) and [`.env.example`](.env.example) for every variable.
