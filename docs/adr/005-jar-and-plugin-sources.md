# ADR-005: Sources for downloading servers and plugins

Date: 2026-08-28 · Status: accepted

## Context
We want to create instances from the UI ("like Prism Launcher"): choose software (Paper first), Minecraft version, build, and then install plugins by searching a catalog. Everything was verified with real calls on 2026-08-28 (see `docs/external-apis.md`).

## Decision
- **Server**: PaperMC **Fill v3** (`https://fill.papermc.io/v3`). Returns versions, builds, channel (`STABLE`/`BETA`/`ALPHA`/`RECOMMENDED`), direct URL and `sha256`. The hash is verified after download. Extensible "provider" design to later add Purpur, Fabric, Vanilla.
- **Plugins**: two providers behind a single `PluginSource` interface:
  1. **Hangar** (`https://hangar.papermc.io/api/v1`) — PaperMC's official repository. Filter `platform=PAPER`, `version=<mc>`; each version includes `downloads.PAPER.downloadUrl` + `sha256Hash` + `pluginDependencies`.
  2. **Modrinth** (`https://api.modrinth.com/v2`) — larger catalog. `facets=[["project_type:plugin"],["categories:paper"],["versions:<mc>"]]`; versions with `loaders=["paper"]`, files with `url` + `hashes.sha512` + `primary`.
- Installed plugins are recorded in `instance.json` (`plugins[]` with source, project id, version, hash) so that "update available" can be shown.
- SpigotMC has no official download API (uses Cloudflare); it is out of scope. **Manually uploading a .jar** is also allowed.
- All outgoing requests use `User-Agent: warden/<ver> (<contact>)`, required by Fill and Modrinth. Modrinth limits to 300 req/min per IP.

## Consequences
- Listings must be cached (e.g. 10 min) so the UI does not hammer the APIs.
- Accepting the Mojang EULA is an explicit user action in the UI (writes `eula=true` to `eula.txt`); it is not accepted automatically.
