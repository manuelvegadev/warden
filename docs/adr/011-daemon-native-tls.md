# ADR-011: wardend terminates TLS itself

**Status**: accepted (2026-08-29)

## Context
Beacon proxies REST calls to wardend server-to-server (ADR-008), but the console/metrics WebSocket is opened by the browser directly against wardend (`NEXT_PUBLIC_WARDEND_WS_URL`), so the daemon needs an HTTPS endpoint the browser trusts. ADR-008 left the transport open: a reverse proxy on the box, or native TLS.

## Decision
wardend terminates TLS itself, selected by `WARDEND_TLS`:
- `acme` — Let's Encrypt through `golang.org/x/crypto/acme/autocert` (TLS-ALPN-01, certificates cached under `<data>/tls/acme`, optional `:80` listener for redirects/challenges). The recommended mode.
- `files` — operator-provided certificate and key (certbot, wildcard, private CA).
- `self-signed` — generated once into `<data>/tls` for LAN/testing; browsers and Beacon (`NODE_EXTRA_CA_CERTS`) must trust it.
- `off` — only behind a reverse proxy on the same host.

TLS 1.2 is the minimum. The systemd unit grants `CAP_NET_BIND_SERVICE` so `acme` can bind `:443`.

## Alternatives
- **Reverse proxy on the box (Caddy/Traefik)**: works, but adds a second component to install and keep in sync with the daemon for a box whose only job is Minecraft; still available via `off`.
- **Tunnelling the WebSocket through Beacon**: keeps wardend private, but Next.js route handlers cannot proxy WebSockets without a custom server, and every console byte would cross Dokploy.

## Consequences
- wardend needs a public DNS name (or a trusted self-signed cert) and its port open in the firewall; game ports stay separate.
- One more dependency (`x/crypto`), already transitive.
- `docs/deploy.md` is the operator guide; `deploy/wardend.env.example` the variable reference.
