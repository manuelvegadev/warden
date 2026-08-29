# ADR-009: Better Auth in the panel; the daemon verifies JWTs via JWKS

Date: 2026-08-28 · Status: accepted · **Supersedes** point 1 of ADR-008 (users in the daemon) and the opaque WS tickets.

## Context
Better Auth (https://better-auth.com) is a TypeScript authentication framework for Next.js with `HttpOnly` cookie sessions, password hashing (scrypt), rate limiting, 2FA/passkeys, social OAuth (Discord, GitHub…), an `admin` plugin (roles, user bans), `organization`, `apiKey`, and a **`jwt`** plugin that exposes `/api/auth/token` and `/api/auth/jwks` (rotatable EdDSA/RS256 keys) so external services can verify tokens without calling the panel. It supports SQLite (`better-sqlite3`), Postgres and MySQL directly or via Drizzle/Prisma/Kysely.

Alternative: hand-write users, argon2id, sessions, rate limiting, 2FA… in Go (ADR-008).

## Decision
- **The panel is the identity authority** using Better Auth. Panel database: **SQLite on a Dokploy volume** (`/data/warden.db`) to start; migratable to Dokploy's Postgres by switching the adapter.
- Initial login via email+password; **Discord OAuth** as a second provider (natural for Minecraft communities) — optional, enabled via env.
- Plugins: `admin` (`admin`/`operator` roles), `jwt`, `apiKey` (tokens for scripts), `twoFactor` (later phase).
- **Daemon (`wardend`)**: has no users. Every request from the panel carries `Authorization: Bearer <JWT>` issued by Better Auth; the daemon verifies it **offline against the panel's JWKS** (`WARDEND_PANEL_JWKS_URL`, cached, refreshed on seeing an unknown `kid`), requires `iss` = panel URL, `aud = "wardend"`, `exp ≤ 15 min`, and reads `role` from the claims for authorization. Additionally `X-Panel-Key` as a second layer (shared secret) so that only *that* panel can talk to it.
- **WebSocket**: the browser asks the panel for `GET /api/auth/token` (Better Auth returns a short-lived JWT) and sends it as the **first message** to the daemon's WS. The daemon verifies it the same way as for REST, validates `Origin` and closes the connection if there is no auth within 5 s. The "no tokens in `localStorage`" rule is preserved: the JWT lives in memory only for as long as it takes to connect.
- The panel's BFF flow (route handlers forwarding to the daemon) is kept: the browser still makes no cross-origin REST calls.

## Rationale
- Saves us ~1,500 lines of delicate Go (auth is where mistakes happen most) and brings 2FA, OAuth and rate limiting for free.
- The daemon ends up **with no user state**, like Wings: adding a second host means installing `wardend` and pointing it at the panel's JWKS.
- JWKS verification is asymmetric: the daemon never holds a key capable of issuing tokens.

## Consequences
- The panel is no longer stateless: it needs a volume (SQLite) or Postgres. In Dokploy that is a one-line *mount*.
- Dependency on a young project (Better Auth 1.x): pin the version and read changelogs when updating.
- If the panel goes down, the daemon keeps running the servers but nobody can manage it until it comes back (same as Pterodactyl). Mitigation: local `wardend admin …` CLI over a Unix socket for emergencies.
- Variables: panel `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_URL`, `WARDEND_URL`, `WARDEND_PANEL_KEY`, `DISCORD_CLIENT_ID/SECRET`; daemon `WARDEND_PANEL_JWKS_URL`, `WARDEND_PANEL_ISSUER`, `WARDEND_PANEL_KEY`, `WARDEND_ALLOWED_ORIGINS`.
