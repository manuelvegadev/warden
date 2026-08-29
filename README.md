# Warden

[![CI](https://github.com/manuelvegadev/warden/actions/workflows/ci.yml/badge.svg)](https://github.com/manuelvegadev/warden/actions/workflows/ci.yml)

> Name chosen in `docs/naming.md`: project **Warden**, daemon **`wardend`**, panel **beacon** (the name "Beacon" is still under consideration for the panel).

A simple, useful panel to create and manage **multiple instances** of Minecraft servers (Java Edition, starting with **PaperMC**) on Ubuntu, in the spirit of Pterodactyl / Crafty Controller but much lighter. Includes plugin installation from Hangar and Modrinth ("like Prism Launcher, but for servers").

## Components

| | Dir | Technology | Runs on |
|---|---|---|---|
| **wardend** (daemon) | [`wardend/`](wardend/) | Go, single binary, `sudo ./wardend install` sets up `systemd` | The Ubuntu box hosting the servers |
| **Beacon** (panel) | [`beacon/`](beacon/) | Next.js 16 + React 19 + Tailwind 4 + shadcn/ui + Better Auth (pnpm) | Container (`ghcr.io/manuelvegadev/warden-beacon`): next to the daemon via `wardend install`, or Dokploy |

The browser connects to the daemon (REST + WebSocket with JWT); the panel only serves the UI. See [`docs/architecture.md`](docs/architecture.md).

## Target features
- Create instances: pick Paper version and build (Fill v3 API), memory, JVM flags (Aikar), port, EULA.
- Start / stop / restart / autostart / restart on crash.
- Live console and command sending.
- `server.properties` with schema, whitelist, ops, bans, config file editor.
- Plugins: search Hangar and Modrinth, install, update, enable/disable, upload jar.
- Per-instance resources: CPU, RAM, disk, network, TPS.
- Players: online, history, advancements, statistics, messages, kick/ban.
- Backups and scheduled tasks.

## Install (Ubuntu with systemd)
```bash
curl -fsSL https://github.com/manuelvegadev/warden/releases/latest/download/wardend-linux-amd64 -o wardend
chmod +x wardend && sudo ./wardend install     # interactive; offers to run the Beacon panel with Docker
```
Re-run with a newer binary to upgrade (`sudo ./wardend install --yes` keeps the configuration). Details, TLS modes and Dokploy in [`docs/deploy.md`](docs/deploy.md).

## Documentation
- [`docs/research.md`](docs/research.md) — research on alternatives and languages.
- [`docs/architecture.md`](docs/architecture.md) — architecture, monorepo layout, flows.
- [`docs/api.md`](docs/api.md) — **REST + WebSocket API specification** of the daemon.
- [`docs/external-apis.md`](docs/external-apis.md) — Fill v3 (Paper), Hangar, Modrinth, Mojang (verified).
- [`docs/minecraft-admin.md`](docs/minecraft-admin.md) — Paper server administration reference (files, commands, flags, logs, security).
- [`docs/adr/`](docs/adr/) — decisions: [001 Go](docs/adr/001-backend-language.md) · [002 Web](docs/adr/002-web-interface.md) · [003 Monolith](docs/adr/003-single-binary-daemon.md) · [004 MC integration](docs/adr/004-minecraft-integration.md) · [005 Jar/plugin sources](docs/adr/005-jar-and-plugin-sources.md) · [006 Multi-instance](docs/adr/006-multi-instance.md) · [007 Separate Next.js panel](docs/adr/007-separate-nextjs-panel.md) · [008 BFF auth](docs/adr/008-bff-authentication.md) · [009 Better Auth](docs/adr/009-better-auth.md) · [010 Managed Java runtimes](docs/adr/010-managed-java-runtimes.md) · [011 Native TLS](docs/adr/011-daemon-native-tls.md) · [012 Beacon container](docs/adr/012-beacon-container.md)
- [`docs/security.md`](docs/security.md) — authentication and panel ↔ daemon hardening.
- [`docs/naming.md`](docs/naming.md) — monorepo and name proposals.
- [`docs/design.md`](docs/design.md) — typography (Google Sans Code for consoles, line-height 1.1) and theme conventions.
- [`docs/tooling.md`](docs/tooling.md) — MCP servers and skills installed for assisted development.
- [`docs/deploy.md`](docs/deploy.md) — **deployment**: wardend on Ubuntu (systemd, TLS modes), Beacon on Dokploy.
- [`docs/roadmap.md`](docs/roadmap.md)

## Contributing
See [`CONTRIBUTING.md`](CONTRIBUTING.md): English everywhere, Conventional Commits, small scoped commits.

## Development
```bash
# wardend (daemon)
cd wardend && make run                      # http://localhost:8080/api/v1/health
# Beacon (panel)
cp beacon/.env.example beacon/.env.local     # fill in BETTER_AUTH_SECRET and WARDEND_PANEL_KEY
cd beacon && pnpm install && pnpm auth:migrate && pnpm dev   # http://localhost:3000
```
For wardend to accept Beacon's JWTs locally: `WARDEND_PANEL_JWKS_URL=http://localhost:3000/api/auth/jwks WARDEND_PANEL_ISSUER=http://localhost:3000 make run`.
