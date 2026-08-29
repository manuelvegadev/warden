# ADR-003: Single-binary monolith, no mandatory Docker

Date: 2026-08-28 · Status: accepted, **amended by ADR-007** (the binary no longer includes the UI; it remains a single daemon with API + supervisor)

## Context
Pterodactyl separates panel and daemon and puts each server in Docker (multi-node, multi-tenant). Crafty/MCSManager launch the Java process directly. Our case: one Ubuntu box, one administrator, one or a few instances.

## Decision
- **A single `wardend` binary** containing: instance supervisor, API, WebSocket and UI.
- Each instance is a directory (`/var/lib/warden/servers/<id>/`) with an `instance.json` (jar, version, JVM flags, memory, port, autostart), and the `java` process is launched with `os/exec` as a child process of the daemon.
- No Docker. Isolation comes from running the daemon as a dedicated user (`warden`) and, in the future, cgroups v2 per instance for CPU/RAM limits.
- Panel persistence in **SQLite** (users, sessions, metrics history, player events).
- Installation: `systemd` unit `warden.service`.

## Consequences
- If the daemon restarts, the child MC server dies with it (unless we decouple it). Acceptable at first; future mitigation: launch the instance as `systemd-run --scope` and reconnect, or have the daemon perform a clean `stop` before restarting itself.
- Single node. If multi-node is ever wanted, the supervisor is split into a service with the same internal API.
