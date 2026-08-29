# Roadmap

## Phase 0 — Design ✅
- [x] Research on alternatives and APIs (Fill v3, Hangar, Modrinth verified)
- [x] ADRs 001–007
- [x] REST + WS API specification (`docs/api.md`)
- [x] Skeleton: `wardend/` (Go, compiles, log parser with tests) and `beacon/` (Next.js + Dockerfile)
- [x] Security and auth model (`docs/security.md`, ADR-008); name proposals (`docs/naming.md`)
- [x] Name: Warden / `wardend`; Better Auth (ADR-009)

## Phase 1 — Daemon MVP ✅ (verified end-to-end with a real Paper 1.21.8 server on 2026-08-28)
- [x] `internal/store`: SQLite (metrics, events tables; 7-day retention)
- [x] `internal/auth`: JWT verification via Beacon's JWKS + `X-Panel-Key` + roles (ADR-009)
- [x] Beacon: Better Auth (email+password, admin, jwt EdDSA), login, protected layout, BFF proxy `/api/wardend`
- [x] `internal/catalog/paper`: Fill v3 (versions, builds, download with sha256, 10-min cache)
- [x] `internal/tasks`: `install` task (jar + eula + server.properties; RCON left disabled, console via stdin)
- [x] `internal/instance`: `java` process via `os/exec`, console ring buffer, staged stop, restart policy with backoff, Aikar flags
- [x] `internal/ws`: hub (coder/websocket), first-message JWT auth, Origin check, console/state/events/metrics/task streams
- [x] `internal/metrics`: gopsutil every 2 s, in-memory 1 h ring + SQLite, `/metrics` endpoint
- [x] Beacon: instance list (live), creation dialog (Paper versions/builds), console (xterm.js) with command history, resource cards, controls

## Phase 1.5 — Hardening (before phase 2)
- [ ] Tests for instance supervisor (fake `java` script) and ws hub
- [x] Managed Java runtimes: Temurin via Adoptium into `<data>/java`, auto-selection by MC version, Settings → Java (ADR-010)
- [ ] Network I/O per instance (interface counters) and TPS via `tps` command parsing
- [ ] Metrics chart (1 h) in Beacon; players tab with join/leave history
- [ ] Edit instance settings (memory, flags, autostart, restart policy) from Beacon

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
