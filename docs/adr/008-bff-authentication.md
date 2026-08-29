# ADR-008: Authentication — panel as BFF, daemon as authority, WS with ephemeral ticket

Date: 2026-08-28 · Status: accepted, **amended by ADR-009** (users in the panel with Better Auth; JWT verified via JWKS) · **Amends** ADR-007 (the browser no longer stores a JWT in `localStorage` or calls the daemon over REST).

## Decision
- Users and passwords live in the **daemon** (SQLite, argon2id). It issues 12-hour HS256 JWTs.
- The **Next.js panel acts as a BFF**: same-origin session cookie `HttpOnly; Secure; SameSite=Strict` with the daemon's JWT encrypted inside; its route handlers forward REST calls to the daemon. The browser does **not** make cross-origin REST calls.
- For real time, the browser opens the **WebSocket directly against the daemon** and authenticates with a **single-use ticket (30 s)** issued by the daemon at the panel's request, sent as the **first message**. The daemon validates `Origin`.
- The panel identifies itself to the daemon with `X-Panel-Key` (shared secret), required for login and tickets.
- TLS mandatory; daemon on localhost behind Traefik (Dokploy) or Caddy, or native TLS.
- `admin` / `operator` roles enforced in the daemon. Revocable API tokens for automation.

## Rationale
Follows OWASP/IETF guidance for SPAs (no tokens in JS), avoids cross-site cookies (broken in modern browsers), replicates Pterodactyl's proven pattern for the WS and keeps the panel database-free (future multi-node: the cookie stores one JWT per node).

## Consequences
- New variables: daemon `WARDEND_PANEL_KEY`, `WARDEND_ALLOWED_ORIGINS`; panel `PANEL_SESSION_SECRET`, `WARDEND_URL` (internal, server to server), `NEXT_PUBLIC_WARDEND_WS_URL` (public, for the WS).
- `panel/lib/api.ts` now calls the panel's own `/api/*`; `localStorage` is removed.
- Full details in `docs/security.md`.
