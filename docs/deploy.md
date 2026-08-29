# Deployment

Two pieces, two places:

| | Where | How |
|---|---|---|
| **wardend** | The Ubuntu box that runs the Minecraft servers | Single binary + systemd (`deploy/`), or the optional container (`wardend/Dockerfile`) |
| **Beacon** | Dokploy (or any Docker host), behind Dokploy's Traefik with HTTPS | `beacon/Dockerfile` |

The browser talks to **both**: Beacon serves the UI and proxies REST calls to wardend server-to-server (BFF, ADR-008), while the console/metrics **WebSocket goes straight from the browser to wardend**. That is why wardend terminates TLS itself and needs a public HTTPS endpoint (ADR-011): a browser page served over HTTPS may only open `wss://` sockets to a certificate it trusts.

```
browser ──HTTPS──▶ Beacon (Dokploy/Traefik) ──HTTPS (JWT + X-Panel-Key)──▶ wardend :8443
   └──────────────── WSS (JWT in first message) ───────────────────────────▶ wardend :8443
```

## 1. wardend on Ubuntu

The binary installs itself. The one-liner served by the landing page (`landing/public/install.sh`)
picks the right architecture, verifies the download against the release's `SHA256SUMS` and runs the
installer; flags after `--` go to `wardend install`:

```bash
curl -fsSL https://warden.manuelvega.dev/install.sh | sudo bash              # first install (interactive)
curl -fsSL https://warden.manuelvega.dev/install.sh | sudo bash -s -- --yes  # upgrade, keep the configuration
```

Or by hand:

```bash
# on the box (amd64; use wardend-linux-arm64 on ARM)
curl -fsSL https://github.com/manuelvegadev/warden/releases/latest/download/wardend-linux-amd64 -o wardend
chmod +x wardend && sudo ./wardend install
```

Releases are cut from tags (`git tag v0.1.0 && git push --tags`): the workflow attaches `wardend-linux-{amd64,arm64}` with `SHA256SUMS` and pushes the container images tagged with the version. For an unreleased build: `cd wardend && make linux && scp bin/wardend-linux-amd64 box:wardend`.

`wardend install` is interactive: if Docker is present it first offers to run the **Beacon panel as a container on the same box** (pulling `ghcr.io/manuelvegadev/warden-beacon`, or the image given with `--beacon-image`), then asks for the data directory, port, contact, Beacon URL, panel key (a random one is proposed) and the TLS mode, and creates the `warden` system user (no shell), `/var/lib/warden`, `/etc/warden/wardend.env` (root-only), the hardened systemd unit, copies itself to `/usr/local/bin/wardend`, enables and starts the service and waits for `/api/v1/health`. Command output goes to `/var/log/warden/install.log`; the terminal only shows each step and a final summary with the values Beacon needs. Re-run it with a newer binary to upgrade (`--yes` reuses the existing configuration without prompting). wardend needs no system Java: runtimes are downloaded per Minecraft version into `/var/lib/warden/java` (ADR-010).

### Environment (`/etc/warden/wardend.env`)

Written by the installer; [`deploy/wardend.env.example`](../deploy/wardend.env.example) documents every variable for manual edits (`systemctl restart wardend` afterwards). The ones that must match the Beacon deployment: `WARDEND_PANEL_ISSUER` (Beacon's public URL; the JWKS is derived from it), `WARDEND_PANEL_KEY` (same value on both sides) and `WARDEND_ALLOWED_ORIGINS` (Beacon's origin, for the WebSocket).

### TLS modes (`WARDEND_TLS`)

| Mode | When | Needs |
|---|---|---|
| `acme` (recommended) | The box has a public DNS name (`mc.example.com`) | `WARDEND_TLS_HOSTS`, `WARDEND_TLS_EMAIL`, ports 443 (+ 80 for the redirect/challenge listener, `WARDEND_TLS_HTTP_ADDR`; set it empty if 80 is taken). Certificates from Let's Encrypt are cached in `/var/lib/warden/tls/acme` and renewed automatically. |
| `files` | You already have a certificate (certbot, a wildcard, your own CA) | `WARDEND_TLS_CERT`, `WARDEND_TLS_KEY` (PEM). Restart wardend after renewal. |
| `self-signed` | LAN or testing, no public name | Optional `WARDEND_TLS_HOSTS` (extra SANs: LAN name/IP). The cert is generated once at `/var/lib/warden/tls/wardend.crt`; **the browser must trust it** (import it into the OS/browser trust store once) and Beacon must too (§ self-signed below). Supported, but `acme` is the path without manual trust steps. |
| `off` | Only behind a reverse proxy (Caddy/nginx) that terminates TLS on the same box | Nothing — but then point Beacon and the browser at the proxy's HTTPS URL. |

Firewall: open the wardend port and the game ports only (`ufw allow 8443/tcp`, `ufw allow 25565/tcp` …). Never expose wardend without TLS on the internet: the JWT would travel in clear.

## 2. Beacon

Beacon is a container image (`beacon/Dockerfile`, published by CI as `ghcr.io/manuelvegadev/warden-beacon`). One image serves every deployment: everything, including the browser-facing WebSocket URL, is runtime environment (ADR-012) — [`deploy/beacon.env.example`](../deploy/beacon.env.example) lists and explains each variable. The database schema is migrated automatically at startup.

### 2a. Next to the daemon (`wardend install` does this for you)

```bash
cp deploy/beacon.env.example beacon.env && nano beacon.env
# self-signed wardend only: add  -v /var/lib/warden/tls/wardend.crt:/certs/wardend.crt:ro  and NODE_EXTRA_CA_CERTS in the env file
docker run -d --name warden-beacon --restart unless-stopped \
  --add-host host.docker.internal:host-gateway \
  -p 3000:3000 -v warden-beacon-data:/data --env-file beacon.env \
  ghcr.io/manuelvegadev/warden-beacon:latest
```

When the installer runs Beacon it writes these variables to `/etc/warden/beacon.env` (root-only; `BETTER_AUTH_SECRET` is kept across re-runs because it encrypts the JWKS keys stored in the volume) and starts the container with `--env-file`. `host.docker.internal` is how the container reaches wardend on the host; with `WARDEND_TLS=self-signed` that name must be one of the certificate's SANs (`WARDEND_TLS_HOSTS`) — the installer adds it. To expose the panel on the internet put it behind a reverse proxy with HTTPS (Caddy, Traefik) and set `BETTER_AUTH_URL` to that public URL (it is also the issuer wardend verifies).

### 2b. On any Docker host (compose)

[`deploy/beacon.compose.yaml`](../deploy/beacon.compose.yaml) runs the published image with an env file:

```bash
mkdir -p warden-beacon && cd warden-beacon
curl -fsSLO https://github.com/manuelvegadev/warden/raw/main/deploy/beacon.compose.yaml
curl -fsSL  https://github.com/manuelvegadev/warden/raw/main/deploy/beacon.env.example -o beacon.env
nano beacon.env            # BETTER_AUTH_SECRET, BETTER_AUTH_URL, WARDEND_URL, WARDEND_PANEL_KEY, WARDEND_PUBLIC_WS_URL
docker compose -f beacon.compose.yaml up -d
```

Then in wardend's env set `WARDEND_PANEL_ISSUER` to Beacon's URL and the same panel key, and restart wardend. Put the panel behind an HTTPS reverse proxy and use that URL as `BETTER_AUTH_URL`.

What the compose file does for you: pins the image line with `BEACON_TAG` (default `latest`; set `0.2` for predictable upgrades), runs an init process as PID 1 so `docker stop` is immediate, health-checks `/api/auth/ok`, drops all capabilities and `no-new-privileges`, caps log files, and keeps SQLite in the `beacon-data` volume (include it in backups). The image itself is built from the repo root with a root `.dockerignore`, runs as the unprivileged `beacon` user and declares the same `HEALTHCHECK`.

### 2c. On Dokploy

1. Create an application from the image `ghcr.io/manuelvegadev/warden-beacon:latest` (or Dockerfile build type with build path `.` and Dockerfile `beacon/Dockerfile` — the panel depends on `packages/ui`, ADR-014).
2. Environment: the variables from `deploy/beacon.env.example` with the daemon's public URL: `WARDEND_URL=https://mc.example.com:8443`, `WARDEND_PUBLIC_WS_URL=wss://mc.example.com:8443`, `BETTER_AUTH_URL=https://beacon.example.com`.
3. Mount a volume at `/data`, add the domain with HTTPS (Let's Encrypt via Traefik), deploy.
4. First visit: the first account created becomes admin; with `BEACON_OPEN_SIGNUP=false` further users are created from **Settings → Account** by an admin.

Then in wardend's env set `WARDEND_PANEL_ISSUER=https://beacon.example.com` and the same panel key, and restart wardend. `journalctl -u wardend` shows `auth: jwks loaded` on the first panel request.

### Self-signed wardend with Beacon elsewhere

Copy `/var/lib/warden/tls/wardend.crt` into Beacon's volume (`/data/wardend.crt`) and set `NODE_EXTRA_CA_CERTS=/data/wardend.crt` so the BFF trusts it. Browsers must accept the certificate once (`https://<daemon>/api/v1/health`). `acme` avoids all of this.

## 3. Everything on one Docker host (LAN / homelab)

[`deploy/compose.yaml`](../deploy/compose.yaml) runs both on a single box without `sudo`: wardend with a self-signed certificate (SANs: the compose service name plus `HOST`) and Beacon over plain HTTP on port 3000. Beacon trusts the certificate through the shared volume (`NODE_EXTRA_CA_CERTS`), wardend fetches the JWKS container-to-container (`WARDEND_PANEL_JWKS_URL=http://beacon:3000/api/auth/jwks`) while the issuer stays the browser-facing URL.

```bash
cp deploy/compose.env.example deploy/.env      # HOST (name/IP the browser uses), PANEL_KEY, BETTER_AUTH_SECRET
docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --build
```

Then: open `https://<HOST>:8443/api/v1/health` once in each browser and accept the certificate (or import it from the `warden-data` volume, `/data/tls/wardend.crt`), and create the first account at `http://<HOST>:3000`. Beacon migrates its database schema on startup (`instrumentation.ts`), so no CLI step is needed. Game ports are published per instance in the compose file (`25565` by default).

For an internet-facing box use §1–2 instead: ACME certificates and Beacon behind Dokploy's HTTPS.

## 4. Landing page (GitHub Pages)

`landing/` is a static Astro site published to **https://warden.manuelvega.dev** by
`.github/workflows/pages.yml` on every push to `main` that touches `landing/` or `packages/ui/`
(or manually from Actions → Pages → Run workflow). One-time setup:

1. Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. DNS at the domain registrar: `CNAME warden → manuelvegadev.github.io` (for an apex domain use
   the `A`/`AAAA` records from GitHub's Pages docs instead).
3. **Settings → Pages → Custom domain**: `warden.manuelvega.dev`, then tick *Enforce HTTPS* once the
   certificate is issued (minutes to an hour). `landing/public/CNAME` keeps the domain across deploys.

Local preview: `pnpm --filter landing dev` (http://localhost:3100); `pnpm --filter landing build`
writes the site to `landing/dist` (`pnpm --filter landing preview` serves it).

## 5. Checklist

- `curl https://mc.example.com:8443/api/v1/health` → `{"ok":true,…}`
- Beacon → Instances loads (BFF ↔ wardend OK); an instance console streams (WSS OK).
- `journalctl -u wardend` has no `origin not allowed` / `jwks` errors.
- Backups schedule enabled on each instance (Backups tab).
