# Administración de un servidor Minecraft Java / Paper — referencia

Recopilación de documentación oficial y de la comunidad relevante para el panel.

## Documentación oficial
- Paper docs: https://docs.papermc.io/paper/ — [Getting started](https://docs.papermc.io/paper/getting-started/), [Aikar's flags](https://docs.papermc.io/paper/aikars-flags/), [Configuration](https://docs.papermc.io/paper/reference/configuration/), [Anti-Xray](https://docs.papermc.io/paper/anti-xray/), [Basic troubleshooting](https://docs.papermc.io/paper/basic-troubleshooting/), [Updating](https://docs.papermc.io/paper/updating/).
- Minecraft Wiki: [server.properties](https://minecraft.wiki/w/Server.properties), [RCON](https://minecraft.wiki/w/RCON), [Query](https://minecraft.wiki/w/Query), [Server List Ping](https://minecraft.wiki/w/Java_Edition_protocol/Server_List_Ping), [Commands](https://minecraft.wiki/w/Commands), [Advancement](https://minecraft.wiki/w/Advancement), [Statistics](https://minecraft.wiki/w/Statistics), [Tutorials/Setting up a server](https://minecraft.wiki/w/Tutorial:Setting_up_a_server).
- EULA: https://aka.ms/MinecraftEULA — hay que escribir `eula=true` en `eula.txt`; debe ser una acción explícita del usuario.
- Comunidad: [PaperMC Discord/Forums](https://forums.papermc.io/), [itzg/docker-minecraft-server](https://docker-minecraft-server.readthedocs.io/) (excelente referencia de automatización: variables, descarga de Paper/Modrinth, RCON), [YouHaveTrouble/minecraft-optimization](https://github.com/YouHaveTrouble/minecraft-optimization) (guía de optimización de config), [Spigot/Paper timings → spark](https://spark.lucko.me/).

## Requisitos
- Paper 1.20.5+ requiere **Java 21**; 1.17–1.20.4 Java 17; ≤1.16 Java 8/11. Recomendado: Temurin/Adoptium (`apt install temurin-21-jre` desde repo Adoptium) o `openjdk-21-jre-headless` de Ubuntu.
- RAM: `Xmx` = RAM física disponible − 1–1.5 GB (el JVM usa memoria fuera del heap). `Xms` = `Xmx` con Aikar.
- Usuario dedicado sin shell (`minecraft`), nunca root.

## Comando de arranque (Paper + Aikar's flags)
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
Con `Xmx ≥ 12G` Aikar recomienda `G1NewSizePercent=40`, `G1MaxNewSizePercent=50`, `G1HeapRegionSize=16M`, `G1ReservePercent=15`, `InitiatingHeapOccupancyPercent=20`.
El panel generará estos flags con una plantilla ("Aikar", "Básico", "Personalizado").

## Archivos que gestiona el panel
| Archivo | Formato | Notas |
|---|---|---|
| `eula.txt` | properties | `eula=true` |
| `server.properties` | properties | Claves relevantes: `server-port`, `motd`, `max-players`, `online-mode`, `white-list`, `enforce-whitelist`, `difficulty`, `gamemode`, `pvp`, `view-distance`, `simulation-distance`, `level-name`, `level-seed`, `enable-rcon`, `rcon.port`, `rcon.password`, `enable-query`, `query.port`, `spawn-protection`, `allow-flight`, `enforce-secure-profile`. Ver esquema en `internal/mc/properties_schema.go`. |
| `whitelist.json` | `[{"uuid","name"}]` | Recargar con `whitelist reload`. |
| `ops.json` | `[{"uuid","name","level":1-4,"bypassesPlayerLimit"}]` | Preferir comandos `op/deop`. |
| `banned-players.json` | `[{"uuid","name","created","source","expires","reason"}]` | |
| `banned-ips.json` | `[{"ip","created","source","expires","reason"}]` | |
| `usercache.json` | `[{"name","uuid","expiresOn"}]` | Mapeo nombre↔uuid. |
| `bukkit.yml`, `spigot.yml` | YAML | Heredados. |
| `config/paper-global.yml` | YAML | Config global de Paper (1.19+). |
| `config/paper-world-defaults.yml`, `<world>/paper-world.yml` | YAML | Config por mundo. |
| `plugins/*.jar`, `plugins/<Plugin>/config.yml` | | Los plugins se cargan al arrancar; la mayoría no soporta hot-reload (evitar `/reload`, Paper lo desaconseja). |
| `logs/latest.log`, `logs/*.log.gz` | texto | Rotación diaria hecha por el servidor. |
| `world/`, `world_nether/`, `world_the_end/` | Anvil/NBT | Backup con `save-off` → `save-all flush` → tar → `save-on`. |
| `world/advancements/<uuid>.json` | JSON | `{"minecraft:story/mine_stone":{"criteria":{...},"done":true}, "DataVersion":N}` |
| `world/stats/<uuid>.json` | JSON | `{"stats":{"minecraft:custom":{"minecraft:play_time":N,...},"minecraft:mined":{...}},"DataVersion":N}`. `play_time` en ticks (20/s). |
| `world/playerdata/<uuid>.dat` | NBT gzip | Inventario, posición, vida. Fase posterior. |

## Comandos que usará el panel (por stdin o RCON)
`stop`, `save-all [flush]`, `save-off`, `save-on`, `list`, `say <msg>`, `tell <p> <msg>`, `tellraw @a <json>`, `title @a title <json>`, `kick <p> [razón]`, `ban <p> [razón]`, `pardon <p>`, `ban-ip`, `op <p>`, `deop <p>`, `whitelist add|remove|list|reload|on|off`, `tps` (Paper), `gamemode`, `time set`, `weather`, `difficulty`, `plugins` (Bukkit), `version`, `paper reload` (solo config), `restart` (Paper, ejecuta `restart-script` de spigot.yml — no lo usaremos, el daemon reinicia).

## Líneas de log a parsear (Paper 1.21+)
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
Formato de prefijo Paper: `[HH:MM:SS LEVEL]:` (vanilla usa `[HH:MM:SS] [Server thread/INFO]:`); el parser debe aceptar ambos. Los nombres de logros vienen traducidos según idioma del servidor; el dato fiable es `world/advancements/<uuid>.json`.

## Apagado y reinicio seguros
1. `say Servidor reiniciando en 30s` (aviso configurable).
2. `stop` por stdin → Paper guarda mundos y jugadores.
3. Esperar hasta 60 s la salida del proceso; si no, `SIGTERM`; tras 15 s más, `SIGKILL` (riesgo de corrupción: solo último recurso).
4. Nunca `kill -9` como primera opción; nunca hacer backup con el servidor escribiendo (usar `save-off`).

## Seguridad
- `online-mode=true` salvo proxy (Velocity) delante con `velocity-support`.
- RCON solo en `127.0.0.1` con contraseña aleatoria generada por el panel.
- Panel detrás de HTTPS (reverse proxy Caddy/nginx o TLS integrado); no exponer 25575 ni el panel sin auth a Internet.
- Firewall: `ufw allow 25565/tcp` solo para los puertos de juego.
