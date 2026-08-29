# Roadmap

## Fase 0 — Diseño (actual)
- [x] Investigación de alternativas y APIs
- [x] ADRs de lenguaje, interfaz, arquitectura e integración
- [ ] Definir esquema de la API (REST + mensajes WebSocket)
- [ ] Esqueleto del repo: `cmd/mcd`, `internal/{instance,console,metrics,mc,api,store}`, `web/`

## Fase 1 — MVP daemon
- [ ] Crear/arrancar/detener/reiniciar una instancia (proceso Java hijo)
- [ ] Consola en vivo por WebSocket + enviar comandos
- [ ] Métricas CPU/RAM/disco/red cada 2 s
- [ ] Auth básica (usuario/contraseña + sesión) y HTTPS opcional
- [ ] Unidad `systemd` e instalador

## Fase 2 — Configuración
- [ ] Editor de `server.properties` con esquema
- [ ] Whitelist / ops / bans
- [ ] Descargar jar (Vanilla, Paper, Fabric) y aceptar EULA desde la UI
- [ ] Backups del mundo (tar.zst) programados

## Fase 3 — Jugadores
- [ ] Lista de online (parser de log + ping), historial de sesiones en SQLite
- [ ] Logros y estadísticas por jugador
- [ ] Enviar mensajes (`say`, `tell`, `tellraw`), kick/ban/op desde la ficha del jugador

## Fase 4 — Extras
- [ ] Programador de tareas (reinicios, `save-all`, anuncios)
- [ ] Gestor de archivos y editor de plugins/mods
- [ ] cgroups por instancia para límites de recursos
- [ ] PWA + notificaciones (caída del server, jugador conectado)
