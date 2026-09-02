# Warden Agent

The Paper plugin behind Beacon's live world view (ADR-018). It streams two things to wardend over a
loopback WebSocket:

- every online player's position, 5 times a second;
- the chunks within a radius of each player, simplified to one byte per block indexing a per-chunk
  colour palette (the game's own map colours), gzip-compressed and content-hashed.

Nothing is rendered in the server and no region file is read: chunks come from `ChunkSnapshot`
(a thread-safe copy taken on the main thread, at most a few per tick) and are encoded on a worker
thread. Block-change events mark chunks dirty; a dirty chunk is re-sent at most every 5 s.

## Build

```
./gradlew build          # downloads Gradle and a JDK 25 toolchain on first run
```

The jar lands in `build/libs/WardenAgent.jar`. `make agent` in `wardend/` builds it and copies it to
`wardend/internal/agent/dist/`, from where the daemon embeds it: wardend installs the jar into an
instance's `plugins/` when the live view is enabled, and rewrites `plugins/WardenAgent/config.yml`
(URL and token) before every start.

## Configuration

`config.yml` is written by wardend. `url` and `token` are managed; `radius`, `snapshots-per-tick`,
`resend-seconds` and `reconcile-seconds` may be tuned by hand (see the file's comments).

## Compatibility

Compiled against `paper-api 26.2` with `api-version: '26.1'`; needs Java 25 (Minecraft 26.1+). Only
APIs that exist since 1.21 are used, so an older build for 1.21.x servers is a matter of changing the
dependency and the toolchain.
