# ADR-023: Where downloads may go

Date: 2026-09-25 · Status: accepted · **Implements** the download rule in docs/security.md §5.7,
which it corrects · Phase 8.4 of docs/roadmap.md.

## Context

`docs/security.md` promised that external downloads were "HTTPS only, allowed hosts". The code did
neither: `catalog.Download` fetched any URL a source returned, over any scheme, following any
redirect. The URLs come from third parties. A Hangar version's `externalUrl` is whatever its author
typed, so any project author could make the daemon request any address, including ones on the
server's own network (`http://192.168.1.1/…`, the cloud metadata service at `169.254.169.254`).

The promised list was also incomplete and too strict. On 2026-09-25 the downloads came from:

| What | Hosts (redirects included) |
|---|---|
| Paper, Purpur, Fabric, Vanilla servers | `fill-data.papermc.io`, `api.purpurmc.org`, `meta.fabricmc.net`, `piston-data.mojang.com`, and `launcher.mojang.com` for older Vanilla |
| Java runtimes (Adoptium) | `github.com` → `release-assets.githubusercontent.com` |
| Plugins and icons | `cdn.modrinth.com`, `hangarcdn.papermc.io` |

Of the 100 most downloaded Paper projects on Hangar, 72 host their file on Hangar, 15 link to
GitHub, and 13 link elsewhere: `download.geysermc.org` (Geyser), `ci.athion.net`
(FastAsyncWorldEdit) and `api.grim.ac` (GrimAnticheat) serve the jar; the rest link to web pages
(Modrinth, SpigotMC, Patreon), which the jar check already rejects. A host allowlist that took only
GitHub for external links would have made Geyser, FAWE and Grim uninstallable from the catalog.

## Decision

- **Two kinds of download** (`internal/catalog/fetch.go`), each with its own HTTP client, whose
  `CheckRedirect` applies the same rule to every hop (at most 10):
  - **Trusted** (`Download`, `FetchImage`): server jars, Java runtimes, the files and icons Hangar
    and Modrinth host. HTTPS, and a host in `trustedHosts` (the table above), or the download is
    refused. These carry a published hash except Fabric's launcher, and it is checked.
  - **External** (`DownloadExternal`): Hangar `externalUrl` links, marked `external` on the
    release. HTTPS to any host, but only to a **public address**: the dialer refuses loopback,
    private, link-local, CGNAT (`100.64.0.0/10`), `0.0.0.0/8`, multicast and unspecified addresses,
    IPv4 written as IPv6 included. The check runs on the address actually dialed, after DNS, so a
    name that resolves to a public address once and a private one the next time still cannot
    reach the local network. There is no hash; the jar-with-a-descriptor check stays.
- A proxy from the environment (`HTTPS_PROXY`) is still dialed wherever it is, even on the local
  network; the proxy then decides what it reaches.
- Refusals wrap `catalog.ErrDownloadRefused` and name the reason (`… is not HTTPS`, `… is not a
  known download host`, `… is not a public address`); the install task fails with it.
- **The admin knows.** The install dialog shows the host of an external release in the queue
  ("from download.geysermc.org, outside Hangar · no hash") and includes it in the confirmation
  before installing. The installed record keeps the host (`external`), which the plugins table
  shows as a badge; an update from an external link names its host in the menu.
- Timeouts come from the request context: 15 minutes for a download, 30 seconds for an icon.

## Consequences

- A new source, or a source that moves its files, needs its host in `trustedHosts`; until then its
  downloads fail with "not a known download host". The table above says what each host is for.
- External links still run code from anyone who can publish on Hangar, as installing any plugin
  does; this decision only keeps the daemon's own requests off the local network and off plain
  HTTP. Malware scanning stays in the backlog (docs/roadmap.md).
- API calls to the sources (`api.modrinth.com`, `hangar.papermc.io`, …) go to fixed base URLs and
  are not covered by this policy.
