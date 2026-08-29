# Roadmap

## Fase 0 — Diseño ✅
- [x] Investigación de alternativas y APIs (Fill v3, Hangar, Modrinth verificadas)
- [x] ADRs 001–007
- [x] Especificación de API REST + WS (`docs/api.md`)
- [x] Esqueleto: `wardend/` (Go, compila, parser de log con tests) y `beacon/` (Next.js + Dockerfile)
- [x] Modelo de seguridad y auth (`docs/security.md`, ADR-008); propuestas de nombre (`docs/naming.md`)
- [x] Nombre: Warden / `wardend`; Better Auth (ADR-009)

## Fase 1 — MVP daemon
- [ ] `internal/store`: SQLite + migraciones (métricas, jugadores, eventos; ya no usuarios)
- [x] `internal/auth`: verificación JWT vía JWKS de Beacon + `X-Panel-Key` + roles (ADR-009)
- [x] Beacon: Better Auth (email+password, admin, jwt EdDSA), login, layout protegido, proxy BFF `/api/wardend`
- [ ] `internal/catalog/paper`: Fill v3 (versiones, builds, descarga con sha256)
- [ ] `internal/tasks`: tarea `install` (jar + eula + server.properties + rcon local)
- [ ] `internal/instance`: proceso `java` con `os/exec`, ring buffer de consola, stop escalonado, restart policy
- [ ] `internal/ws`: hub, streams console/state/events
- [ ] `internal/metrics`: gopsutil cada 2 s, persistencia y endpoint `/metrics`
- [ ] Panel: login, lista de instancias, wizard de creación, consola (xterm.js), tarjetas de recursos

## Fase 2 — Configuración y plugins
- [ ] Esquema de `server.properties`; whitelist/ops/bans; editor de archivos confinado
- [ ] `catalog/hangar` + `catalog/modrinth`; instalar/actualizar/toggle plugins; leer `plugin.yml` de los jars
- [ ] Upgrade de build/versión de Paper con backup previo
- [ ] Panel: pantallas de config y navegador de plugins

## Fase 3 — Jugadores
- [ ] Sesiones (join/leave) en SQLite, RCON `list`, ping
- [ ] Logros y estadísticas desde `world/advancements` y `world/stats`
- [ ] Mensajes, kick, ban, op desde la ficha del jugador

## Fase 4 — Operación
- [ ] Backups (save-off/save-all/tar.zst) y programador cron
- [ ] TLS integrado en el daemon; Dockerfile opcional del daemon
- [ ] Multi-nodo en el panel (varios daemons)
- [ ] Otros proveedores: Purpur, Fabric, Vanilla
