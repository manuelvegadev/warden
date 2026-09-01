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
- [x] Confined file editor: allowlisted Bukkit/Paper/world/plugin config files with YAML/JSON validation
- [x] `catalog/hangar` + `catalog/modrinth` search/versions; install with hash verification
- [x] Plugin management: update/toggle/upload/delete; `plugin.yml`/`paper-plugin.yml` metadata; update check against the catalog
- [x] Paper build/version upgrade with prior backup (jar + configs + worlds to `<instance>/backups/`)
- [x] Panel: config screens; plugins table (icon, version, source, install date) + Prism-style install dialog (search, queue, per-plugin version, batch install)

## Phase 3 — Players
- [x] Sessions (join/leave) in SQLite; players known from world stats merged in
- [x] Advancements and statistics from `world/advancements` and `world/stats`
- [x] Messages, kick, ban, op/deop from the player card

## Phase 4 — Operations
- [x] Backups (save-off/save-all flush/tar.zst with sidecar), restore with pre-restore safety copy, download/delete, in-daemon scheduler with keep/max-size retention
- [x] TLS built into the daemon (files / ACME / self-signed), systemd unit + install script, optional daemon Dockerfile, deployment guide (`docs/deploy.md`)
- [ ] Multi-node in the panel (several daemons) — `node` table, per-node proxy and UI, `node` claim (ADR-017 §8)
- [x] Landing page (`landing/`, static export on GitHub Pages) and `@warden/ui` shared package (ADR-014)
- [x] Other providers: Purpur (api.purpurmc.org, md5), Fabric (meta.fabricmc.net launcher jar, loader = build), Vanilla (piston-meta, sha1); software picker in the panel, Plugins tab only for Paper/Purpur (ADR-013)

## Phase 5 — Users and access (ADR-017)
- [x] Members: `organization` plugin, default organization, migration of existing users, `caps` claim, Settings → Members
- [x] Invitations by copiable link (no mail server): `nodeId`/`instanceId`/`instanceRole` on the invitation, signup gated by a pending invitation, `/invite/{id}` page
- [x] Per-instance access: `instanceAccess` table, `acl`/`aclAll` claims, `Principal.Can()` in wardend, route reclassification, list filtering with 404s, WS `subscribe` check, role-aware UI
- [x] Immediate revocation: `POST /api/v1/sessions/revoke` on the daemon, called by Beacon when a grant, member or role changes

## Backlog (optional, unscheduled)
- [ ] Plugin scanning before load. Plugins run inside the server JVM with the daemon's privileges, so the only defence is pre-load. Layers, all optional: (1) built-in static heuristics on the jar/zip — native libs or nested jars, `Runtime.exec`/`ProcessBuilder`/`defineClass`/`javax.script`/`Unsafe` references, Base64+reflection droppers, known indicators (e.g. Fractureiser), heavy obfuscation — reported as warnings, never as a verdict; (2) ClamAV via `clamd` socket when configured (`WARDEN_CLAMAV_SOCKET`), blocking on positives; (3) VirusTotal hash lookup with an API key (no file upload). Flow: quarantine (`plugins/.quarantine`) → scan → `scan:{status,findings}` in the manifest → badge in the panel; `malicious` blocked, `warnings` need an explicit admin override. See docs/security.md.
