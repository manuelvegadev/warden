# Daemon API (`wardend`)

Version: v1 (draft 2026-08-28). Base: `http://<host>:8080/api/v1`. JSON in both directions.
The UI is served from `/` (embedded SPA); the WebSocket from `/api/v1/ws`.

## Conventions
- Auth: `POST /auth/login` returns the `warden_session` session cookie (HttpOnly, SameSite=Strict). `Authorization: Bearer <token>` is also accepted for API tokens created in Settings.
- Errors: `{"error":{"code":"instance_not_found","message":"..."}}` with HTTP 4xx/5xx.
- Instance IDs: slug `^[a-z0-9][a-z0-9-]{1,31}$`.
- Dates in ISO-8601 UTC. Sizes in bytes. CPU as % of one core (may exceed 100).
- Pagination: `?limit=&offset=` → `{"items":[],"total":N}`.
- Long-running operations (jar download, backup) return `202 {"task":{"id":"..."}}` and are tracked via WS (`task.progress`) or `GET /tasks/{id}`.

## Auth and system
| Method | Path | Description |
|---|---|---|
| POST | `/auth/login` | `{username,password}` → `{user}` + cookie |
| POST | `/auth/logout` | |
| GET | `/auth/me` | Current user |
| GET | `/system` | `{hostname, os, platform, kernel, cpuCores, cpuPercent, load:[1m,5m,15m], memTotal, memUsed, hostUptime (s), disk:{path,total,used}, daemonVersion, goVersion, startedAt}` (managed Java runtimes live under `/java`) |
| GET | `/system/metrics` | Global CPU/RAM/network snapshot |
| GET | `/tasks` | Most recent tasks first |
| GET | `/tasks/{id}` | Long-running task status `{id,type,status,progress,message,error}` |
| GET | `/settings` / PUT | Panel config (port, dataDir, User-Agent contact, Java paths, backups) |

## Java runtimes (ADR-010)
| Method | Path | Description |
|---|---|---|
| GET | `/java` | `{installed:[{id,vendor,major,version,path,managed,size,installedAt}], available:[{major,lts}]}` (Adoptium releases; `availableError` when unreachable) |
| GET | `/java/required?mc=26.2` | `{mcVersion, requiredMajor, runtime?}` — minimum Java major for that Minecraft version and the best installed runtime |
| POST | `/java` | `{"major":25}` → `202 {task}` (type `java.install`); downloads Temurin JRE into `<data>/java/temurin-<major>/` |
| DELETE | `/java/{id}` | Removes a managed runtime (`system` cannot be removed) |

Instance create/patch accept `javaRuntime` (`"auto"` or a runtime id) and `javaPath` (explicit binary, overrides).

## Catalog (external providers, cached)
| Method | Path | Description |
|---|---|---|
| GET | `/catalog/servers` | `[{"id":"paper","name":"Paper","plugins":true,"tpsCommand":true,"singleBuild":false},{"id":"purpur",…},{"id":"fabric",…},{"id":"vanilla",…}]` — providers with their traits |
| GET | `/catalog/servers/{provider}/versions?includePre=false` | `{"versions":["1.21.8","1.21.7",...],"latest":"1.21.8"}` |
| GET | `/catalog/servers/{provider}/versions/{mc}/builds?channel=STABLE` | `[{"id":60,"channel":"STABLE","time":"...","size":N,"hash":{"algo":"sha256","value":"..."},"name":"paper-1.21.8-60.jar","changes":["..."]}]`. Build ids: Paper/Purpur build numbers; Fabric = loader version encoded as `major*10^6+minor*10^3+patch` (`changes[0]` names it); Vanilla always `1`. `hash.algo` is empty when the upstream publishes no digest (Fabric). |
| GET | `/catalog/plugins/search?q=&source=hangar|modrinth|all&mc=1.21.8&limit=&offset=` | `{"hits":[{"source":"hangar","id":"ViaVersion","name":"ViaVersion","author":"kennytv","description":"...","iconUrl":"...","downloads":N,"categories":[],"url":"..."}],"total":N}`. `all` queries both sources concurrently and sorts by downloads. |
| GET | `/catalog/plugins/{source}/{id}` | Details |
| GET | `/catalog/plugins/{source}/{id}/versions?mc=1.21.8` | `[{"id":"...","name":"5.12.0","channel":"release","mcVersions":[],"fileName":"...","size":N,"hash":{"algo":"sha256","value":"..."},"dependencies":[{"name","required"}],"publishedAt":"..."}]` |

## Instances
| Method | Path | Description |
|---|---|---|
| GET | `/instances` | List with summarized state `[{id,name,software,mcVersion,build,state,players:{online,max},port,autostart,cpu,mem}]` |
| POST | `/instances` | Create. Body below. → `202` with `task` (downloads jar, writes base files). |
| POST | `/instances/import` | Create from an existing server directory. `multipart/form-data`, text fields **before** the file: `id`, `name`, `memoryMb`, `port`, `jvmFlagsPreset`, `javaRuntime`, `acceptEula`, optional `software` + `mcVersion` (+ `build`); then `file` as the **last** part (`.zip`, `.tar`, `.tar.gz`/`.tgz`, `.tar.zst`; up to 16 GiB, `413` beyond). → `202` with `task` `import`. Admin only. See *Import* below. |
| GET | `/system/update` | `{current, latest, publishedAt, url, available, canApply, error?}` — newest GitHub release vs the running daemon (cached 10 min) |
| POST | `/system/update` | Admin. `202` task `daemon.update`: downloads the release binary for this platform into `<data>/update/`, verifies it against `SHA256SUMS`, writes `<data>/update/tag`; `wardend-update.path` (root, installed by `wardend install`) then runs `wardend update-apply`, which re-verifies against GitHub, replaces `/usr/local/bin/wardend` and restarts the service. `409 up_to_date` / `not_supported` (no installer units, unsupported platform) / `task_running`. |
| GET | `/tasks?instance={id}` | The instance's tasks, newest first — how a page learns about a task that started before its WebSocket subscription |
| GET | `/instances/{id}` | Full manifest + state |
| PATCH | `/instances/{id}` | Change name, jvm, autostart, restartPolicy, javaPath, memory, ports (when stopped) |
| DELETE | `/instances/{id}?purge=false` | Stops and moves to trash (`purge=true` deletes) |
| POST | `/instances/{id}/start` | |
| POST | `/instances/{id}/stop?timeout=60` | Clean `stop` |
| POST | `/instances/{id}/restart` | |
| POST | `/instances/{id}/kill` | SIGKILL (confirmation in UI) |
| POST | `/instances/{id}/command` | `{"command":"say hola"}` → `204`. With `?rcon=true` → `{"response":"..."}` synchronous |
| GET | `/instances/{id}/console?lines=500` | Last lines of the ring buffer `[{ts,level,text}]`; falls back to the tail of `logs/latest.log` when the buffer is empty (daemon restart) |
| GET | `/instances/{id}/logs` | `[{name,size,modTime}]` — `latest.log` first, then rotated `*.log.gz` |
| GET | `/instances/{id}/logs/{file}?tail=500` | `{file, lines[]}` (max 5000; gz decompressed on the fly). `?download=1` streams the raw file with `Content-Disposition`. Without params: plain text. |
| GET | `/instances/{id}/events?kind=player.join,player.leave&limit=100` | Persisted server events, newest first `[{ts,kind,player,text}]` |
| GET | `/instances/{id}/metrics?range=1h` | Time series `[{ts,cpu,memRss,diskUsed,netRx,netTx,tps,players}]` from SQLite |
| POST | `/instances/{id}/install` | Retry/redo the install task (`{"AcceptEULA":true,"Properties":{}}`) → `202 {task}`. Instance must be stopped. |
| POST | `/instances/{id}/eula` | `{"accept":true}` → writes `eula.txt` |
| POST | `/instances/{id}/upgrade` | `{"mcVersion":"1.21.8","build":60}` → `202` task. Takes a backup first. |

Creation body:
```json
{
  "id": "survival",
  "name": "Survival 2026",
  "software": "paper",           // paper | purpur | fabric | vanilla
  "mcVersion": "1.21.8",
  "build": 60,                 // optional: latest STABLE
  "memoryMb": 4096,
  "jvmFlagsPreset": "aikar",   // aikar | basic | custom
  "jvmFlags": [],              // if custom
  "javaPath": null,            // null = autodetect
  "port": 25565,
  "autostart": true,
  "restartPolicy": "on-crash",
  "acceptEula": true,
  "properties": {"motd": "Hola", "max-players": "20"}
}
```

### Instance state (`state`)
`stopped | starting | running | stopping | crashed | installing`

## Instance configuration
| Method | Path | Description |
|---|---|---|
| GET | `/instances/{id}/properties` | `[{key,value,type:"bool|int|string|enum",default,enum:[],min,max,group,description,requiresRestart,managed,known}]` — schema in `internal/mc/properties_schema.go`; unknown keys returned as strings |
| GET/PUT | `/instances/{id}/properties/raw` | Whole file as `text/plain`. PUT validates every `key=value` line against the schema; edits made while running are re-applied after the server rewrites the file on stop. Admin only for PUT. |
| PUT | `/instances/{id}/properties` | `{"motd":"...", "max-players":"30"}` (only the keys sent). Response indicates `restartRequired` |
| GET/PUT | `/instances/{id}/whitelist` | `[{uuid,name}]`; PUT replaces and runs `whitelist reload` |
| POST/DELETE | `/instances/{id}/whitelist/{name}` | Resolves UUID via usercache/Mojang |
| GET | `/instances/{id}/ops` | `[{uuid,name,level}]` |
| POST/DELETE | `/instances/{id}/ops/{name}` | Runs `op`/`deop` if running; edits the JSON if stopped |
| GET | `/instances/{id}/bans` | `{players:[...], ips:[...]}` |
| POST | `/instances/{id}/bans` | `{"target":"Steve or 10.0.0.7","reason":"..."}` — the daemon decides between a player and an IP ban |
| DELETE | `/instances/{id}/bans/{target}` | `pardon` / `pardon-ip` |
| GET | `/instances/{id}/command` | `{java,javaError?,args[],cwd,shell}` — `shell` is the line quoted for a POSIX shell; the exact command `Start` would run from the current manifest (heap, JVM preset/flags, jar); `javaError` when no runtime can be resolved yet. |
| GET | `/instances/{id}/upgrade` | `{current:{mcVersion,build},latestBuild?:{mcVersion,build,channel,time,changes},latestVersion?:{…}}` — newer build of the same version and newest version with a build, from the software catalog. |
| POST | `/instances/{id}/upgrade` | `{"mcVersion":"1.21.8","build":0}` (both optional: current version / newest build) → `202` task `upgrade`. `409` unless stopped/crashed. The task takes a full-scope `pre-upgrade` backup (see Backups), downloads the build with sha256 verification, swaps the jar, updates the manifest (appending to `upgrades[]`: from/to version+build, backup file name, time) and resolves the Java runtime for the new version. Admin only. |
| GET | `/instances/{id}/files` | Editable files that exist: `[{path,group,size,modifiedAt}]`. Not a file browser — an allowlist: `bukkit.yml`, `spigot.yml`, `commands.yml`, `help.yml`, `permissions.yml` (Server); `config/paper-global.yml`, `config/paper-world-defaults.yml` (Paper); `<world>/paper-world.yml` (Worlds); text files under `plugins/<name>/` (Plugins: yml/yaml/json/properties/txt/toml/conf). `server.properties` has its own endpoint. |
| GET | `/instances/{id}/files/content?path=config/paper-global.yml` | `text/plain` (2 MB limit). `403` outside the allowlist or when a symlink escapes the server directory; `404` missing. |
| PUT | `/instances/{id}/files/content?path=` | Body `text/plain`. YAML/JSON syntax is validated (`400 invalid syntax`), then written atomically → `{"restartRequired":bool}` (Paper reads these at startup only). Admin only. |

## Plugins
| Method | Path | Description |
|---|---|---|
| GET | `/instances/{id}/plugins` | `[{fileName,enabled,size,meta?:{name,version,description,authors,apiVersion},iconUrl?,source?:{fileName,source,projectId,name,versionId,version,hashAlgo,hash,installedAt}}]`. `meta` is parsed from `plugin.yml`/`paper-plugin.yml` (cached by size+mtime); `source` exists for jars installed from the catalog (`hangar`/`modrinth`) or uploaded (`manual`). |
| GET | `/instances/{id}/plugins/updates` | `[{fileName,version,versionId}]` — catalog plugins whose newest compatible release differs from the installed one (10 s budget, ≤4 lookups in flight, failures ignored). Separate from the listing so the table never waits on the catalog. | Lists `plugins/*.jar` and `*.jar.disabled`; `source` comes from `instance.json` for jars installed through the catalog. |
| POST | `/instances/{id}/plugins` | `{"source":"hangar","projectId":"ViaVersion","versionId":"5.12.0"}` (`versionId:"latest"` = newest release for the instance's MC version) → `202` task `plugin.install` (downloads to `plugins/`, verifies the published hash, replaces an older jar of the same project, registers name, icon and install date in `instance.json`). The download is rejected unless it is a jar with a plugin descriptor — Hangar `externalUrl` entries can point at a web page. Admin only. Install several by issuing one request per plugin. |
| GET | `/instances/{id}/plugins/{fileName}/icon` | Project icon fetched from the catalog at install time (stored in `<instance>/icons/`, ≤2 MB); `404` when none. |
| POST | `/instances/{id}/plugins/upload` | multipart field `file` (≤128 MB): a plugin jar (must contain a plugin descriptor) or a `.zip` bundle, from which every jar with a descriptor is extracted (other entries ignored) → `201 {"plugins":[PluginFile…]}` with `source.source="manual"`. Admin only. |
| POST | `/instances/{id}/plugins/{fileName}/update` | Reinstalls a catalog plugin at the newest compatible release → `202` task `plugin.install`. `400` for manual jars. Admin only. |
| POST | `/instances/{id}/plugins/{fileName}/toggle` | Renames `.jar` ↔ `.jar.disabled` → `{"enabled":bool}`. Admin only. |
| DELETE | `/instances/{id}/plugins/{fileName}` | Removes the jar (enabled or disabled), its icon and manifest record → `204`. The plugin's data folder is kept. Admin only. |

## Players
| Method | Path | Description |
|---|---|---|
| GET | `/players/{name}/skin?face=64` | Player skin PNG from Mojang (name → profile → textures), cached 24 h in `<data>/skins/` (negative results too); `face=<px>` returns the head crop with the hat layer, nearest-neighbour scaled. `404 no_skin` when no Mojang account/skin has that name. |
| GET | `/instances/{id}/players/{name}/stats` | Parsed `<world>/stats/<uuid>.json`: `{dataVersion,playTimeSeconds,deaths,playerKills,mobKills,damageDealt,damageTaken,jumps,distanceMeters,blocksMined,itemsCrafted,top:{mined,killed,killed_by,crafted,used,broken,picked_up:[{id,count}]}}`. `dataVersion` 0 = no file yet. |
| GET | `/instances/{id}/players/{name}/advancements` | `[{id,done,at?}]` from `<world>/advancements/<uuid>.json`, done first, newest first; recipe unlocks omitted. |
| POST | `/instances/{id}/players/{name}/action` | `{"action":"message|kick","text":"…"}` → console command (`tell`, `kick`); `409` unless running. Op/ban use the ops/bans endpoints (they also work while stopped). Admin only. |
| GET | `/instances/{id}/players` | `[{name,firstSeen,lastSeen,playTimeSeconds,online}]` from the store, plus players known only from `<world>/stats` + `usercache.json` (e.g. migrated servers); `online` reflects the live process |
| GET | `/instances/{id}/players/{name}/sessions?limit=50` | `[{name,joinedAt,leftAt?}]` |
| POST | `/instances/{id}/broadcast` | `{"text":"...","style":"say|title|actionbar"}` |

## Import

`POST /instances/import` streams the upload to `<data>/imports/` and answers as soon as it is on disk; the `import` task then unpacks it into `server/` (a single wrapper folder such as `myserver/…` is unwrapped; `__MACOSX`, `.DS_Store` and friends are dropped; entries are confined to `server/`, symlinks and special files are skipped, and the expansion is capped at 64 GiB / 2 M entries), works out what it is and finishes like an install (Java runtime, `eula.txt`, network properties). The archive is deleted afterwards.

Detection looks at the jars in the server root: `paper-<mc>-<build>.jar`, `purpur-<mc>-<build>.jar`, `fabric-server-mc.<mc>-loader.<loader>-launcher.*.jar` and `minecraft_server.<mc>.jar` give software, version and build directly; the Fabric installer layout (`fabric-server-launch.jar` next to the vanilla `server.jar`) is Fabric with the version read from `server.jar`; a renamed jar is read for the `version.json` Mojang ships inside (→ vanilla, `id`), and `.paper/version_history.json` upgrades that to Paper with its build when its Minecraft version matches. `software` + `mcVersion` (+ `build`, default newest) are the user's answer: with no jar in the archive that build is downloaded; with a jar the daemon cannot identify they label it; a recognised jar wins over them. Without them a jar-less archive fails with `no server jar found`. The manifest's `port` overwrites `server-port`/`query.port` (the port was checked for collisions on create); an `eula.txt` already set to `true` is kept, otherwise `acceptEula` decides. A failed import leaves the instance in state `installing` for inspection (`POST …/install` is refused until it has a software and version); delete it to clean up — `DELETE` cancels a still-running import first, as it does any task of the instance.

## Backups

Archives are `tar.zst` files in `<instance>/backups/` with a JSON sidecar (`<name>.json`: trigger, scope, size, sha256, paths, Paper version/build, time). Scope `full` = worlds + plugins (jars and data) + `config/` + server/Bukkit/Spigot YAML + `server.properties` + whitelist/ops/bans/usercache; `worlds` = directories with `level.dat`. The server jar is never included (re-downloadable from the recorded build). Triggers: `manual`, `schedule`, `pre-upgrade`, `pre-restore`; only the first two rotate.

| Method | Path | Notes |
|---|---|---|
| GET | `/instances/{id}/backups` | `[{name,trigger,scope,size,sha256,paths,mcVersion,build,createdAt}]`, newest first |
| POST | `/instances/{id}/backups` | `{"scope":"full|worlds"}` (optional; default: the schedule's scope) → `202` task `backup`. Running server: `save-off` → `save-all flush` → wait for "Saved the game" (90 s) → archive → `save-on`. Then retention. Admin only. |
| GET | `/instances/{id}/backups/{name}/download` | The archive (`application/zstd`, attachment) |
| POST | `/instances/{id}/backups/{name}/restore` | `409` unless stopped → `202` task `restore`: takes a `pre-restore` backup, then every top-level path in the archive replaces what is on disk. Admin only. |
| DELETE | `/instances/{id}/backups/{name}` | Removes archive + sidecar → `204`. Admin only. |

Schedule and retention live in the manifest and are edited through `PATCH /instances/{id}` with `backups: {enabled, everyHours, keep, maxTotalMb, scope}`. The scheduler (in wardend, one-minute tick) runs a backup when the newest `schedule` archive is older than `everyHours` (a failed attempt is retried after 10 min); after each scheduled/manual backup the oldest rotating archives are removed beyond `keep` or while the folder exceeds `maxTotalMb`.

## WebSocket `/api/v1/ws`
One socket per client, multiplexing instances. JSON messages `{ "type": "...", "instance": "id", "data": {...} }`.

Client → server:
```json
{"type":"subscribe","instance":"survival","streams":["console","metrics","events"]}
{"type":"unsubscribe","instance":"survival"}
{"type":"command","instance":"survival","data":{"command":"list"}}
{"type":"ping"}
```
Server → client:
| type | data |
|---|---|
| `console` | `{ts,level,text}` (one line) |
| `console.history` | `{lines:[...]}` on subscribe |
| `metrics` | `{ts,cpu,memRss,memMax,diskUsed,netRx,netTx,tps:[1m,5m,15m],players:{online,max}}` every 2 s |
| `state` | `{state,pid,startedAt,exitCode?}` |
| `event` | `{kind:"player.join|player.leave|player.chat|player.advancement|player.death|server.ready|server.overloaded", player?, text, ts}` |
| `task.progress` | `{id,type,progress:0-100,message,status}` |
| `players` | `{online:[{uuid,name}]}` after each join/leave |
| `pong` | |

## SQLite schema (`<data>/wardend.db`)
```sql
users(id, username, password_hash, role, created_at)
sessions(token, user_id, expires_at)
api_tokens(id, user_id, name, token_hash, created_at)
metrics(instance_id, ts, cpu, mem_rss, disk_used, net_rx, net_tx, tps1, players)  -- 7-day retention, downsampled to 1 min after 24 h
players(instance_id, uuid, name, first_seen, last_seen, play_time_s)
sessions_mc(instance_id, uuid, joined_at, left_at, ip)
events(instance_id, ts, kind, player_uuid, text)
tasks(id, type, instance_id, status, progress, message, error, created_at, finished_at)
schedules(id, instance_id, cron, action, command, enabled)
```
