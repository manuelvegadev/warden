# ADR-003: Monolito de un solo binario, sin Docker obligatorio

Fecha: 2026-08-28 · Estado: aceptada, **modificada por ADR-007** (el binario ya no incluye la UI; sigue siendo un único daemon con API + supervisor)

## Contexto
Pterodactyl separa panel y daemon y mete cada servidor en Docker (multi-nodo, multi-tenant). Crafty/MCSManager lanzan el proceso Java directamente. Nuestro caso: un Ubuntu, un administrador, una o pocas instancias.

## Decisión
- **Un binario `mcd`** que contiene: supervisor de instancias, API, WebSocket y UI.
- Cada instancia es un directorio (`/var/lib/mc-server-gui/servers/<id>/`) con un `instance.json` (jar, versión, flags JVM, memoria, puerto, autostart) y el proceso `java` se lanza con `os/exec`, como proceso hijo del daemon.
- Sin Docker. El aislamiento vendrá de correr el daemon como usuario dedicado (`minecraft`) y, en el futuro, cgroups v2 por instancia para límites de CPU/RAM.
- Persistencia del panel en **SQLite** (usuarios, sesiones, historial de métricas, eventos de jugadores).
- Instalación: unidad `systemd` `mc-server-gui.service`.

## Consecuencias
- Si el daemon se reinicia, el servidor MC hijo muere con él (salvo que lo desacoplemos). Aceptable al inicio; mitigación futura: lanzar la instancia como `systemd-run --scope` y reconectar, o hacer que el daemon haga `stop` limpio antes de reiniciarse.
- Un solo nodo. Si algún día se quiere multi-nodo, se separa el supervisor en un servicio con la misma API interna.
