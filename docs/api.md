# API del daemon (`wardend`)

Versión: v1 (borrador 2026-08-28). Base: `http://<host>:8080/api/v1`. JSON en ambos sentidos.
La UI se sirve desde `/` (SPA embebida); el WebSocket desde `/api/v1/ws`.

## Convenciones
- Auth: `POST /auth/login` devuelve cookie de sesión `warden_session` (HttpOnly, SameSite=Strict). También se acepta `Authorization: Bearer <token>` para API tokens creados en Ajustes.
- Errores: `{"error":{"code":"instance_not_found","message":"..."}}` con HTTP 4xx/5xx.
- IDs de instancia: slug `^[a-z0-9][a-z0-9-]{1,31}$`.
- Fechas ISO-8601 UTC. Tamaños en bytes. CPU en % de un core (puede superar 100).
- Paginación: `?limit=&offset=` → `{"items":[],"total":N}`.
- Operaciones largas (descargar jar, backup) devuelven `202 {"task":{"id":"..."}}` y se siguen por WS (`task.progress`) o `GET /tasks/{id}`.

## Auth y sistema
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/login` | `{username,password}` → `{user}` + cookie |
| POST | `/auth/logout` | |
| GET | `/auth/me` | Usuario actual |
| GET | `/system` | `{hostname, os, cpuCores, memTotal, memUsed, disk:{path,total,used}, java:[{path,version}], daemonVersion, uptime}` |
| GET | `/system/metrics` | Snapshot global de CPU/RAM/red |
| GET | `/tasks/{id}` | Estado de tarea larga `{id,type,status,progress,message,error}` |
| GET | `/settings` / PUT | Config del panel (puerto, dataDir, contacto para User-Agent, rutas de Java, backups) |

## Catálogo (proveedores externos, con caché)
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/catalog/servers` | `[{"id":"paper","name":"Paper"}]` (proveedores disponibles) |
| GET | `/catalog/servers/paper/versions?includePre=false` | `{"versions":["1.21.8","1.21.7",...],"latest":"1.21.8"}` |
| GET | `/catalog/servers/paper/versions/{mc}/builds?channel=STABLE` | `[{"id":60,"channel":"STABLE","time":"...","size":N,"sha256":"...","name":"paper-1.21.8-60.jar","changes":["..."]}]` |
| GET | `/catalog/plugins/search?q=&source=hangar|modrinth|all&mc=1.21.8&limit=&offset=` | `[{"source":"hangar","id":"ViaVersion","name":"ViaVersion","author":"kennytv","description":"...","iconUrl":"...","downloads":N,"categories":[],"url":"..."}]` |
| GET | `/catalog/plugins/{source}/{id}` | Detalle |
| GET | `/catalog/plugins/{source}/{id}/versions?mc=1.21.8` | `[{"id":"...","name":"5.12.0","channel":"release","mcVersions":[],"fileName":"...","size":N,"hash":{"algo":"sha256","value":"..."},"dependencies":[{"name","required"}],"publishedAt":"..."}]` |

## Instancias
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/instances` | Lista con estado resumido `[{id,name,software,mcVersion,build,state,players:{online,max},port,autostart,cpu,mem}]` |
| POST | `/instances` | Crear. Body abajo. → `202` con `task` (descarga jar, escribe archivos base). |
| GET | `/instances/{id}` | Manifiesto completo + estado |
| PATCH | `/instances/{id}` | Cambiar nombre, jvm, autostart, restartPolicy, javaPath, memoria, puertos (si está parada) |
| DELETE | `/instances/{id}?purge=false` | Detiene y mueve a papelera (`purge=true` borra) |
| POST | `/instances/{id}/start` | |
| POST | `/instances/{id}/stop?timeout=60` | `stop` limpio |
| POST | `/instances/{id}/restart` | |
| POST | `/instances/{id}/kill` | SIGKILL (confirmación en UI) |
| POST | `/instances/{id}/command` | `{"command":"say hola"}` → `204`. Con `?rcon=true` → `{"response":"..."}` sincrónico |
| GET | `/instances/{id}/console?lines=500` | Últimas líneas del ring buffer `[{ts,level,text}]` |
| GET | `/instances/{id}/logs` / `/logs/{file}` | Archivos de `logs/` (gz descomprimido al vuelo) |
| GET | `/instances/{id}/metrics?range=1h&step=10s` | Serie temporal `[{ts,cpu,memRss,diskUsed,netRx,netTx,tps,players}]` desde SQLite |
| POST | `/instances/{id}/eula` | `{"accept":true}` → escribe `eula.txt` |
| POST | `/instances/{id}/upgrade` | `{"mcVersion":"1.21.8","build":60}` → `202` task. Hace backup antes. |

Body de creación:
```json
{
  "id": "survival",
  "name": "Survival 2026",
  "software": "paper",
  "mcVersion": "1.21.8",
  "build": 60,                 // opcional: último STABLE
  "memoryMb": 4096,
  "jvmFlagsPreset": "aikar",   // aikar | basic | custom
  "jvmFlags": [],              // si custom
  "javaPath": null,            // null = autodetectar
  "port": 25565,
  "autostart": true,
  "restartPolicy": "on-crash",
  "acceptEula": true,
  "properties": {"motd": "Hola", "max-players": "20"}
}
```

### Estado de una instancia (`state`)
`stopped | starting | running | stopping | crashed | installing`

## Configuración de la instancia
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/instances/{id}/properties` | `[{key,value,type:"bool|int|string|enum",default,enum:[],description,requiresRestart}]` |
| PUT | `/instances/{id}/properties` | `{"motd":"...", "max-players":"30"}` (solo claves enviadas). Respuesta indica `restartRequired` |
| GET/PUT | `/instances/{id}/whitelist` | `[{uuid,name}]`; PUT reemplaza y ejecuta `whitelist reload` |
| POST/DELETE | `/instances/{id}/whitelist/{name}` | Resuelve UUID vía usercache/Mojang |
| GET | `/instances/{id}/ops` | `[{uuid,name,level}]` |
| POST/DELETE | `/instances/{id}/ops/{name}` | Ejecuta `op`/`deop` si corre; edita JSON si está parada |
| GET | `/instances/{id}/bans` | `{players:[...], ips:[...]}` |
| POST | `/instances/{id}/bans` | `{"player":"Steve","reason":"...","expires":null}` o `{"ip":"..."}` |
| DELETE | `/instances/{id}/bans/{target}` | `pardon` / `pardon-ip` |
| GET | `/instances/{id}/files?path=config` | Listado `[{name,size,mtime,dir}]` (confinado al dir de la instancia) |
| GET/PUT | `/instances/{id}/files/content?path=config/paper-global.yml` | Texto (límite 2 MB); PUT crea backup `.bak` |
| POST | `/instances/{id}/files/upload` | multipart |
| DELETE | `/instances/{id}/files?path=` | |

## Plugins
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/instances/{id}/plugins` | `[{fileName,name,version,enabled,source:{provider,projectId,versionId}|null,updateAvailable:{version,versionId}|null}]`. Lee `plugin.yml`/`paper-plugin.yml` del jar + `instance.json`. |
| POST | `/instances/{id}/plugins` | `{"source":"hangar","projectId":"ViaVersion","versionId":"5.12.0"}` → `202` task (descarga a `plugins/`, verifica hash, registra) |
| POST | `/instances/{id}/plugins/upload` | multipart .jar |
| POST | `/instances/{id}/plugins/{fileName}/update` | Al último compatible |
| POST | `/instances/{id}/plugins/{fileName}/toggle` | Renombra `.jar` ↔ `.jar.disabled` |
| DELETE | `/instances/{id}/plugins/{fileName}` | |

## Jugadores
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/instances/{id}/players?online=true` | `[{uuid,name,online,firstSeen,lastSeen,playTimeSeconds,ip?,isOp,isWhitelisted}]` |
| GET | `/instances/{id}/players/{uuid}` | Ficha: sesiones, estadísticas clave (`play_time`, `deaths`, `mob_kills`, `player_kills`, `walk_one_cm`…), logros `{done:N,total:N}` |
| GET | `/instances/{id}/players/{uuid}/advancements` | `[{id:"minecraft:story/mine_stone",done:true,completedAt,criteria:{...}}]` |
| GET | `/instances/{id}/players/{uuid}/stats` | JSON de `stats/<uuid>.json` normalizado |
| POST | `/instances/{id}/players/{uuid}/message` | `{"text":"hola"}` → `tell` |
| POST | `/instances/{id}/players/{uuid}/kick` | `{"reason":""}` |
| POST | `/instances/{id}/broadcast` | `{"text":"...","style":"say|title|actionbar"}` |

## Backups
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/instances/{id}/backups` | `[{id,createdAt,size,worlds:[],note}]` |
| POST | `/instances/{id}/backups` | `{"note":""}` → `202` task (`save-off`/`save-all flush`/tar.zst/`save-on`) |
| POST | `/instances/{id}/backups/{bid}/restore` | Requiere instancia parada → `202` |
| GET | `/instances/{id}/backups/{bid}/download` | |
| DELETE | `/instances/{id}/backups/{bid}` | |
| GET/PUT | `/instances/{id}/schedule` | `[{id,cron,action:"backup|restart|command",command?,enabled}]` |

## WebSocket `/api/v1/ws`
Un socket por cliente, multiplexa instancias. Mensajes JSON `{ "type": "...", "instance": "id", "data": {...} }`.

Cliente → servidor:
```json
{"type":"subscribe","instance":"survival","streams":["console","metrics","events"]}
{"type":"unsubscribe","instance":"survival"}
{"type":"command","instance":"survival","data":{"command":"list"}}
{"type":"ping"}
```
Servidor → cliente:
| type | data |
|---|---|
| `console` | `{ts,level,text}` (una línea) |
| `console.history` | `{lines:[...]}` al suscribirse |
| `metrics` | `{ts,cpu,memRss,memMax,diskUsed,netRx,netTx,tps:[1m,5m,15m],players:{online,max}}` cada 2 s |
| `state` | `{state,pid,startedAt,exitCode?}` |
| `event` | `{kind:"player.join|player.leave|player.chat|player.advancement|player.death|server.ready|server.overloaded", player?, text, ts}` |
| `task.progress` | `{id,type,progress:0-100,message,status}` |
| `players` | `{online:[{uuid,name}]}` tras cada join/leave |
| `pong` | |

## Esquema SQLite (`<data>/wardend.db`)
```sql
users(id, username, password_hash, role, created_at)
sessions(token, user_id, expires_at)
api_tokens(id, user_id, name, token_hash, created_at)
metrics(instance_id, ts, cpu, mem_rss, disk_used, net_rx, net_tx, tps1, players)  -- retención 7 días, downsample 1 min tras 24 h
players(instance_id, uuid, name, first_seen, last_seen, play_time_s)
sessions_mc(instance_id, uuid, joined_at, left_at, ip)
events(instance_id, ts, kind, player_uuid, text)
tasks(id, type, instance_id, status, progress, message, error, created_at, finished_at)
schedules(id, instance_id, cron, action, command, enabled)
```
