# Research

Date: 2026-08-28

## 1. How the existing alternatives are built

| Panel | Backend | UI | Isolation | Notes |
|---|---|---|---|---|
| **Pterodactyl** | Panel in PHP (Laravel) + *Wings* daemon in **Go** | Web (React) | Docker required | Multi-node, multi-game. Panel + Wings use ~1.5–2 GB RAM idle. Reference architecture: separate daemon exposing REST + WebSocket for console/stats. |
| **Pelican Panel** | Fork of Pterodactyl (PHP + Go) | Web | Docker | Same architecture, more active maintenance. |
| **PufferPanel** | **Go** (monolith) | Web (Vue) | Optional | Very light, per-game template system. |
| **Crafty Controller** | **Python** (Tornado), monolith | Web | No Docker: `fork`s the Java process and drives it via stdin/stdout | Minecraft only, single node, 300–400 MB RAM. The closest to what we want. |
| **MCSManager** | **Node.js** (separate web + daemon) | Web | No Docker (optional) | 100–200 MB RAM. Native processes. |
| **AMP (CubeCoders)** | C# | Web | Optional | Commercial. |

### Conclusions
- All of them use a **web interface**. None is native. It makes sense: the server is headless on Ubuntu and is managed from any device.
- The serious daemons (Wings, PufferPanel) are written in **Go**: static binary, good process handling and concurrency, easy to install as a `systemd` service.
- The Minecraft-only panels (Crafty, MCSManager) **do not use Docker**: they launch `java -jar server.jar` directly and talk to it over **stdin/stdout**. Simpler and sufficient for a self-hosted server.
- The common pattern: **REST API for actions + WebSocket for console and real-time metrics**.

Sources: [Pterodactyl Wings architecture](https://mintlify.wiki/pterodactyl/wings/concepts/architecture), [deepwiki pterodactyl/wings](https://deepwiki.com/pterodactyl/wings), [Pterodactyl vs Crafty vs MCSManager 2026](https://mineguard.pro/en/blog/pterodactyl-vs-crafty-vs-mcsmanager-2026), [Open Source Game Server Panels Compared 2026](https://catalystctl.com/blog/open-source-game-server-panels/), [Pufferpanel vs Crafty](https://www.saashub.com/compare-pufferpanel-vs-crafty-controller), [Pterodactyl vs AMP vs Crafty](https://www.bigiron.cc/guides/pterodactyl-vs-amp-vs-crafty-controller).

## 2. Ways to interact with a Minecraft Java server

| Mechanism | What it provides | Requirements | Intended use |
|---|---|---|---|
| **Process stdin/stdout** | Full console, run any command (`say`, `whitelist add`, `stop`…), see joins/leaves/chat/advancements in the log | Being the parent process (the daemon launches it) | **Primary**. Free if we are the one launching `java`. |
| **RCON** (TCP, port 25575) | Run commands and receive the response as text | `enable-rcon=true` + `rcon.password` in `server.properties` | Secondary: get the *response* of a command (e.g. `list`) synchronously, without parsing the log. |
| **Server List Ping** (TCP, game port) | MOTD, version, online/max players and a sample of names, latency | None | Quick server status and online players, even if we are not the process parent. |
| **Query** (UDP, GameSpy4) | Full player list, plugins, map | `enable-query=true` | Optional; more fragile than Ping. |
| **World files** | `world/advancements/<uuid>.json` (advancements), `world/stats/<uuid>.json` (statistics), `usercache.json` (uuid→name), `whitelist.json`, `ops.json`, `banned-players.json`, `server.properties` | Disk access | Advancements, statistics, and config management. Note: the server saves these files periodically and on `save-all`. |
| **Logs** (`logs/latest.log`) | Event history | Disk access | Rebuild connection history when the daemon was not listening. |

Sources: [RCON – Minecraft Wiki](https://minecraft.wiki/w/RCON), [mctools docs (RCON/Query/Ping)](https://mctools.readthedocs.io/), [mcipc](https://github.com/conqp/mcipc), [Advancement – Minecraft Wiki](https://minecraft.wiki/w/Advancement).

### Parseable log events (vanilla/Paper format)
```
[HH:MM:SS] [Server thread/INFO]: Done (12.345s)! For help, type "help"
[HH:MM:SS] [Server thread/INFO]: Steve joined the game
[HH:MM:SS] [Server thread/INFO]: Steve left the game
[HH:MM:SS] [Server thread/INFO]: <Steve> hola
[HH:MM:SS] [Server thread/INFO]: Steve has made the advancement [Stone Age]
[HH:MM:SS] [Server thread/INFO]: There are 2 of a max of 20 players online: Steve, Alex
```

## 3. Resource metrics on Linux

- **CPU and RAM of the Java process**: `/proc/<pid>/stat` and `/proc/<pid>/status`. In Go: `gopsutil` (`process.NewProcess(pid).CPUPercent()`, `.MemoryInfo()`).
- **Disk**: size of the instance directory (`filepath.Walk`) + free space on the volume (`disk.Usage`).
- **Network**: Linux does not expose per-process traffic without eBPF/`nethogs`. Options:
  1. System/interface counters (`/proc/net/dev`) — simple, approximate (with a single instance, practically all traffic belongs to the server).
  2. Run the instance in its own **cgroup v2** (`systemd-run --scope` or create `/sys/fs/cgroup/mc-<id>/`) — gives exact CPU/RAM and allows limits; per-cgroup network requires eBPF.
  3. Docker (`docker stats`) — gives everything including network, at the cost of more complexity.
  
  Initial decision: `/proc` + gopsutil, network at interface level. cgroups as a future improvement.

## 4. Languages evaluated for the daemon

| | Go | Rust | Java/Kotlin | Node.js | Python |
|---|---|---|---|---|---|
| Single binary without runtime | ✅ | ✅ | ❌ (needs a JVM, though one is already installed for MC) | ❌ | ❌ |
| Child process / stdin-stdout handling | Excellent (`os/exec`) | Good (`tokio::process`) | Acceptable (`ProcessBuilder`) | Good | Good |
| HTTP + WebSocket | stdlib + `gorilla/websocket` or `nhooyr` | `axum` + `tokio-tungstenite` | Spring/Javalin | Express/Fastify + `ws` | FastAPI |
| System metrics | `gopsutil` | `sysinfo` | OSHI | `systeminformation` | `psutil` |
| RCON / Ping | `gorcon/rcon`, `go-mc` | `rcon` crate, `mcping` | several | `rcon-client`, `minecraft-server-util` | `mctools`, `mcipc` |
| Embedding the web UI in the binary | `embed` (stdlib) | `rust-embed` | JAR resources | ❌ | ❌ |
| Daemon RAM usage | ~20–40 MB | ~10–20 MB | ~150–300 MB | ~80–150 MB | ~100–200 MB |
| Development speed | High | Medium (learning curve) | Medium | High | High |
| Precedent in the ecosystem | Wings, PufferPanel | — | — | MCSManager | Crafty |

**Go** is the sweet spot: it is what the reference daemons use, it yields a static binary for `systemd`, and iteration is fast. **Rust** would be equally valid if learning it is a priority, but it lengthens development. **Java** has the advantage of sharing the JVM with the server and being able to read NBT with mature libraries, but the daemon would weigh more than Crafty's entire panel.

## 5. Interface: web vs native

- Web: reachable from PC/mobile without installing anything, it is what every panel does, and live console + resource charts are trivial with WebSocket + a charting library.
- Native (Tauri/Electron/JavaFX): adds a client app that must be distributed and maintained, and it would need the same API anyway. Discarded; a PWA covers the "app on the phone" case.
