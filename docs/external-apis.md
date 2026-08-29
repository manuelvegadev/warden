# External APIs used

Verified with `curl` on 2026-08-28. All require an identifiable `User-Agent`:
`warden/<version> (<email or URL>)`.

## PaperMC Fill v3 — Paper downloads (plus Velocity, Folia, Waterfall)

Docs: https://docs.papermc.io/misc/downloads-service/ · Swagger: https://fill.papermc.io/swagger-ui/index.html
The old `api.papermc.io/v2` API stopped receiving builds on 2025-12-31: **do not use**.

| Endpoint | Returns |
|---|---|
| `GET /v3/projects/paper` | `{"project":{"id","name"},"versions":{"1.21":["1.21.11","1.21.8",...],"26.2":[...]}}` — grouped by family; includes `-rc`/`-pre`. |
| `GET /v3/projects/paper/versions/{mc}/builds` | Array of builds, newest first. |
| `GET /v3/projects/paper/versions/{mc}/builds/latest` | Latest build. |

Build:
```json
{
  "id": 60, "time": "2025-09-06T21:50:11Z", "channel": "STABLE",
  "commits": [{"sha": "...", "message": "..."}],
  "downloads": {
    "server:default": {
      "name": "paper-1.21.8-60.jar",
      "checksums": {"sha256": "8de7c52c..."},
      "size": 52811717,
      "url": "https://fill-data.papermc.io/v1/objects/<sha256>/paper-1.21.8-60.jar"
    }
  }
}
```
Channels: `ALPHA` < `BETA` < `STABLE` < `RECOMMENDED`. By default the UI only offers `STABLE`/`RECOMMENDED`.
Note: since 2026 Mojang uses `26.x` versioning; Fill reflects it (`26.1.2`, `26.2`).

## Hangar v1 — official PaperMC plugins

Base: `https://hangar.papermc.io/api/v1` · Docs: https://hangar.papermc.io/api-docs · No auth for reads.

| Endpoint | Notes |
|---|---|
| `GET /projects?q=<text>&platform=PAPER&version=<mc>&limit=25&offset=0&sort=-stars` | Search. `result[].namespace.{owner,slug}`, `stats.downloads`, `supportedPlatforms.PAPER[]`, `category`, `avatarUrl`. |
| `GET /projects/{slug}` | Details. |
| `GET /projects/{slug}/versions?platform=PAPER&limit=25` | `result[].{name, channel.name, downloads.PAPER.{downloadUrl, fileInfo.{name,sizeBytes,sha256Hash}}, pluginDependencies.PAPER[], platformDependencies.PAPER[]}` |
| `GET /projects/{slug}/versions/{name}` | Single version. |

Download: use `downloads.PAPER.downloadUrl` (CDN `hangarcdn.papermc.io`). If `externalUrl` is not null, the jar is hosted outside Hangar (e.g. GitHub) and there is no hash.
Note: the `slug` is case-sensitive (`ViaVersion` ✔, `EssentialsX` ✘ — Essentials is not on Hangar).

## Modrinth v2 — plugins (and mods)

Base: `https://api.modrinth.com/v2` · Docs: https://docs.modrinth.com/api/ · 300 req/min per IP. Auth optional.

| Endpoint | Notes |
|---|---|
| `GET /search?query=&limit=&offset=&index=relevance&facets=[["project_type:plugin"],["categories:paper"],["versions:1.21.8"]]` | `hits[].{project_id, slug, title, description, icon_url, downloads, categories, versions}`. `facets` must be URL-encoded. |
| `GET /project/{id|slug}` | Details. |
| `GET /project/{id|slug}/version?loaders=["paper"]&game_versions=["1.21.8"]` | `[{id, name, version_number, version_type (release/beta/alpha), game_versions, loaders, files[{url, filename, primary, size, hashes:{sha1,sha512}}], dependencies[]}]` |
| `GET /version/{id}` | Single version. |

Pick the file with `primary: true`. Verify `sha512`.

## Mojang (for names/UUIDs and skins)

| Endpoint | Notes |
|---|---|
| `GET https://api.mojang.com/users/profiles/minecraft/{name}` | `{id, name}` (UUID without dashes). |
| `GET https://sessionserver.mojang.com/session/minecraft/profile/{uuid}` | Profile + skin (base64). |
| `https://mc-heads.net/avatar/{uuid}` or `https://crafatar.com/avatars/{uuid}` | Avatars for the UI (third-party services). |

The server maintains `usercache.json` with `{name, uuid, expiresOn}`; use it first and query Mojang only when missing.

## PurpurMC v2 — Purpur downloads

- Base: `https://api.purpurmc.org/v2/purpur`. No auth, no documented rate limit.
- `GET /` → `{"versions":[...]}` (oldest first, no pre-releases). `GET /{mc}` → `{"builds":{"latest":"2497","all":[...]}}`.
- `GET /{mc}/{build}` → `{"result":"SUCCESS","timestamp":ms,"md5":"...","commits":[{"description":...}]}` — one request per build, so wardend only details the newest 20, six at a time.
- Download: `GET /{mc}/{build}/download` (jar). Only MD5 is published; wardend verifies it.

## Fabric Meta v2 — Fabric server launcher

- Base: `https://meta.fabricmc.net/v2/versions`. No auth.
- `GET /game` → `[{"version","stable"}]` newest first (`stable:false` = snapshot). `GET /loader/{mc}` → loaders usable with that game version, newest first. `GET /installer` → installer versions; wardend uses the newest stable one.
- Server jar: `GET /loader/{mc}/{loader}/{installer}/server/jar` — a launcher that downloads the vanilla server and the loader libraries on first start. **No checksum is published**; the download is unverified (HTTPS only).
- Fabric servers load mods from `mods/`, not Bukkit plugins; the Fabric API mod is usually needed and is not installed by wardend.

## Mojang piston-meta — Vanilla server

- `GET https://piston-meta.mojang.com/mc/game/version_manifest_v2.json` → `{"latest":{"release","snapshot"},"versions":[{"id","type","url"}]}` newest first.
- Each version URL is a JSON with `downloads.server: {sha1,size,url}` (missing for very old versions) and `javaVersion.majorVersion`.
- One build per version; wardend reports it as build `1` and verifies SHA-1.
