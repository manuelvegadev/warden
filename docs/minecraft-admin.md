# Administering a Minecraft Java / Paper server — reference

A collection of official and community documentation relevant to the panel.

## Official documentation
- Paper docs: https://docs.papermc.io/paper/ — [Getting started](https://docs.papermc.io/paper/getting-started/), [Aikar's flags](https://docs.papermc.io/paper/aikars-flags/), [Configuration](https://docs.papermc.io/paper/reference/configuration/), [Anti-Xray](https://docs.papermc.io/paper/anti-xray/), [Basic troubleshooting](https://docs.papermc.io/paper/basic-troubleshooting/), [Updating](https://docs.papermc.io/paper/updating/).
- Minecraft Wiki: [server.properties](https://minecraft.wiki/w/Server.properties), [RCON](https://minecraft.wiki/w/RCON), [Query](https://minecraft.wiki/w/Query), [Server List Ping](https://minecraft.wiki/w/Java_Edition_protocol/Server_List_Ping), [Commands](https://minecraft.wiki/w/Commands), [Advancement](https://minecraft.wiki/w/Advancement), [Statistics](https://minecraft.wiki/w/Statistics), [Tutorials/Setting up a server](https://minecraft.wiki/w/Tutorial:Setting_up_a_server).
- EULA: https://aka.ms/MinecraftEULA — `eula=true` must be written to `eula.txt`; this must be an explicit user action.
- Community: [PaperMC Discord/Forums](https://forums.papermc.io/), [itzg/docker-minecraft-server](https://docker-minecraft-server.readthedocs.io/) (excellent automation reference: variables, Paper/Modrinth downloads, RCON), [YouHaveTrouble/minecraft-optimization](https://github.com/YouHaveTrouble/minecraft-optimization) (config optimization guide), [Spigot/Paper timings → spark](https://spark.lucko.me/).

## Requirements
- Java per Minecraft version: **26.1+ → Java 25**, 1.20.5–1.21.x → 21, 1.17–1.20.4 → 17, ≤1.16 → 8. wardend downloads the right Temurin JRE automatically (ADR-010); no system-wide install needed.
- Paper 1.20.5+ requires **Java 21**; 1.17–1.20.4 Java 17; ≤1.16 Java 8/11. Recommended: Temurin/Adoptium (`apt install temurin-21-jre` from the Adoptium repo) or Ubuntu's `openjdk-21-jre-headless`.
- RAM: `Xmx` = available physical RAM − 1–1.5 GB (the JVM uses memory outside the heap). `Xms` = `Xmx` with Aikar.
- Dedicated user without a shell (`warden`), never root.

## Startup command (Paper + Aikar's flags)
```
java -Xms4G -Xmx4G -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 \
 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch \
 -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M \
 -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 \
 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 \
 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem \
 -XX:MaxTenuringThreshold=1 -Dusing.aikars.flags=https://mcflags.emc.gs -Daikars.new.flags=true \
 -jar paper.jar --nogui
```
With `Xmx ≥ 12G` Aikar recommends `G1NewSizePercent=40`, `G1MaxNewSizePercent=50`, `G1HeapRegionSize=16M`, `G1ReservePercent=15`, `InitiatingHeapOccupancyPercent=20`.
The panel will generate these flags from a template ("Aikar", "Basic", "Custom").

## Files managed by the panel
| File | Format | Notes |
|---|---|---|
| `eula.txt` | properties | `eula=true` |
| `server.properties` | properties | Relevant keys: `server-port`, `motd`, `max-players`, `online-mode`, `white-list`, `enforce-whitelist`, `difficulty`, `gamemode`, `pvp`, `view-distance`, `simulation-distance`, `level-name`, `level-seed`, `enable-rcon`, `rcon.port`, `rcon.password`, `enable-query`, `query.port`, `spawn-protection`, `allow-flight`, `enforce-secure-profile`. See schema in `internal/mc/properties_schema.go`. |
| `whitelist.json` | `[{"uuid","name"}]` | Reload with `whitelist reload`. |
| `ops.json` | `[{"uuid","name","level":1-4,"bypassesPlayerLimit"}]` | Prefer the `op/deop` commands. |
| `banned-players.json` | `[{"uuid","name","created","source","expires","reason"}]` | |
| `banned-ips.json` | `[{"ip","created","source","expires","reason"}]` | |
| `usercache.json` | `[{"name","uuid","expiresOn"}]` | Name↔uuid mapping. |
| `bukkit.yml`, `spigot.yml` | YAML | Legacy. |
| `config/paper-global.yml` | YAML | Paper global config (1.19+). |
| `config/paper-world-defaults.yml`, `<world>/paper-world.yml` | YAML | Per-world config. |
| `plugins/*.jar`, `plugins/<Plugin>/config.yml` | | Plugins load at startup; most do not support hot reload (avoid `/reload`, Paper discourages it). |
| `logs/latest.log`, `logs/*.log.gz` | text | Daily rotation done by the server. |
| `world/`, `world_nether/`, `world_the_end/` | Anvil/NBT | Backup with `save-off` → `save-all flush` → tar → `save-on`. |
| `world/advancements/<uuid>.json` | JSON | `{"minecraft:story/mine_stone":{"criteria":{...},"done":true}, "DataVersion":N}` |
| `world/stats/<uuid>.json` | JSON | `{"stats":{"minecraft:custom":{"minecraft:play_time":N,...},"minecraft:mined":{...}},"DataVersion":N}`. `play_time` in ticks (20/s). |
| `world/playerdata/<uuid>.dat` | NBT gzip | Inventory, position, health. Later phase. |

## Commands the panel will use (via stdin or RCON)
`stop`, `save-all [flush]`, `save-off`, `save-on`, `list`, `say <msg>`, `tell <p> <msg>`, `tellraw @a <json>`, `title @a title <json>`, `kick <p> [reason]`, `ban <p> [reason]`, `pardon <p>`, `ban-ip`, `op <p>`, `deop <p>`, `whitelist add|remove|list|reload|on|off`, `tps` (Paper), `gamemode`, `time set`, `weather`, `difficulty`, `plugins` (Bukkit), `version`, `paper reload` (config only), `restart` (Paper, runs the `restart-script` from spigot.yml — we will not use it, the daemon restarts).

## Log lines to parse (Paper 1.21+)
```
[12:00:01 INFO]: Starting minecraft server version 1.21.8
[12:00:05 INFO]: Done (4.123s)! For help, type "help"
[12:00:05 INFO]: Timings Reset
[12:01:00 INFO]: UUID of player Steve is 069a79f4-44e9-4726-a5be-fca90e38aaf5
[12:01:01 INFO]: Steve[/192.168.1.5:54321] logged in with entity id 123 at ([world]1.0, 64.0, 2.0)
[12:01:01 INFO]: Steve joined the game
[12:02:00 INFO]: <Steve> hola
[12:02:10 INFO]: Steve has made the advancement [Stone Age]
[12:02:11 INFO]: Steve has completed the challenge [Cover Me in Debris]
[12:02:12 INFO]: Steve has reached the goal [Free the End]
[12:03:00 INFO]: Steve fell from a high place
[12:05:00 INFO]: Steve lost connection: Disconnected
[12:05:00 INFO]: Steve left the game
[12:09:00 INFO]: Stopping the server
[12:09:00 INFO]: Stopping server
[12:09:01 WARN]: Can't keep up! Is the server overloaded? Running 2500ms or 50 ticks behind
[12:10:00 INFO]: There are 2 of a max of 20 players online: Steve, Alex
```
Paper prefix format: `[HH:MM:SS LEVEL]:` (vanilla uses `[HH:MM:SS] [Server thread/INFO]:`); the parser must accept both. Advancement names are translated according to the server language; the reliable source is `world/advancements/<uuid>.json`.

## Safe shutdown and restart
1. `say Servidor reiniciando en 30s` (configurable warning).
2. `stop` via stdin → Paper saves worlds and players.
3. Wait up to 60 s for the process to exit; if not, `SIGTERM`; after 15 more seconds, `SIGKILL` (corruption risk: last resort only).
4. Never `kill -9` as the first option; never back up while the server is writing (use `save-off`).

## Security
- `online-mode=true` unless a proxy (Velocity) is in front with `velocity-support`.
- RCON only on `127.0.0.1` with a random password generated by the panel.
- Panel behind HTTPS (Caddy/nginx reverse proxy or built-in TLS); never expose 25575 or the panel without auth to the Internet.
- Firewall: `ufw allow 25565/tcp` only for game ports.
