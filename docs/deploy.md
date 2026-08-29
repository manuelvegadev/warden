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

```bash
# on your machine
cd wardend && make linux                      # bin/wardend-linux-amd64
scp bin/wardend-linux-amd64 deploy/* ubuntu-box:/tmp/warden/
# on the box
sudo /tmp/warden/install.sh /tmp/warden/wardend-linux-amd64
sudo nano /etc/warden/wardend.env             # see below
sudo systemctl start wardend && journalctl -u wardend -f
```

`install.sh` creates the `warden` system user (no shell), `/var/lib/warden` (servers, backups, Java runtimes, SQLite, TLS material) and `/etc/warden/wardend.env` (root-only), installs the unit and enables it. Re-run it with a new binary to upgrade; it restarts the service. wardend needs no system Java: runtimes are downloaded per Minecraft version into `/var/lib/warden/java` (ADR-010).

### Environment (`/etc/warden/wardend.env`)

[`deploy/wardend.env.example`](../deploy/wardend.env.example) documents every variable. The ones that must match the Beacon deployment: `WARDEND_PANEL_ISSUER` (Beacon's public URL; the JWKS is derived from it), `WARDEND_PANEL_KEY` (same value on both sides) and `WARDEND_ALLOWED_ORIGINS` (Beacon's origin, for the WebSocket).

### TLS modes (`WARDEND_TLS`)

| Mode | When | Needs |
|---|---|---|
| `acme` (recommended) | The box has a public DNS name (`mc.example.com`) | `WARDEND_TLS_HOSTS`, `WARDEND_TLS_EMAIL`, ports 443 (+ 80 for the redirect/challenge listener, `WARDEND_TLS_HTTP_ADDR`; set it empty if 80 is taken). Certificates from Let's Encrypt are cached in `/var/lib/warden/tls/acme` and renewed automatically. |
| `files` | You already have a certificate (certbot, a wildcard, your own CA) | `WARDEND_TLS_CERT`, `WARDEND_TLS_KEY` (PEM). Restart wardend after renewal. |
| `self-signed` | LAN or testing, no public name | Optional `WARDEND_TLS_HOSTS` (extra SANs: LAN name/IP). The cert is generated once at `/var/lib/warden/tls/wardend.crt`; **the browser must trust it** (import it into the OS/browser trust store once) and Beacon must too (§ self-signed below). Supported, but `acme` is the path without manual trust steps. |
| `off` | Only behind a reverse proxy (Caddy/nginx) that terminates TLS on the same box | Nothing — but then point Beacon and the browser at the proxy's HTTPS URL. |

Firewall: open the wardend port and the game ports only (`ufw allow 8443/tcp`, `ufw allow 25565/tcp` …). Never expose wardend without TLS on the internet: the JWT would travel in clear.

## 2. Beacon on Dokploy

1. Create an application from this repository with **Dockerfile** build type, build path `beacon/`.
2. Build argument: `NEXT_PUBLIC_WARDEND_WS_URL=wss://mc.example.com:8443` (baked into the client bundle; must be the **public** wardend URL the browser can reach).
3. Environment (runtime):

```
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=https://beacon.example.com
DATABASE_PATH=/data/beacon.db
BEACON_OPEN_SIGNUP=false
WARDEND_URL=https://mc.example.com:8443
WARDEND_PANEL_KEY=<same as wardend>
```

[`beacon/.env.example`](../beacon/.env.example) lists every Beacon variable.

4. Mount a volume at `/data` (SQLite + uploaded certs), add the domain `beacon.example.com` with HTTPS (Let's Encrypt via Traefik), deploy.
5. First visit: the first account created becomes admin; with `BEACON_OPEN_SIGNUP=false` further users are created from **Settings → Account** by an admin.

Then in wardend's env set `WARDEND_PANEL_ISSUER=https://beacon.example.com` and the same panel key, and restart wardend. `journalctl -u wardend` shows `jwks loaded` once Beacon is reachable; until then wardend keeps starting but rejects panel requests.

### Self-signed wardend with Beacon in Docker

Copy `/var/lib/warden/tls/wardend.crt` into Beacon's volume (`/data/wardend.crt`) and set `NODE_EXTRA_CA_CERTS=/data/wardend.crt` so the BFF trusts it. Browsers on the LAN must import the same file. `acme` avoids all of this.

## 3. Optional: wardend in a container

```bash
docker build -t wardend ./wardend
docker run -d --name wardend --restart unless-stopped \
  -v warden-data:/data --env-file wardend.env \
  -p 8443:8443 -p 25565:25565 wardend
```

Game ports must be published per instance; the systemd deployment is simpler for a box dedicated to Minecraft.

## 4. Checklist

- `curl https://mc.example.com:8443/api/v1/health` → `{"ok":true,…}`
- Beacon → Instances loads (BFF ↔ wardend OK); an instance console streams (WSS OK).
- `journalctl -u wardend` has no `origin not allowed` / `jwks` errors.
- Backups schedule enabled on each instance (Backups tab).
