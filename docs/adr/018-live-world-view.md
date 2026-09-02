# ADR-018: Live world view — agent plugin, chunk cache in wardend, voxel viewer in Beacon

Date: 2026-09-01 · Status: accepted (phase 1 in progress)

## Context

Beacon shows a server through its console, metrics and player list. There is no way to *see* the
world: where players are, what the terrain around them looks like, what is being built. Existing
web maps (BlueMap, Dynmap, Pl3xMap, squaremap) solve this as standalone sites: they mesh or tile
the whole world inside the server JVM at install time, store gigabytes of tiles, and ship their own
web app. Embedding one behind Warden's auth is possible (proxy the plugin's webserver, drive the
iframe over postMessage) but it ties the panel to a third-party UI and puts a first render of the
entire world on the host the moment the feature is enabled.

The research and the phased plan behind this decision live in the session notes ("Warden Live World
View", "Warden Voxel View MVP"); this ADR records what phase 1 builds.

## Decision

Build a deliberately simple viewer of our own, scoped to **what players can see**:

1. **A small Paper plugin, the Warden Agent** (`agent/`), installed by wardend into `plugins/` when
   the instance enables the feature. It streams two things to wardend over a localhost WebSocket:
   player positions at 5 Hz, and simplified chunks (one byte per block, a per-chunk colour palette)
   for the chunks within a radius of each online player. Chunks are read with `ChunkSnapshot`
   (a thread-safe copy) and encoded off the main thread; block-change events mark chunks dirty and
   a dirty chunk is re-sent at most every 5 s. Nothing is ever rendered in the JVM and no region
   file is read from disk.
2. **wardend caches the chunks** (SQLite, one row per instance/world/chunk keyed by a content hash)
   and is the only thing the browser talks to. It serves chunk batches over the REST API and pushes
   `world.players`, `world.chunks` and `world.agent` on the existing WebSocket hub. The agent
   listener is a separate plain-HTTP loopback port (`WARDEND_AGENT_LISTEN`, default
   `127.0.0.1:8481`): the daemon's public listener may run TLS with a self-signed certificate that a
   Java client would have to be taught to trust, and the agent never needs to be reachable from
   outside the host.
3. **Beacon renders the chunks with three.js**: flat colours per block taken from the game's own
   map colours (`BlockData#getMapColor()`), per-vertex ambient occlusion, water as the only
   translucent material, players as the `skinview3d` model with a walking animation and a name tag.
   Meshing runs in a Web Worker. The viewer streams the chunks around a followed player (or the
   camera target) and refetches a chunk when a `world.chunks` message carries a new hash.

### Why the shape of the data is what it is

- **Flat colours, not textures.** Each palette entry carries the block key and the game's map colour.
  Beacon owns the colours: `scripts/block-colors.mjs` averages every block's textures from the
  client jar into `lib/liveview/blocks.json` (with translucency and which biome tint applies), and
  the same script reads the biome colormaps so grass, foliage and water are tinted per column biome.
  The map colour is the fallback for blocks the table does not know (mods, newer versions).
- **Covers repaint the block under them.** A snow layer is not sent as a block (it is not a full
  cube) but the grass beneath it is sent as snow, as the game shows snowy grass sides. The rule
  lives in the agent's palette so carpets can join it.
- **A height band, not the full column.** Per chunk the agent sends the rows from the lowest ground
  level in the chunk minus 8 up to the highest block. Cliffs, river beds, tree trunks and shallow
  water render; caves and interiors do not (phase 3 lifts the cut). A typical chunk is 5–10 KB raw,
  1–2 KB gzipped.
- **Non-cube blocks are dropped or boxed.** Blocks that are neither occluding, solid, leaves nor a
  liquid (plants, torches, rails, snow layers) are sent as air, subject to the cover rule above;
  solid partial blocks (slabs, stairs, fences, glass) are sent as full cubes with a `partial` flag.
- **Only loaded chunks near players.** That is what `ChunkSnapshot` can reach without loading
  anything, and it is exactly what "live" means. Chunks nobody has walked near since the agent was
  installed are simply absent; phase 5 may fill them from region files.

### Cost on the Minecraft server

| Work | Where | Cost |
|---|---|---|
| Player positions | main thread read, async send | microseconds per player, 5 messages/s |
| Chunk snapshot | main thread | a memory copy, capped at 4 per tick |
| Encode, hash, gzip | agent worker thread | a few ms per chunk, off the tick |
| Dirty events | listeners | set a bit |
| Steady state, players idle | — | positions only, no snapshots |

## Protocol

### Agent → wardend (`ws://127.0.0.1:8481/agent/v1`)

Text frames are JSON. The first must be `hello`; wardend answers `hello.ok` or closes the socket.

```json
{"type":"hello","token":"<agentToken>","agent":"warden-agent/0.1.0","server":"Paper 26.2",
 "worlds":[{"name":"world","dimension":"overworld","viewDistance":10,"minY":-64,"maxY":319}]}
{"type":"players","t":1725000000000,"players":[{"uuid":"…","name":"Steve","world":"world",
 "x":1.5,"y":64,"z":-3.2,"yaw":90,"pitch":0,"sneaking":false,"sprinting":false,
 "gamemode":"survival","vanished":false}]}
```

`hello.ok` carries the hashes wardend already holds, so a restarted server does not resend chunks
that have not changed: `{"type":"hello.ok","known":{"world":[[cx,cz,"hash"],…]}}`.

Binary frames carry one chunk, little-endian:

```
u8 kind (1 = chunk) · u8 worldNameLen · worldName (UTF-8) · i32 cx · i32 cz · u64 hash · gzip(payload)
```

`hash` is 64-bit FNV-1a of the uncompressed payload, rendered as 16 hex digits elsewhere.

### Chunk payload (inside the gzip), little-endian

```
u32 magic 0x324B4357 ("WCK2"; WCK1 had no block keys in the palette)
i32 cx, i32 cz
i16 yMin, i16 yMax            inclusive; height = yMax - yMin + 1
u16 paletteLen                index 0 is always air
u8  biomePaletteLen
u8  reserved
palette       paletteLen × { u8 r, u8 g, u8 b, u8 flags, u8 nameLen, UTF-8 block key such as "grass_block" }
biomePalette  biomePaletteLen × { u8 len, UTF-8 key such as "plains" }
biomes        256 × u8, index = z*16 + x  (biome of the column at its top block)
blocks        256 × height × u8, index = (x*16 + z)*height + (y - yMin)
```

Palette flags are hints for blocks the viewer's colour table does not know (mods, newer
versions): `1` grass tint · `2` foliage tint · `4` liquid · `16` partial (solid but not a full
cube; boxed, not yet read by the viewer). Known blocks take colour, translucency and tint from
`blocks.json`.

A format change bumps the magic. Cached rows in the old format fail to decode in the viewer and
are replaced within the agent's reconcile interval: the re-encoded chunk hashes differently, so it
is resent.

### wardend → Beacon

| REST | Role | Description |
|---|---|---|
| `GET /instances/{id}/map` | viewer | `{enabled, agent:{connected, version?}, worlds:[{name,dimension,viewDistance,minY,maxY,chunks}], players:[…]}` |
| `POST /instances/{id}/map/{world}/chunks` | viewer | `{"chunks":[[cx,cz],…]}` (≤1024) → `application/octet-stream`: records `i32 cx · i32 cz · u64 hash · u32 len · gzip blob`, unknown chunks omitted |
| `PUT /instances/{id}/map` | manager | `{"enabled":bool}` → installs or removes the agent jar and its config; a restart loads it |

WebSocket (instance-scoped): `world.players` (`{t, players}` at 5 Hz while anyone is online),
`world.chunks` (`{world, chunks:[[cx,cz,hash],…]}`, coalesced to one message per second) and
`world.agent` (`{connected}`).

## Consequences

- One more build toolchain in the repository: the agent is a Gradle project compiled with a JDK 25
  toolchain against `paper-api 26.2`. `make agent` builds it into `wardend/internal/agent/dist/`,
  from where it is embedded in the daemon binary; CI and the release workflow build it first.
- The feature is Paper-only (Purpur included). Fabric and vanilla instances show the section with an
  explanation until an agent exists for them.
- `instance.json` gains `liveView: {enabled, agentToken}`. The token is written into
  `plugins/WardenAgent/config.yml` together with the agent URL before every start, so the pair
  can never drift.
- Rows in `map_chunks` are deleted with the instance.

## Phases after this one

Biome tint, greedy meshing and an orthographic top-down camera (phase 2); full columns, a Y-level
slider and marker layers (phase 3); events and telemetry overlays (phase 4); an offline import from
region files (phase 5).
