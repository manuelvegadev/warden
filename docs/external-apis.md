# APIs externas usadas

Verificadas con `curl` el 2026-08-28. Todas requieren `User-Agent` identificable:
`mc-server-gui/<version> (<email o URL>)`.

## PaperMC Fill v3 — descargas de Paper (y Velocity, Folia, Waterfall)

Docs: https://docs.papermc.io/misc/downloads-service/ · Swagger: https://fill.papermc.io/swagger-ui/index.html
La API vieja `api.papermc.io/v2` dejó de recibir builds el 31-12-2025: **no usar**.

| Endpoint | Devuelve |
|---|---|
| `GET /v3/projects/paper` | `{"project":{"id","name"},"versions":{"1.21":["1.21.11","1.21.8",...],"26.2":[...]}}` — agrupadas por familia; incluye `-rc`/`-pre`. |
| `GET /v3/projects/paper/versions/{mc}/builds` | Array de builds, el más nuevo primero. |
| `GET /v3/projects/paper/versions/{mc}/builds/latest` | Último build. |

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
Canales: `ALPHA` < `BETA` < `STABLE` < `RECOMMENDED`. Por defecto la UI solo ofrece `STABLE`/`RECOMMENDED`.
Nota: desde 2026 Mojang usa versionado `26.x`; Fill lo refleja (`26.1.2`, `26.2`).

## Hangar v1 — plugins oficiales de PaperMC

Base: `https://hangar.papermc.io/api/v1` · Docs: https://hangar.papermc.io/api-docs · Sin auth para lectura.

| Endpoint | Notas |
|---|---|
| `GET /projects?q=<texto>&platform=PAPER&version=<mc>&limit=25&offset=0&sort=-stars` | Búsqueda. `result[].namespace.{owner,slug}`, `stats.downloads`, `supportedPlatforms.PAPER[]`, `category`, `avatarUrl`. |
| `GET /projects/{slug}` | Detalle. |
| `GET /projects/{slug}/versions?platform=PAPER&limit=25` | `result[].{name, channel.name, downloads.PAPER.{downloadUrl, fileInfo.{name,sizeBytes,sha256Hash}}, pluginDependencies.PAPER[], platformDependencies.PAPER[]}` |
| `GET /projects/{slug}/versions/{name}` | Una versión. |

Descarga: usar `downloads.PAPER.downloadUrl` (CDN `hangarcdn.papermc.io`). Si `externalUrl` no es null, el jar está fuera de Hangar (p.ej. GitHub) y no hay hash.
Ojo: el `slug` es sensible a mayúsculas (`ViaVersion` ✔, `EssentialsX` ✘ — Essentials no está en Hangar).

## Modrinth v2 — plugins (y mods)

Base: `https://api.modrinth.com/v2` · Docs: https://docs.modrinth.com/api/ · 300 req/min por IP. Auth opcional.

| Endpoint | Notas |
|---|---|
| `GET /search?query=&limit=&offset=&index=relevance&facets=[["project_type:plugin"],["categories:paper"],["versions:1.21.8"]]` | `hits[].{project_id, slug, title, description, icon_url, downloads, categories, versions}`. `facets` va URL-encoded. |
| `GET /project/{id|slug}` | Detalle. |
| `GET /project/{id|slug}/version?loaders=["paper"]&game_versions=["1.21.8"]` | `[{id, name, version_number, version_type (release/beta/alpha), game_versions, loaders, files[{url, filename, primary, size, hashes:{sha1,sha512}}], dependencies[]}]` |
| `GET /version/{id}` | Una versión. |

Elegir el archivo con `primary: true`. Verificar `sha512`.

## Mojang (para nombres/UUIDs y skins)

| Endpoint | Notas |
|---|---|
| `GET https://api.mojang.com/users/profiles/minecraft/{name}` | `{id, name}` (UUID sin guiones). |
| `GET https://sessionserver.mojang.com/session/minecraft/profile/{uuid}` | Perfil + skin (base64). |
| `https://mc-heads.net/avatar/{uuid}` o `https://crafatar.com/avatars/{uuid}` | Avatares para la UI (servicios de terceros). |

El servidor mantiene `usercache.json` con `{name, uuid, expiresOn}`; usarlo primero y consultar Mojang solo si falta.
