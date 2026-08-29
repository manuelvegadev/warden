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

## Phase 1.5 — Hardening ✅
- [x] Tests for instance supervisor (fake `java` script), quiet TPS polling, ws hub (local Ed25519 JWKS) and player store
- [x] Managed Java runtimes: Temurin via Adoptium into `<data>/java`, auto-selection by MC version, Settings → Java (ADR-010)
- [x] Host network rates (interface counters) and TPS via quiet `tps` polling every ~16 s (reply hidden from the console)
- [x] Metrics tab (CPU, memory, TPS, network — 1 h, time axis, persisted in SQLite); Players tab with play time, sessions and recent activity
- [x] Settings tab: name, memory, JVM preset/custom flags, Java runtime, restart policy, autostart, stop timeout

## Phase 2 — Configuration and plugins
- [x] `server.properties` schema-driven editor (validation, restart hints); whitelist/ops/bans via live commands or JSON files, UUIDs from usercache/Mojang/offline
- [ ] Confined file editor (Paper YAML configs)
- [x] `catalog/hangar` + `catalog/modrinth` search/versions; install with hash verification
- [ ] Plugin management: update/toggle/upload/delete; read `plugin.yml` from jars
- [ ] Paper build/version upgrade with prior backup
- [x] Panel: config screens; plugins table (icon, version, source, install date) + Prism-style install dialog (search, queue, per-plugin version, batch install)

## Phase 3 — Players
- [ ] Sessions (join/leave) in SQLite, RCON `list`, ping
- [ ] Advancements and statistics from `world/advancements` and `world/stats`
- [ ] Messages, kick, ban, op from the player card

## Phase 4 — Operations
- [ ] Backups (save-off/save-all/tar.zst) and cron scheduler
- [ ] TLS built into the daemon; optional daemon Dockerfile
- [ ] Multi-node in the panel (several daemons)
- [ ] Other providers: Purpur, Fabric, Vanilla
