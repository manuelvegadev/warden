# Roadmap

## Phase 0 — Design ✅
- [x] Research on alternatives and APIs (Fill v3, Hangar, Modrinth verified)
- [x] ADRs 001–007
- [x] REST + WS API specification (`docs/api.md`)
- [x] Skeleton: `wardend/` (Go, compiles, log parser with tests) and `beacon/` (Next.js + Dockerfile)
- [x] Security and auth model (`docs/security.md`, ADR-008); name proposals (`docs/naming.md`)
- [x] Name: Warden / `wardend`; Better Auth (ADR-009)

## Phase 1 — Daemon MVP
- [ ] `internal/store`: SQLite + migrations (metrics, players, events; no longer users)
- [x] `internal/auth`: JWT verification via Beacon's JWKS + `X-Panel-Key` + roles (ADR-009)
- [x] Beacon: Better Auth (email+password, admin, jwt EdDSA), login, protected layout, BFF proxy `/api/wardend`
- [ ] `internal/catalog/paper`: Fill v3 (versions, builds, download with sha256)
- [ ] `internal/tasks`: `install` task (jar + eula + server.properties + local rcon)
- [ ] `internal/instance`: `java` process via `os/exec`, console ring buffer, staged stop, restart policy
- [ ] `internal/ws`: hub, console/state/events streams
- [ ] `internal/metrics`: gopsutil every 2 s, persistence and `/metrics` endpoint
- [ ] Panel: login, instance list, creation wizard, console (xterm.js), resource cards

## Phase 2 — Configuration and plugins
- [ ] `server.properties` schema; whitelist/ops/bans; confined file editor
- [ ] `catalog/hangar` + `catalog/modrinth`; install/update/toggle plugins; read `plugin.yml` from jars
- [ ] Paper build/version upgrade with prior backup
- [ ] Panel: config screens and plugin browser

## Phase 3 — Players
- [ ] Sessions (join/leave) in SQLite, RCON `list`, ping
- [ ] Advancements and statistics from `world/advancements` and `world/stats`
- [ ] Messages, kick, ban, op from the player card

## Phase 4 — Operations
- [ ] Backups (save-off/save-all/tar.zst) and cron scheduler
- [ ] TLS built into the daemon; optional daemon Dockerfile
- [ ] Multi-node in the panel (several daemons)
- [ ] Other providers: Purpur, Fabric, Vanilla
