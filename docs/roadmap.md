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

## Phase 6 — Live world view (ADR-018)
- [x] Phase 1 (in progress, not yet verified against a real server): Warden Agent plugin (`agent/`, positions at 5 Hz, chunk snapshots encoded to the WCK1 format, dirty tracking), wardend agent listener + SQLite chunk cache + `map` API + `world.*` bus messages + embedded jar install, Beacon "Live view" section (three.js, worker mesher with ambient occlusion, water, skinned players with name tags, follow, pop-out)
- [x] Sky: day/night lighting and biome sky colour with sunrise glow and weather, the in-game clock overlay, the game's star field (same seed), sun and moon phases from the game's textures, and the cloud map as a drifting 3D layer
- [x] Camera modes: orbit (SketchUp-style, the point under the cursor is the pivot for turning, dragging and zooming), fly (the game's spectator controls: WASD, Space/Shift, Ctrl, mouse look with pointer lock) and first person (through the selected player's eyes, at the game's eye height with a wide FOV); a debug toggle shows the orbit pivot
- [x] Name tags as an HTML layer over the canvas in the game's style, at a constant size, over the head or clamped to the nearest edge when the player is out of view (click goes there); sky, fog and light ease over ~1 s across biome borders, weather and time jumps; overlays on the shared shadcn components, all inside the scene's frame (the players top left, the camera select top centre, the clock and a settings dialog with Camera, Audio and Video tabs top right, voice bottom left); the render distance is capped at the server's view distance
- [x] The agent is part of the product: installed by wardend on every Paper-family instance (on create, on daemon start, before each server start), listed as a required, managed plugin the panel cannot disable or remove; no live view switch. The agent reconciles its chunks against the daemon's cache as soon as it connects
- [x] Waiting screen as its own three.js scene (the hand-over both ways is paced by the game's beacon sounds: `block.beacon.activate` as the block burns to white, `block.beacon.deactivate` as the world flashes back to the waiting room when the last player leaves; each transition lasts exactly the sound): the Beacon mark as a glass block with a glowing cyan core in the corner of a dark room, the core lighting the room and the frame throwing soft shadows on the walls (variance shadow maps, a studio environment for the glass's reflections), turning slowly, drag to turn it; the world's controls hide meanwhile. When the first player arrives the block spins up and burns to white, and the world fades in under it (skipped with reduced motion). The section fills the page
- [x] Player animation from the agent's pose flags: idle, walk, run, sneak, jump, swim, creative flight, gliding
- [x] The game's art fetched at install (`scripts/mc-assets.mjs`: client jar textures and block models, Bedrock samples' entity geometries and animations) and served to signed-in users; the player drawn from the pack's humanoid geometry as one skinned mesh, with the pack's walk, sneak, swim and idle animations (done 2026-09-03)
- [ ] Phase 2: greedy meshing, ~~orthographic top-down camera~~ (done 2026-09-03 as the Map mode: north up, lit by the day cycle like the rest, no clouds, a vanilla map's relief shading so tree tops stand out of the grass; alongside an Isometric mode locked over the followed player from a 45° tilt), Nether/End (surface rule under the bedrock roof, dimension-aware sky and light, real biome sky/fog colours from the client data; the world switcher is hidden until then and the view is pinned to the overworld)
- [ ] Phase 3: full columns with a Y-level slider, marker layers
- [ ] Phase 4: event and telemetry overlays from the agent
- [ ] Phase 5 (optional): offline import of unvisited chunks from region files

## Phase 7 — Voice chat (ADR-019)
- [x] Phase 1 (verified 2026-09-03 against a real Paper 26.2 server with Simple Voice Chat 2.6.21: a player heard from the panel, the in-game notice shown): the Warden Agent as a Simple Voice Chat addon (`softdepend`, `VoiceBridge`, `voice.info`, mic frames as loopback kind-2 frames gated by `voice.listen`), `internal/voice` service with the `/instances/{id}/voice` WebSocket (binary, drop-oldest), `voice.listen`/`voice.speak` roles, `voice.status` on the hub, `voice.*` audit events, `notify` policy with the in-game action bar (chat line and note at start/end), Beacon receiver playing flat (WebCodecs Opus; Safari 26+ / Chrome 94+ by feature detection)
- [x] Phase 2 (2026-09-03): 3D in the viewer — one `PannerNode` (HRTF) per speaker placed on its avatar's head every rendered frame through the scene's `onFrame` hook, listener on the camera in every mode (player / fly / orbit), linear falloff at the server's voice and whisper distances from `voice.status`, speakers whose avatar is not in the shown world parked out of earshot, group audio dropped, speaking name tags. Two renderers behind one interface: Resonance Audio by default (3rd-order ambisonics, SADIE KU100 HRTFs, a room with early reflections and reverb that travels with the camera; presets outdoors / room / hall / none) with the browser's `PannerNode` as the fallback and as a choice; a pseudo-elevation filter (2–10 kHz, ±6 dB, JASA 2019) on by default. Consent icons wait for phase 3, which brings the consent data
- [ ] Phase 3 (built 2026-09-03, not yet verified against a real server): speak from Beacon — consent icons on name tags, kind-3 frames, `onBinary` dispatcher, static / locational / entity channels with consent filter and the `beacon` volume category, Discord-style join / mute / deafen / leave with push-to-talk or open mic, target per camera mode (the camera in fly and orbit, the followed player, everyone), source marker and radius sphere, `ask` policy with the Paper dialog and `/warden voice allow|deny|status`
- [ ] Phase 4: effects presets before encoding (clean, conscience, divine, PA) with the bitrate switch and a local monitor
- [ ] Later: `PlayerAudioListener` mode, WebRTC if WebSocket jitter proves unacceptable, SVC server settings from the instance settings

## Backlog (optional, unscheduled)
- [ ] Server-list appearance follow-ups, from the cleanup pass over the MOTD/icon work. None block anything; each was judged not worth its blast radius at the time:
  - `hasIcon` on the instance detail (or properties) response. Beacon currently learns whether an instance has an icon by requesting `GET /instances/{id}/icon` and treating the 404 as "no" — a guaranteed 404 in the network panel for the common case. The daemon knows it for free; this is an API contract change, so it wants its own commit.
  - Serve the icon with `ETag`/`Last-Modified` (`http.ServeContent`) and `Cache-Control: no-cache` instead of `no-store`, so a revalidation costs a 304 rather than a full body. The `?v=` cache-buster already keeps it fresh, so this is about bytes, not correctness.
  - An element-scoped drag-and-drop hook. `hooks/use-file-drag.ts` is window-level; the import dialog and the icon panel each hand-roll the element-scoped version, so there are now two copies waiting for a third.
  - Fold "drop the trailing .0" into `formatBytes` (`lib/api.ts`) so `lib/server-budget.ts` can drop its local `gb()`. Four size formatters exist; they differ only in whether prose wants `2 GB` or `2.0 GB`.
  - Reuse `SectionCard`'s heading markup for the section headings that are written by hand (Identity, Advanced). Heading typography lives in three places today, and the pre-existing "Advanced" heading has the same problem.
  - `MotdDialog`'s Apply writes the icon to the daemon immediately while the message only enters the Properties draft, so a later Discard reverts half of what the dialog did. Deliberate — the icon is not a property — and stated in the dialog footer, but it is a seam worth revisiting if the split ever confuses anyone.
- [ ] Plugin scanning before load. Plugins run inside the server JVM with the daemon's privileges, so the only defence is pre-load. Layers, all optional: (1) built-in static heuristics on the jar/zip — native libs or nested jars, `Runtime.exec`/`ProcessBuilder`/`defineClass`/`javax.script`/`Unsafe` references, Base64+reflection droppers, known indicators (e.g. Fractureiser), heavy obfuscation — reported as warnings, never as a verdict; (2) ClamAV via `clamd` socket when configured (`WARDEN_CLAMAV_SOCKET`), blocking on positives; (3) VirusTotal hash lookup with an API key (no file upload). Flow: quarantine (`plugins/.quarantine`) → scan → `scan:{status,findings}` in the manifest → badge in the panel; `malicious` blocked, `warnings` need an explicit admin override. See docs/security.md.
