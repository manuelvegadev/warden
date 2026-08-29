# Beacon

Warden's web panel (Next.js 16, App Router, Tailwind 4, shadcn/ui, Better Auth). Talks to `wardend` through the BFF proxy `/api/wardend/*` (see `../docs/security.md`, ADR-008/009).

```bash
cp .env.example .env.local        # BETTER_AUTH_SECRET=$(openssl rand -base64 32), WARDEND_PANEL_KEY=$(openssl rand -hex 32)
pnpm install
pnpm auth:migrate                 # creates data/beacon.db (re-run when adding Better Auth plugins)
pnpm dev                          # http://localhost:3000 → the first registered user is admin
```

Check: `curl localhost:3000/api/auth/ok` → `{"ok":true}`; JWKS at `/api/auth/jwks`.

## Deployment with Dokploy
1. Application → **Dockerfile**, *Build path* `beacon/`.
2. Volume: `/data` (SQLite).
3. Env: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=https://beacon.example.com`, `WARDEND_URL` (internal), `WARDEND_PANEL_KEY`; build arg `NEXT_PUBLIC_WARDEND_WS_URL=wss://wardend.example.com`.
4. On wardend: `WARDEND_PANEL_JWKS_URL=https://beacon.example.com/api/auth/jwks`, `WARDEND_PANEL_ISSUER=https://beacon.example.com`, `WARDEND_PANEL_KEY`, `WARDEND_ALLOWED_ORIGINS=https://beacon.example.com`.
