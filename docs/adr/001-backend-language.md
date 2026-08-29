# ADR-001: Go as the language for the daemon and backend

Date: 2026-08-28 · Status: accepted

## Context
We need a daemon that runs on Ubuntu as a service, launches and supervises the server's `java` process, exposes an HTTP/WebSocket API and reads system metrics. Candidates: Go, Rust, Java, Node.js, Python (see `docs/research.md` §4).

## Decision
Use **Go** (1.25+).

## Rationale
- Single static binary: `scp` to the server + a `systemd` unit, no runtime or dependencies.
- `os/exec` + goroutines fit perfectly with "one child process whose stdout is fanned out to N WebSocket clients".
- It is the language of Pterodactyl Wings and PufferPanel: there is reference code for almost everything.
- `embed` allows shipping the compiled web UI inside the same binary.
- Ecosystem: `gopsutil` (metrics), `gorcon/rcon`, `go-mc` (ping/NBT), `chi`/stdlib for HTTP.

## Alternatives considered
- **Rust**: excellent end result, but longer development time; would be reconsidered if the goal were to learn Rust.
- **Java**: the daemon would consume as much as an entire panel; it would only make sense if we wanted to run as a plugin inside the server (Paper), which is not the approach.
- **Node/Python**: require a runtime and more RAM; no clear advantage.

## Consequences
- Go libraries for Minecraft NBT/JSON are less mature than in Java; JSON is enough for advancements and stats, and NBT (`level.dat`, playerdata) is left for later.
