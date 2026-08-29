# ADR-004: How the daemon integrates with the Minecraft server

Date: 2026-08-28 · Status: accepted

## Decision (by layer)

1. **Process stdin/stdout** — primary channel.
   - Console: stdout/stderr → ring buffer (last N lines) + broadcast to WebSockets.
   - Commands: the UI sends text → stdin.
   - Log line parser to produce typed events: `server.ready`, `player.join`, `player.leave`, `player.chat`, `player.advancement`, `server.stopping`.
   - Clean shutdown: write `stop` to stdin, wait N seconds, then SIGTERM, then SIGKILL.
2. **RCON** — for commands whose response we need synchronously (`list`, `whitelist list`). The daemon enables `enable-rcon` and generates `rcon.password` automatically in `server.properties`; listening is restricted to `127.0.0.1`.
3. **Server List Ping** — health check and online/max players without depending on the parser.
4. **Files**
   - `server.properties`: key/value editor with a known schema (types, valid values, description).
   - `whitelist.json`, `ops.json`, `banned-players.json`, `banned-ips.json`: CRUD from the UI; after editing, `whitelist reload` is run via stdin.
   - `world/advancements/<uuid>.json` + `world/stats/<uuid>.json` + `usercache.json`: players screen with advancements and statistics. Re-read on demand or with `fsnotify`.
5. **Messages to players**: `say <msg>`, `tellraw @a {...}` and `tell <player> <msg>` via stdin.

## Note on versions
Log and file formats have been stable in vanilla/Paper/Fabric since 1.13+. The target is Java Edition ≥ 1.20; Bedrock is out of scope.
