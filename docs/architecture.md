# Arquitectura

```
                 HTTPS (Dokploy/Traefik)                HTTPS + WSS (JWT)
 Navegador  ───────────────────────►  panel (Next.js)    ┐
     │                                 en Docker         │ sirve la SPA
     │                                                   ┘
     └──────────────────────────────────────────────────────►  mcd (Go, systemd) en Ubuntu
                                    REST /api/v1 + WS /api/v1/ws        │
                                                                        ├─ instancia "survival"  (java -jar paper.jar)  stdin/stdout
                                                                        ├─ instancia "creative"  (java -jar paper.jar)
                                                                        ├─ SQLite (usuarios, métricas, jugadores, eventos)
                                                                        └─ Fill / Hangar / Modrinth (salientes, con caché)
```

## Monorepo
```
daemon/                 Go — el daemon `mcd`
  cmd/mcd/              main: flags, config, arranque
  internal/
    config/             carga de config (YAML/env)
    api/                router HTTP, middlewares (auth, CORS), handlers REST
    ws/                 hub WebSocket: suscripciones por instancia
    auth/               usuarios, JWT, hash de contraseñas
    instance/           manifiesto, máquina de estados, supervisor de proceso, ring buffer de consola
    mc/                 parser de log, RCON, ping, server.properties (esquema), whitelist/ops/bans, advancements/stats
    catalog/            proveedores: paper (Fill v3), hangar, modrinth; caché
    metrics/            muestreo /proc (gopsutil), serie temporal en SQLite
    store/              SQLite (migraciones, repos)
    backup/             save-off/save-all/tar.zst
    tasks/              tareas largas con progreso
  deploy/               mcd.service, script de instalación, Dockerfile opcional
panel/                  Next.js — la UI
  app/                  App Router: (auth)/login, (dashboard)/instances/[id]/{console,config,plugins,players,backups}
  components/           shadcn/ui + componentes propios (Console, MetricsChart, PluginBrowser…)
  lib/                  cliente API tipado, hook useDaemonSocket, auth
  Dockerfile
docs/                   investigación, ADRs, API
```

## Flujo: crear una instancia Paper
1. UI: `GET /catalog/servers/paper/versions` → elige `1.21.8` → `GET .../builds` → build 60.
2. `POST /instances` → el daemon crea `servers/survival/`, escribe `instance.json`, lanza tarea `install`.
3. Tarea: descarga jar de `fill-data.papermc.io`, verifica sha256, escribe `eula.txt` (si `acceptEula`), `server.properties` con puerto y RCON local, genera `start` args.
4. WS `task.progress` → 100 %. Estado `stopped`. UI ofrece "Iniciar".
5. `POST /instances/survival/start` → `os/exec` con Aikar flags → stdout → parser → `server.ready` cuando ve `Done (…)!`.

## Flujo: instalar plugin
1. UI busca `GET /catalog/plugins/search?q=via&mc=1.21.8` (agrega Hangar + Modrinth).
2. Elige versión → `POST /instances/{id}/plugins` → tarea descarga a `server/plugins/`, verifica hash, añade entrada a `instance.json.plugins[]`.
3. UI avisa "requiere reinicio".

## Seguridad
- JWT firmado con secreto generado en el primer arranque (`<data>/secret.key`), expiración 12 h, refresh por re-login.
- Rutas de archivos siempre resueltas y comprobadas dentro de `servers/<id>/server/` (anti path-traversal).
- Rate limit en `/auth/login`.
- El daemon corre como usuario `minecraft`; el panel no tiene acceso a nada del host.
