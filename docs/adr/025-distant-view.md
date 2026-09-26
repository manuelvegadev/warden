# ADR-025: Distant view — Distant Horizons Support and Voxy Server Side

Date: 2026-09-25 · Status: accepted · Phase 8.4 of docs/roadmap.md (panel UX plan 4.4) ·
Touches ADR-022/023 (installs), the backups in docs/api.md, and reuses the console of ADR-024.

## Context

Two server-side plugins let players see terrain far beyond the view distance, each for its own
client mod. Neither is easy to run well from a panel today: which client versions can connect is
not visible anywhere, their data can be as large as the world and goes into every backup, and
Distant Horizons Support's pre-generation is a console command whose progress nobody sees.

What they are, as of 2026-09-25 (sources at the end):

| | Distant Horizons Support (DHS) | Voxy Server Side (VSS) / LOD Server Support (LSS) |
|---|---|---|
| Client mod | Distant Horizons | Voxy plus the LSS/VSS client mod |
| Latest | 0.14.0 (2026-07), Modrinth `distant-horizons-support`, Hangar; hashes on both | VSS 0.14.0 (2026-08), Modrinth `voxy-server-side`; LSS 0.15.1 (2026-09), Modrinth `lod-server-support`; hashes |
| Paper 26.x | Listed for 26.1–26.2; `folia-supported` | Per-line jars (26.2, 26.1.2, …); Folia experimental |
| Clients | Exact protocol match. 0.14.0 speaks 15: DH **3.1.x–3.2.0**. DH **3.3.x** (protocol 16, since 2026-09-17) cannot connect — the upstream MR is open. The player sees "Server is outdated"; the server logs nothing | Compatible both ways from 0.4.0 |
| Commands | `/dhs` (`distant_horizons.admin`): `status`, `reload`, `worlds`, `pregen start [world] [x z] [radiusChunks] [force]`, `pregen stop|status [world]`, `pause`/`unpause`, `trim`, `config get|set|unset` (memory only) | `/vsslod` (`vss.admin`; LSS: `/lsslod`, `lss.admin`): `stats`, `diag`, `store status`, `store invalidate all`, `set <key> <value>` (live and saved) |
| Pre-generation | `pregen`; progress only when `pregen status` is asked; nothing survives a restart | **None on Paper** (backfill is Fabric/NeoForge only): LODs are built as players move |
| Configuration | `plugins/DHSupport/config.yml`, re-read by `/dhs reload` (`database_path`, `scheduler_threads`, `lod_refresh_interval` need a restart) | `plugins/VoxyServerSide/vss-server-config.json` (LSS: `lss-…`); twelve keys live through `set`, the rest on restart |
| Data | One SQLite, `plugins/DHSupport/data.sqlite`, rollback journal | `<world>/vss-lod/store.db`, SQLite in WAL mode; roughly doubles the world |
| API | Internal classes only, "unstable" | None |

Both stores are **derived data**: deleting them is safe, and they are rebuilt. VSS is LSS rebuilt
under another name (same jar, same protocol; only plugin, command, permission, folder and file
names differ). They can run side by side, each paying for its own generation and storage.

Known caveat: DHS 0.14.0 unloads the chunks it generates without saving them and Paper still
saves their entities, so mobs duplicate (upstream issue #51; fixed on `develop`, unreleased).

## Decision

### The daemon drives both through their public surface

`wardend/internal/lod`, one provider per family, behind one interface: detect from the installed
jars by descriptor name (confirmed on the server: `DHSupport` for DHS 0.14.0, `VoxyServerSide` for
VSS 0.14.0; LOD Server Support is `LodServerSupport` — VSS and LSS are one provider with two
brands), a compatibility table, the data paths, a schema of the main configuration keys, reading
and writing the configuration file (YAML for DHS, JSON for VSS/LSS, keeping every other key and,
for YAML, the comments where possible), applying changes live, and pre-generation where it exists
(DHS only). Nothing uses the plugins' internal classes: their commands and files are their
stablest surface, and one mechanism serves both. When a command's output stops matching, the state
becomes `unknown` with the raw output, rather than an error.

**Commands run through the Warden Agent.** Warden's servers run with `enable-rcon: false` and the
daemon has no RCON client; writing to stdin, as the TPS poll does, would scatter a multi-line reply
among other output and write every 5-second poll into `latest.log`. So the agent protocol gains a
second request/response pair beside ADR-024's completion: `{"type":"run","id","command"}` is run on
the main thread with `Server#createCommandSender`, a sender that has the console's permissions and
hands its feedback to the agent instead of the console. The agent collects the reply until it has
been quiet for 200 ms (plugins may answer a tick later), at most 2 s from the start of the run; the
daemon itself waits up to 3 s for the answer. It is answered
`{"type":"run.result","id","lines":[…]}` (plain text, colour codes dropped) or `{"id","error"}` —
through the same correlation, timeout and "no agent" handling as `complete`. Nothing of it reaches
the console or the log: verified on the server, `latest.log` has zero `dhs pregen status` lines
across a pre-generation run polled every 5 s. An agent that does not announce `run` in `features`,
or no agent, makes the section show that live actions need the agent; files (configuration, disk,
data) still work.

- **Install** goes through the existing plugin install (ADR-022/023): Modrinth `voxy-server-side`
  (the name Voxy players look for) or `distant-horizons-support`, hash verified. An installed LSS is
  recognised and managed the same way.
- **Compatibility** is our table, per plugin version: DHS 0.14.x → DH 3.1.x–3.2.0, VSS/LSS ≥ 0.4 → any
  client from 0.4. A version the table does not know says "not verified" and links the plugin's page.
  While DHS does not support DH 3.3, a standing warning says so. The table is updated with Warden
  releases.

### API

- `instance.json` gains `lod: {backupIncludeData: bool, pregens: [{world, x?, z?, radius?, startedAt,
  session, resumedAt?}], pendingConfig?: {<kind>: {<key>: value}}}`. `session` is the server start
  a pre-generation was last (re)launched in (see the lifecycle below). `pendingConfig` holds
  VSS/LSS values saved while the server ran that the plugin would overwrite (see the config route).
- `GET /instances/{id}/lod` (viewer): per provider, whether it is installed (file, version, enabled,
  brand), the catalog project it installs from, compatibility and warning, disk use per path, and
  the pre-generations with their last progress; `supported: false` on software that does not load
  plugins. `worlds` and `pregens` are always arrays, never null. Installing uses the plugins
  endpoint as it is (`POST /instances/{id}/plugins` with that project), so there is no LOD install
  route.
- `PUT /instances/{id}/lod/settings {backupIncludeData}` (backups.write).
- A backup's sidecar lists what it left out (`excluded`), so the restore card can say that the LOD
  data will be rebuilt.
- `GET|PUT /instances/{id}/lod/{kind}/config` (config.write): the schema and values of the main keys.
  `PUT` rewrites only those keys and answers `{applied:[…], restart:[…]}`: while the server runs,
  what can apply live is applied (`/vsslod set …`, `/dhs reload`) and the rest waits for a restart.
  DHS's `config.yml` keeps its comments across a rewrite (verified); VSS/LSS's JSON comes back with
  sorted keys. VSS/LSS's `set` saves its whole in-memory configuration over the file (Gson, in
  `RuntimeSettings`), still holding the boot-time value of every restart-only key (`enabled`,
  `enableChunkGeneration`, `lodStore`, `lodStoreMaxMB`): a save mixing live and restart-only keys, or
  a later live save in the same server session, would silently undo a restart-only change. So a
  VSS/LSS value that did not apply live while the plugin runs is also recorded in
  `lod.pendingConfig`, shown by `GET` as the current value, written into the file again just before
  the next start (beside the agent's own refresh), and then forgotten. A save while the server is
  stopped writes the file directly, pending values included. DHS needs none of it: `/dhs reload`
  re-reads the file and its `config set` never writes it. Files are written atomically.
- `DELETE /instances/{id}/lod/{kind}/data` (files): deletes the store; `409` while the server runs
  (an open SQLite is not deleted under it).
- `POST /instances/{id}/lod/dhs/pregen {world, x?, z?, radius?}` and
  `DELETE /instances/{id}/lod/dhs/pregen/{world}` (settings.write): `/dhs pregen start|stop` through
  the agent, recorded in and removed from the manifest. DHS reads `pregen start`'s arguments
  positionally (`[world] [x z] [radius]`), so the API takes the centre and the radius (in chunks) as
  optional but rejects a radius without a centre and requires x and z together (400 otherwise);
  with neither, DHS pre-generates out to the world border. Spaces in world names are sent as `_`.
- Hub: `lod.pregen {world, state: running|resumed|done|stopped|unknown, progress, done, target, cps, elapsed?, remaining?, raw?}`
  (`raw`: a reply the daemon did not recognise).
- `GET /instances/{id}/lod` also says whether the connected agent runs commands (`agentRuns`); a
  pre-generation start that times out answers `504 timeout`, since it may have started anyway.

### Pre-generation lifecycle (DHS)

- While a pre-generation is recorded and the server runs, the daemon asks `dhs pregen status
  <world>` through the agent every 5 s, parses the reply and broadcasts `lod.pregen`.
- "Generation is complete." marks it `done`, forgets it and records an activity event.
- **Resumed after a restart:** a poll can find DHS reporting nothing running for a recorded
  pre-generation two ways: the server restarted since the pre-generation was last (re)launched, or
  it was stopped from the console within the same server session. Only the first is resumed —
  relaunched without `force` and marked `resumed` — because DHS skips positions that already have a
  LOD (`if (!force && lodRepository.lodExists(…)) continue;` in `PreGenerator`, 0.14.0), so it
  carries on where it was; its percentage starts again from 0 and runs quickly through what is done.
  The second case is forgotten and never relaunched. Both verified on the server.

### Backups

- LOD stores are **excluded from backups by default**: for each installed provider whose store lies
  under the backup's own paths, its whole store is left out and listed in the sidecar's `excluded`
  — the restore card reads that list. A store outside the backup's paths is left alone: a
  worlds-scope backup never carries `plugins/…`, because a restore replaces whole top-level
  folders, and carrying DHS's database in a worlds backup would have wiped `plugins/` on restore.
- The **"Include LOD data"** setting (`backupIncludeData`) copies a store's database instead, as a
  consistent snapshot: `VACUUM INTO` a temporary file, archived under the original path. Only the
  database file and its `-journal`/`-wal`/`-shm` are skipped from the walk for this; any other file
  under the store's directory is archived as it is. `excluded` then stays empty for that store — it
  lists only what is genuinely missing, never what a snapshot replaced. The snapshot has a cost:
  it reads the whole store, needs free space as large as it, and competes with the plugin's writes
  (on DHS's rollback-journal database `VACUUM INTO` holds a shared lock for the whole copy, and DHS
  waits at most 3 s for its own writes). So a snapshot that fails (a lock, a full disk) does not fail
  the backup — scheduled ones included: that store falls back to being left out and listed in
  `excluded`, a console line says so, and the other stores keep their snapshots. A raw copy of a SQLite file
  that the server is writing is not trusted, and the plugins' own pause is partial (DHS) or missing
  (VSS) — which is why the plan's "pause during backups" is not done.
- A restore replaces whole top-level folders, so restoring a backup without LOD data leaves no LOD
  data; it is rebuilt. The restore card says so when a LOD plugin is installed.
- `backup.Create` itself refuses an extra file (a snapshot) that falls outside the backup's paths,
  and progress counts the snapshot's bytes up front so it never exceeds 100%.

### Beacon

A section **Distant view** under Configuration, after Plugins, on software that loads plugins.

- Nothing installed: one card per plugin with the client mod players need, the compatibility (and
  the DH 3.3 warning), whether it pre-generates, and Install.
- Installed: one *Include LOD data in backups* switch for the instance, above the plugins, with the
  size of all the stores and the snapshot's cost; per plugin, compatibility, disk use with *Delete
  LOD data* (stopped only); for DHS, a row per world with progress (bar, done/target, CPS,
  time left, Stop) or *Pre-generate* (a dialog: centre, radius in chunks with its size in blocks);
  for VSS/LSS, the store status and a note that Voxy builds LODs as players move and that
  pre-generating the world itself (Chunky) makes that cheap.
- Settings: a form of the main keys with type, default, range and whether each applies live or on
  restart, and *Edit file* into the file manager for everything else. The keys:

  | DHS (`config.yml`; live through `/dhs reload` unless noted) | VSS/LSS (JSON; live through `set` unless noted) |
  |---|---|
  | `render_distance`, `distant_generation_enabled`, `generate_new_chunks`, `builder_type`, `full_data_request_concurrency_limit`, `real_time_updates_enabled`, `use_vanilla_world_border`; `scheduler_threads` (restart) | `lodDistanceChunks`, `mbPerSecondLimitPerPlayer`, `mbPerSecondLimitGlobal`, `generationConcurrencyLimitGlobal`, `generationConcurrencyLimitPerPlayer`, `farPlayers`; `enabled`, `enableChunkGeneration`, `lodStore`, `lodStoreMaxMB` (restart) |

  Each provider's schema is checked against the defaults of the version it was written for; a key
  the installed file lacks is shown with its default and written only when changed. Saving reports what applied
  and puts the rest into "Restart to apply".
- Progress arrives on the hub; `resumed` and `unknown` are shown as such. The section reloads when
  the server's state changes and when the agent connects or leaves (`world.agent`); while the
  server runs without an agent that runs commands, one line says that live actions apply after the
  next restart, and *Pre-generate* is disabled.

## Consequences

- Warden depends on the text of `/dhs pregen status` and `/vsslod store status`; a plugin update that
  changes them turns the state into `unknown` until our parser follows. Parsers are tested against
  the real output.
- The compatibility table goes stale between Warden releases; "not verified" and the link cover a
  version it does not know.
- Backups get much smaller on servers with a LOD plugin; restoring one rebuilds the LODs over time.
- DHS's entity duplication and the DH 3.3 gap are upstream; the panel shows them, it does not fix
  them.

## Sources (read 2026-09-25)

- DHS: https://gitlab.com/distant-horizons-team/distant-horizons-server-plugin (tag 0.14.0 and
  `develop`: `plugin.yml`, `config.yml`, `DhsCommand.java`, `PreGenerator.java`,
  `PluginMessageHandler.java`, `Database.java`; MRs !13, !15, !16; issues #11, #51, #52; wiki),
  https://modrinth.com/plugin/distant-horizons-support, https://hangar.papermc.io/Jckf/distant-horizons-support,
  https://gitlab.com/distant-horizons-team/distant-horizons-core (`ModInfo.PROTOCOL_VERSION` per tag).
- VSS/LSS: https://github.com/VoX/lod-server-support (README, `paper/build.gradle`, `plugin.yml`,
  `PaperCommands.java`, `docs/reference/settings.md`, `docs/compatibility.md`,
  `docs/planning/dh-support-coexistence-2026-08-05.md`), https://modrinth.com/plugin/voxy-server-side,
  https://modrinth.com/project/lKiXKLvv, https://modrinth.com/mod/voxy.
