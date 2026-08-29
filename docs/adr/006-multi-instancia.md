# ADR-006: Modelo multi-instancia

Fecha: 2026-08-28 · Estado: aceptada

## Decisión
- Una **instancia** = un directorio autocontenido bajo `<data>/servers/<id>/` con:
  - `instance.json` — manifiesto (nombre, software, versión MC, build, jar, JVM, puertos, autostart, plugins instalados).
  - `server/` — el directorio real del servidor (jar, `server.properties`, `world/`, `plugins/`, `logs/`…).
  - `backups/` — tarballs del mundo.
- `id` es un slug estable (`survival-2026`), único; el nombre visible se puede cambiar.
- El daemon asigna puertos: valida que `server-port` y `rcon.port` no choquen con otras instancias ni con puertos en uso.
- Cada instancia corre en su propia goroutine de supervisión con máquina de estados: `stopped → starting → running → stopping → stopped` (+ `crashed`). Política de reinicio configurable (`never` / `on-crash` con backoff / `always`).
- Límite opcional de memoria por instancia se traduce a `-Xms/-Xmx`; el daemon avisa si la suma de `Xmx` supera la RAM física − 1.5 GB.
- Las instancias son independientes: crear/borrar una no afecta a las demás. Borrar mueve el directorio a `<data>/trash/` durante 7 días.
- Java: se detecta `java` en `PATH` y se puede fijar por instancia (`javaPath`) para tener varias JVM (Paper 1.20.5+ requiere Java 21).
