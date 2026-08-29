# ADR-004: Cómo se integra el daemon con el servidor de Minecraft

Fecha: 2026-08-28 · Estado: aceptada

## Decisión (por capas)

1. **stdin/stdout del proceso** — canal principal.
   - Consola: stdout/stderr → ring buffer (últimas N líneas) + broadcast a WebSockets.
   - Comandos: la UI envía texto → stdin.
   - Parser de líneas de log para generar eventos tipados: `server.ready`, `player.join`, `player.leave`, `player.chat`, `player.advancement`, `server.stopping`.
   - Apagado limpio: escribir `stop` en stdin, esperar N segundos, luego SIGTERM, luego SIGKILL.
2. **RCON** — para comandos cuya respuesta necesitamos de forma sincrónica (`list`, `whitelist list`). El daemon activa `enable-rcon` y genera `rcon.password` automáticamente en `server.properties`; la escucha se limita a `127.0.0.1`.
3. **Server List Ping** — chequeo de salud y jugadores online/max sin depender del parser.
4. **Archivos**
   - `server.properties`: editor clave/valor con esquema conocido (tipos, valores válidos, descripción).
   - `whitelist.json`, `ops.json`, `banned-players.json`, `banned-ips.json`: CRUD desde la UI; tras editar se ejecuta `whitelist reload` por stdin.
   - `world/advancements/<uuid>.json` + `world/stats/<uuid>.json` + `usercache.json`: pantalla de jugadores con logros y estadísticas. Se releen bajo demanda o con `fsnotify`.
5. **Mensajes a jugadores**: `say <msg>`, `tellraw @a {...}` y `tell <player> <msg>` vía stdin.

## Nota sobre versiones
Los formatos de log y de archivos son estables en vanilla/Paper/Fabric desde 1.13+. Se apunta a Java Edition ≥ 1.20; Bedrock queda fuera de alcance.
