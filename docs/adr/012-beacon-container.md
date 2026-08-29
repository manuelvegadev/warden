# ADR-012: Beacon is a container image, optionally run by the daemon's installer

**Status**: accepted (2026-08-29). Amends ADR-007 (which assumed Dokploy only).

## Context
ADR-007 chose a separate Next.js panel deployed as a Docker container on Dokploy. Real
deployments showed two more shapes: a homelab box that runs both pieces, and operators who
want "one command" installs. The panel also baked the browser-facing WebSocket URL into the
image at build time, so every deployment needed its own build.

## Decision
- Beacon is published as one image (`ghcr.io/manuelvegadev/warden-beacon`, built by CI on
  `main`). Everything deployment-specific is runtime environment (`deploy/beacon.env.example`),
  including `WARDEND_PUBLIC_WS_URL`, which the dynamic dashboard layout hands to the browser.
- The database schema is migrated at container start (`instrumentation.ts`), so a fresh volume
  works without a CLI step.
- `wardend install` offers to run that image next to the daemon when Docker is present: it
  writes `/etc/warden/beacon.env` (keeping `BETTER_AUTH_SECRET` stable, as it encrypts the JWKS
  keys in the volume), starts `warden-beacon` with `--add-host host.docker.internal:host-gateway`,
  and the daemon's self-signed certificate always carries `host.docker.internal` as a SAN so the
  panel can trust it.
- Dokploy (ADR-007) and the single-host compose file remain supported shapes of the same image.

## Consequences
- Three documented topologies (installer-managed container, Dokploy, compose) share one env
  contract; `deploy/beacon.env.example` is its reference and `docs/deploy.md` the guide.
- Rotating `BETTER_AUTH_SECRET` invalidates the stored JWKS keys (delete the `jwks` rows or
  the volume); the installer avoids this by reusing the secret.
- The daemon re-fetches the panel's JWKS on an unknown key id, so panel key rotation or
  reinstalls do not lock users out until the hourly refresh.
