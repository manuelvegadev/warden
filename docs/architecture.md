# Architecture

```
                 HTTPS (Dokploy/Traefik)                HTTPS + WSS (JWT)
 Browser    ───────────────────────►  panel (Next.js)    ┐
     │                                 in Docker         │ serves the SPA
     │                                                   ┘
     └──────────────────────────────────────────────────────►  wardend (Go, systemd) on Ubuntu
                                    REST /api/v1 + WS /api/v1/ws        │
                                                                        ├─ instance "survival"  (java -jar paper.jar)  stdin/stdout
                                                                        ├─ instance "creative"  (java -jar paper.jar)
                                                                        ├─ SQLite (users, metrics, players, events)
                                                                        └─ Fill / Hangar / Modrinth (outbound, cached)
```

## Monorepo
```
daemon/                 Go — the `wardend` daemon
  cmd/wardend/              main: flags, config, startup
  internal/
    config/             config loading (YAML/env)
    api/                HTTP router, middlewares (auth, CORS), REST handlers
    ws/                 WebSocket hub: per-instance subscriptions
    auth/               users, JWT, password hashing
    instance/           manifest, state machine, process supervisor, console ring buffer
    mc/                 log parser, RCON, ping, server.properties (schema), whitelist/ops/bans, advancements/stats
    world/              live world view: agent WebSocket listener, chunk cache, `world.*` bus messages (ADR-018)
    agent/              the embedded Warden Agent jar (built from agent/ by `make agent`)
    catalog/            providers: paper (Fill v3), hangar, modrinth; cache
    metrics/            /proc sampling (gopsutil), time series in SQLite
    store/              SQLite (migrations, repos)
    backup/             save-off/save-all/tar.zst
    tasks/              long-running tasks with progress
  deploy/               single-host compose file and the wardend.env reference (the installer is `wardend install`)
beacon/                 Next.js — the UI (pnpm workspace member)
  app/                  App Router: (auth)/login, (dashboard)/instances/[id]/[section], settings
  components/           own components (Console, MetricsChart, PluginsTab…); shadcn primitives come from @warden/ui
  lib/                  typed API client, useWardendSocket hook, auth
  Dockerfile            built from the repo root (`docker build -f beacon/Dockerfile .`)
landing/                Astro static site (React islands from @warden/ui) — GitHub Pages (ADR-014)
packages/ui/            @warden/ui: shadcn/ui components + design tokens shared by beacon and landing
docs/                   research, ADRs, API
```

## Flow: create a Paper instance
1. UI: `GET /catalog/servers/paper/versions` → pick `1.21.8` → `GET .../builds` → build 60.
2. `POST /instances` → the daemon creates `servers/survival/`, writes `instance.json`, launches the `install` task.
3. Task: downloads the jar from `fill-data.papermc.io`, verifies sha256, writes `eula.txt` (if `acceptEula`), `server.properties` with port and local RCON, generates `start` args.
4. WS `task.progress` → 100 %. State `stopped`. UI offers "Start".
5. `POST /instances/survival/start` → `os/exec` with Aikar flags → stdout → parser → `server.ready` when it sees `Done (…)!`.

## Flow: install a plugin
1. UI searches `GET /catalog/plugins/search?q=via&mc=1.21.8` (aggregates Hangar + Modrinth).
2. Pick a version → `POST /instances/{id}/plugins` → task downloads to `server/plugins/`, verifies hash, adds an entry to `instance.json.plugins[]`.
3. UI shows "restart required".

## Security
- JWT signed with a secret generated on first startup (`<data>/secret.key`), 12 h expiry, refresh by re-login.
- File paths always resolved and checked to be inside `servers/<id>/server/` (anti path-traversal).
- Rate limit on `/auth/login`.
- The daemon runs as the `warden` user; the panel has no access to anything on the host.
