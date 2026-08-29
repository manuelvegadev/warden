# ADR-006: Multi-instance model

Date: 2026-08-28 · Status: accepted

## Decision
- An **instance** = a self-contained directory under `<data>/servers/<id>/` with:
  - `instance.json` — manifest (name, software, MC version, build, jar, JVM, ports, autostart, installed plugins).
  - `server/` — the actual server directory (jar, `server.properties`, `world/`, `plugins/`, `logs/`…).
  - `backups/` — world tarballs.
- `id` is a stable, unique slug (`survival-2026`); the display name can be changed.
- The daemon assigns ports: it validates that `server-port` and `rcon.port` do not collide with other instances or with ports in use.
- Each instance runs in its own supervision goroutine with a state machine: `stopped → starting → running → stopping → stopped` (+ `crashed`). Configurable restart policy (`never` / `on-crash` with backoff / `always`).
- An optional per-instance memory limit translates to `-Xms/-Xmx`; the daemon warns if the sum of `Xmx` exceeds physical RAM − 1.5 GB.
- Instances are independent: creating/deleting one does not affect the others. Deleting moves the directory to `<data>/trash/` for 7 days.
- Java: `java` is detected on `PATH` and can be pinned per instance (`javaPath`) to have several JVMs (Paper 1.20.5+ requires Java 21).
