# Beacon

Panel web de Warden (Next.js 16, App Router, Tailwind 4, shadcn/ui, Better Auth). Habla con `wardend` a través del proxy BFF `/api/wardend/*` (ver `../docs/security.md`, ADR-008/009).

```bash
cp .env.example .env.local        # BETTER_AUTH_SECRET=$(openssl rand -base64 32), WARDEND_PANEL_KEY=$(openssl rand -hex 32)
pnpm install
pnpm auth:migrate                 # crea data/beacon.db (re-ejecutar al añadir plugins de Better Auth)
pnpm dev                          # http://localhost:3000 → el primer usuario registrado es admin
```

Comprobación: `curl localhost:3000/api/auth/ok` → `{"ok":true}`; JWKS en `/api/auth/jwks`.

## Despliegue con Dokploy
1. Aplicación → **Dockerfile**, *Build path* `beacon/`.
2. Volumen: `/data` (SQLite).
3. Env: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=https://panel.tudominio.com`, `WARDEND_URL` (interna), `WARDEND_PANEL_KEY`; build arg `NEXT_PUBLIC_WARDEND_WS_URL=wss://wardend.tudominio.com`.
4. En wardend: `WARDEND_PANEL_JWKS_URL=https://panel.tudominio.com/api/auth/jwks`, `WARDEND_PANEL_ISSUER=https://panel.tudominio.com`, `WARDEND_PANEL_KEY`, `WARDEND_ALLOWED_ORIGINS=https://panel.tudominio.com`.
