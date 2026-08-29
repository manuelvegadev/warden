# Investigación

Fecha: 2026-08-28

## 1. Cómo están construidas las alternativas existentes

| Panel | Backend | UI | Aislamiento | Notas |
|---|---|---|---|---|
| **Pterodactyl** | Panel en PHP (Laravel) + daemon *Wings* en **Go** | Web (React) | Docker obligatorio | Multi-nodo, multi-juego. Panel + Wings consumen ~1.5–2 GB RAM en reposo. Arquitectura de referencia: daemon separado que expone REST + WebSocket para consola/stats. |
| **Pelican Panel** | Fork de Pterodactyl (PHP + Go) | Web | Docker | Misma arquitectura, mantenimiento más activo. |
| **PufferPanel** | **Go** (monolito) | Web (Vue) | Opcional | Muy ligero, sistema de plantillas por juego. |
| **Crafty Controller** | **Python** (Tornado), monolito | Web | Sin Docker: hace `fork` del proceso Java y lo maneja por stdin/stdout | Solo Minecraft, un solo nodo, 300–400 MB RAM. Es lo más parecido a lo que queremos. |
| **MCSManager** | **Node.js** (web + daemon separados) | Web | Sin Docker (opcional) | 100–200 MB RAM. Procesos nativos. |
| **AMP (CubeCoders)** | C# | Web | Opcional | Comercial. |

### Conclusiones
- Todas usan **interfaz web**. Ninguna nativa. Tiene sentido: el servidor es headless en Ubuntu y se administra desde cualquier dispositivo.
- Los daemons serios (Wings, PufferPanel) están en **Go**: binario estático, buen manejo de procesos y concurrencia, fácil de instalar como servicio `systemd`.
- Los paneles solo-Minecraft (Crafty, MCSManager) **no usan Docker**: lanzan `java -jar server.jar` directamente y hablan con él por **stdin/stdout**. Es más simple y suficiente para un servidor propio.
- El patrón común: **API REST para acciones + WebSocket para consola y métricas en tiempo real**.

Fuentes: [Pterodactyl Wings architecture](https://mintlify.wiki/pterodactyl/wings/concepts/architecture), [deepwiki pterodactyl/wings](https://deepwiki.com/pterodactyl/wings), [Pterodactyl vs Crafty vs MCSManager 2026](https://mineguard.pro/en/blog/pterodactyl-vs-crafty-vs-mcsmanager-2026), [Open Source Game Server Panels Compared 2026](https://catalystctl.com/blog/open-source-game-server-panels/), [Pufferpanel vs Crafty](https://www.saashub.com/compare-pufferpanel-vs-crafty-controller), [Pterodactyl vs AMP vs Crafty](https://www.bigiron.cc/guides/pterodactyl-vs-amp-vs-crafty-controller).

## 2. Formas de interactuar con un servidor de Minecraft Java

| Mecanismo | Qué da | Requisitos | Uso previsto |
|---|---|---|---|
| **stdin/stdout del proceso** | Consola completa, ejecutar cualquier comando (`say`, `whitelist add`, `stop`…), ver joins/leaves/chat/logros en el log | Ser el proceso padre (el daemon lo lanza) | **Principal**. Gratis si somos quien lanza el `java`. |
| **RCON** (TCP, puerto 25575) | Ejecutar comandos y recibir la respuesta como texto | `enable-rcon=true` + `rcon.password` en `server.properties` | Secundario: obtener la *respuesta* de un comando (p.ej. `list`) de forma sincrónica, sin parsear el log. |
| **Server List Ping** (TCP, puerto del juego) | MOTD, versión, jugadores online/max y muestra de nombres, latencia | Ninguno | Estado rápido del servidor y jugadores online, aun si no somos el padre del proceso. |
| **Query** (UDP, GameSpy4) | Lista completa de jugadores, plugins, mapa | `enable-query=true` | Opcional; más frágil que Ping. |
| **Archivos del mundo** | `world/advancements/<uuid>.json` (logros), `world/stats/<uuid>.json` (estadísticas), `usercache.json` (uuid→nombre), `whitelist.json`, `ops.json`, `banned-players.json`, `server.properties` | Acceso al disco | Logros, estadísticas, y gestión de configuración. Ojo: el servidor guarda estos archivos periódicamente y al `save-all`. |
| **Logs** (`logs/latest.log`) | Historial de eventos | Acceso al disco | Reconstruir historial de conexiones cuando el daemon no estaba escuchando. |

Fuentes: [RCON – Minecraft Wiki](https://minecraft.wiki/w/RCON), [mctools docs (RCON/Query/Ping)](https://mctools.readthedocs.io/), [mcipc](https://github.com/conqp/mcipc), [Advancement – Minecraft Wiki](https://minecraft.wiki/w/Advancement).

### Eventos parseables del log (formato vanilla/Paper)
```
[HH:MM:SS] [Server thread/INFO]: Done (12.345s)! For help, type "help"
[HH:MM:SS] [Server thread/INFO]: Steve joined the game
[HH:MM:SS] [Server thread/INFO]: Steve left the game
[HH:MM:SS] [Server thread/INFO]: <Steve> hola
[HH:MM:SS] [Server thread/INFO]: Steve has made the advancement [Stone Age]
[HH:MM:SS] [Server thread/INFO]: There are 2 of a max of 20 players online: Steve, Alex
```

## 3. Métricas de recursos en Linux

- **CPU y RAM del proceso Java**: `/proc/<pid>/stat` y `/proc/<pid>/status`. En Go: `gopsutil` (`process.NewProcess(pid).CPUPercent()`, `.MemoryInfo()`).
- **Disco**: tamaño del directorio de la instancia (`filepath.Walk`) + espacio libre del volumen (`disk.Usage`).
- **Red**: Linux no expone tráfico por proceso sin eBPF/`nethogs`. Opciones:
  1. Contadores del sistema/interfaz (`/proc/net/dev`) — simple, aproximado (una sola instancia ⇒ prácticamente todo el tráfico es del server).
  2. Ejecutar la instancia en un **cgroup v2** propio (`systemd-run --scope` o crear `/sys/fs/cgroup/mc-<id>/`) — da CPU/RAM exactas y permite límites; red por cgroup requiere eBPF.
  3. Docker (`docker stats`) — da todo incluido red, a costa de más complejidad.
  
  Decisión inicial: `/proc` + gopsutil, red a nivel de interfaz. cgroups como mejora futura.

## 4. Lenguajes evaluados para el daemon

| | Go | Rust | Java/Kotlin | Node.js | Python |
|---|---|---|---|---|---|
| Binario único sin runtime | ✅ | ✅ | ❌ (necesita JVM, aunque ya está instalada por MC) | ❌ | ❌ |
| Manejo de procesos hijos / stdin-stdout | Excelente (`os/exec`) | Bueno (`tokio::process`) | Aceptable (`ProcessBuilder`) | Bueno | Bueno |
| HTTP + WebSocket | stdlib + `gorilla/websocket` o `nhooyr` | `axum` + `tokio-tungstenite` | Spring/Javalin | Express/Fastify + `ws` | FastAPI |
| Métricas del sistema | `gopsutil` | `sysinfo` | OSHI | `systeminformation` | `psutil` |
| RCON / Ping | `gorcon/rcon`, `go-mc` | crate `rcon`, `mcping` | varias | `rcon-client`, `minecraft-server-util` | `mctools`, `mcipc` |
| Embeber la UI web en el binario | `embed` (stdlib) | `rust-embed` | JAR resources | ❌ | ❌ |
| Consumo de RAM del daemon | ~20–40 MB | ~10–20 MB | ~150–300 MB | ~80–150 MB | ~100–200 MB |
| Velocidad de desarrollo | Alta | Media (curva de aprendizaje) | Media | Alta | Alta |
| Precedente en el ecosistema | Wings, PufferPanel | — | — | MCSManager | Crafty |

**Go** es el punto óptimo: es lo que usan los daemons de referencia, entrega un binario estático para `systemd`, y la iteración es rápida. **Rust** sería igualmente válido si se prioriza aprenderlo, pero alarga el desarrollo. **Java** tiene la ventaja de compartir JVM con el servidor y poder leer NBT con librerías maduras, pero el daemon pesaría más que el propio panel de Crafty.

## 5. Interfaz: web vs nativa

- Web: accesible desde PC/móvil sin instalar nada, es lo que hacen todos los paneles, y la consola en vivo + gráficas de recursos son triviales con WebSocket + una librería de charts.
- Nativa (Tauri/Electron/JavaFX): añade una app cliente que hay que distribuir y mantener, y de todos modos necesitaría la misma API. Descartada; una PWA cubre el caso de "app en el móvil".
