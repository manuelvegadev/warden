# ADR-013: Server software providers

**Status:** accepted · 2026-08-29

## Context

Warden started Paper-only (ADR-004/005). Users asked for Purpur (Paper fork with extra gameplay
knobs), Fabric (mods) and plain Vanilla. Each upstream has a different notion of "build" and a
different — or no — checksum.

## Decision

`catalog.ServerProvider` stays the single abstraction: `Versions` + `Builds` returning
`catalog.Build{ID int, Channel, Time, Name, Size, Hash Checksum, URL}`. Every provider maps its
upstream onto it rather than leaking upstream shapes into instances or the panel:

| Provider | Versions | Build id | Hash | Notes |
|---|---|---|---|---|
| paper | Fill v3 | build number | sha256 | unchanged |
| purpur | api.purpurmc.org | build number | md5 | newest 20 builds detailed concurrently |
| fabric | meta.fabricmc.net | loader version as `major·10⁶ + minor·10³ + patch` | none | jar = Fabric server launcher for (game, loader, newest stable installer); channel `STABLE`/`BETA` from the loader's `stable` flag |
| vanilla | piston-meta | always `1` | sha1 | snapshots only with `includePre` |

`Build.SHA256` became `Hash Checksum` (`{algo,value}`) so install/upgrade verify whatever the
upstream publishes and skip verification only when nothing is (Fabric).

Provider-specific facts live on the provider as `Traits{Plugins, TPSCommand, SingleBuild}`
(exposed by `GET /catalog/servers`); the metrics sampler consults `TPSCommand` before polling
`tps`. The instance layer needs no provider-specific code: install, upgrade (`LatestBuild`, "newer build"
= greater id, which the Fabric encoding preserves), backups and the launch command
(`java … -jar <jar> --nogui`) are identical. The manifest keeps `software` as the provider id.

The panel owns the presentation differences in one `SOFTWARE` map (`lib/api.ts`): label,
description, "Build" vs "Loader", how a build is named, single-build, and whether the software
loads Bukkit plugins. It mirrors the daemon traits statically rather than fetching them — the
list of providers is small and changes with a coordinated release. The Plugins
section is hidden for Fabric and Vanilla; the plugin catalog still targets Paper (Purpur runs
Paper plugins).

## Consequences

- Fabric downloads are unverified beyond TLS — documented in `docs/external-apis.md`.
- Fabric mods (and the Fabric API dependency) are not managed; users drop them into `mods/`.
- Modrinth's mod side is a natural follow-up if mod management is ever wanted.
