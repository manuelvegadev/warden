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
| GET | `/system` | `{hostname, os, cpuCores, memTotal, memUsed, disk:{path,total,used}, java:[{path,version}], daemonVersion, uptime}` |
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
| GET | `/catalog/servers` | `[{"id":"paper","name":"Paper"}]` (available providers) |
| GET | `/catalog/servers/paper/versions?includePre=false` | `{"versions":["1.21.8","1.21.7",...],"latest":"1.21.8"}` |
| GET | `/catalog/servers/paper/versions/{mc}/builds?channel=STABLE` | `[{"id":60,"channel":"STABLE","time":"...","size":N,"sha256":"...","name":"paper-1.21.8-60.jar","changes":["..."]}]` |
| GET | `/catalog/plugins/search?q=&source=hangar|modrinth|all&mc=1.21.8&limit=&offset=` | `[{"source":"hangar","id":"ViaVersion","name":"ViaVersion","author":"kennytv","description":"...","iconUrl":"...","downloads":N,"categories":[],"url":"..."}]` |
| GET | `/catalog/plugins/{source}/{id}` | Details |
| GET | `/catalog/plugins/{source}/{id}/versions?mc=1.21.8` | `[{"id":"...","name":"5.12.0","channel":"release","mcVersions":[],"fileName":"...","size":N,"hash":{"algo":"sha256","value":"..."},"dependencies":[{"name","required"}],"publishedAt":"..."}]` |

## Instances
| Method | Path | Description |
|---|---|---|
| GET | `/instances` | List with summarized state `[{id,name,software,mcVersion,build,state,players:{online,max},port,autostart,cpu,mem}]` |
| POST | `/instances` | Create. Body below. → `202` with `task` (downloads jar, writes base files). |
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
  "software": "paper",
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
| GET | `/instances/{id}/properties` | `[{key,value,type:"bool|int|string|enum",default,enum:[],description,requiresRestart}]` |
| PUT | `/instances/{id}/properties` | `{"motd":"...", "max-players":"30"}` (only the keys sent). Response indicates `restartRequired` |
| GET/PUT | `/instances/{id}/whitelist` | `[{uuid,name}]`; PUT replaces and runs `whitelist reload` |
| POST/DELETE | `/instances/{id}/whitelist/{name}` | Resolves UUID via usercache/Mojang |
| GET | `/instances/{id}/ops` | `[{uuid,name,level}]` |
| POST/DELETE | `/instances/{id}/ops/{name}` | Runs `op`/`deop` if running; edits the JSON if stopped |
| GET | `/instances/{id}/bans` | `{players:[...], ips:[...]}` |
| POST | `/instances/{id}/bans` | `{"player":"Steve","reason":"...","expires":null}` or `{"ip":"..."}` |
| DELETE | `/instances/{id}/bans/{target}` | `pardon` / `pardon-ip` |
| GET | `/instances/{id}/files?path=config` | Listing `[{name,size,mtime,dir}]` (confined to the instance dir) |
| GET/PUT | `/instances/{id}/files/content?path=config/paper-global.yml` | Text (2 MB limit); PUT creates a `.bak` backup |
| POST | `/instances/{id}/files/upload` | multipart |
| DELETE | `/instances/{id}/files?path=` | |

## Plugins
| Method | Path | Description |
|---|---|---|
| GET | `/instances/{id}/plugins` | `[{fileName,name,version,enabled,source:{provider,projectId,versionId}|null,updateAvailable:{version,versionId}|null}]`. Reads `plugin.yml`/`paper-plugin.yml` from the jar + `instance.json`. |
| POST | `/instances/{id}/plugins` | `{"source":"hangar","projectId":"ViaVersion","versionId":"5.12.0"}` → `202` task (downloads to `plugins/`, verifies hash, registers) |
| POST | `/instances/{id}/plugins/upload` | multipart .jar |
| POST | `/instances/{id}/plugins/{fileName}/update` | To the latest compatible version |
| POST | `/instances/{id}/plugins/{fileName}/toggle` | Renames `.jar` ↔ `.jar.disabled` |
| DELETE | `/instances/{id}/plugins/{fileName}` | |

## Players
| Method | Path | Description |
|---|---|---|
| GET | `/instances/{id}/players` | `[{name,firstSeen,lastSeen,playTimeSeconds,online}]` from the store; `online` reflects the live process |
| GET | `/instances/{id}/players/{name}/sessions?limit=50` | `[{name,joinedAt,leftAt?}]` |
| GET | `/instances/{id}/players?online=true` (planned) | `[{uuid,name,online,firstSeen,lastSeen,playTimeSeconds,ip?,isOp,isWhitelisted}]` |
| GET | `/instances/{id}/players/{uuid}` | Profile: sessions, key statistics (`play_time`, `deaths`, `mob_kills`, `player_kills`, `walk_one_cm`…), advancements `{done:N,total:N}` |
| GET | `/instances/{id}/players/{uuid}/advancements` | `[{id:"minecraft:story/mine_stone",done:true,completedAt,criteria:{...}}]` |
| GET | `/instances/{id}/players/{uuid}/stats` | Normalized JSON from `stats/<uuid>.json` |
| POST | `/instances/{id}/players/{uuid}/message` | `{"text":"hola"}` → `tell` |
| POST | `/instances/{id}/players/{uuid}/kick` | `{"reason":""}` |
| POST | `/instances/{id}/broadcast` | `{"text":"...","style":"say|title|actionbar"}` |

## Backups
| Method | Path | Description |
|---|---|---|
| GET | `/instances/{id}/backups` | `[{id,createdAt,size,worlds:[],note}]` |
| POST | `/instances/{id}/backups` | `{"note":""}` → `202` task (`save-off`/`save-all flush`/tar.zst/`save-on`) |
| POST | `/instances/{id}/backups/{bid}/restore` | Requires stopped instance → `202` |
| GET | `/instances/{id}/backups/{bid}/download` | |
| DELETE | `/instances/{id}/backups/{bid}` | |
| GET/PUT | `/instances/{id}/schedule` | `[{id,cron,action:"backup|restart|command",command?,enabled}]` |

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
