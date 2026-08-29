# ADR-007: Separate web panel (Next.js in Docker via Dokploy) + Go daemon

Date: 2026-08-28 · Status: accepted, **amended by ADR-008** (auth via BFF, no JWT in the browser) · **Supersedes** the "UI embedded in the binary" part of ADR-002 and ADR-003.

## Context
The author wants to deploy the web panel with **Dokploy** (Docker) and have it connect to the Go daemon running on the Minecraft host. This separates the UI from the daemon, like Pterodactyl (Panel ↔ Wings), and opens the door to managing several hosts from a single panel.

## Decision
Two components, two directories in the monorepo:

| Component | Dir | Technology | Where it runs |
|---|---|---|---|
| **`wardend`** (daemon) | `wardend/` | Go, single binary, `systemd` | On the Ubuntu box where the Minecraft servers run (direct access to processes, disk, `/proc`). |
| **`panel`** | `beacon/` | **Next.js 16 (App Router) + React + TypeScript + Tailwind + shadcn/ui** | Docker container deployed by Dokploy (same host or another). |

### Why Next.js and not Astro
- The panel is an interactive real-time app (WebSocket, xterm console, charts): pure React territory. Astro shines on content sites; its "islands" would add friction with no benefit here.
- Next.js has `output: "standalone"` → small Docker image (~150 MB) and Dokploy detects it with no extra config (Nixpacks/Dockerfile).
- shadcn/ui is designed for Next.js.

### Panel ↔ daemon communication
- The **daemon is the auth authority**: users in its SQLite, issues JWTs (`POST /auth/login`). The panel has no database of its own in v1.
- The **browser talks directly to the daemon** (REST + WebSocket) using the JWT in `Authorization: Bearer`. Reasons: the console/metrics WebSocket does not proxy well through Next.js, and it avoids duplicating the API.
- The panel (Next server) only needs `NEXT_PUBLIC_WARDEND_URL` (e.g. `https://wardend.example.com`). Later: a list of daemons ("nodes") managed in the panel.
- The daemon serves **CORS** restricted to `WARDEND_ALLOWED_ORIGINS` (the panel's origin) and must be exposed over **HTTPS** (built-in TLS with its own certificate, or behind Caddy/Traefik — Dokploy already ships Traefik and can route to the daemon if they are on the same host).
- The daemon also keeps a **dev mode**: it serves a minimal diagnostic `index.html` at `/`, but the real UI is the panel.

### Deployment with Dokploy
- Multi-stage `beacon/Dockerfile` (`node:22-alpine`, `output: standalone`).
- Dokploy: *Dockerfile*-type application pointing at `beacon/` in the repo, domain with automatic TLS, `NEXT_PUBLIC_WARDEND_URL` variable.
- The daemon does **not** go in Docker by default (it needs `/proc`, Java, cgroups and access to the world disk); it is installed with `systemd`. An optional image with `pid: host` and volumes is nonetheless documented for those who want everything in containers.

## Consequences
- Two deployments instead of one (offset by Dokploy).
- CORS, HTTPS and JWT expiry must be handled carefully in the daemon.
- Multi-host is within reach: the panel can point at N daemons.
