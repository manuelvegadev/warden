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

- **Colours on the wire, textures in the viewer.** Each palette entry carries the block key and the
  game's map colour. Beacon owns the look: `scripts/block-colors.mjs` averages every block's
  textures from the client jar into `lib/liveview/blocks.json` (with translucency and which biome
  tint applies) and reads the biome colormaps, so grass, foliage and water are tinted per column
  biome. With the fetched art, `scripts/mc-atlas.mjs` derives a strip of 16×16 face tiles and a
  per-block face table (up, down, north, south, east, west, and which faces the biome tints); the
  viewer uploads the strip as a texture array (no bleeding between tiles at any mip level), the
  mesher writes each face's tile and corner coordinates into the vertices, and the vertex colour
  keeps the tint, the ambient occlusion and the face shade. Blocks that turn take the faces of
  their orientation's blockstate variant, with each face's texture turned as the game's model
  rotation turns it (`variants` per block in the table, quarter turns per face). Blocks whose
  blockstate lists several models for one look (grass, dirt, stone, sand, netherrack and the
  like, turned or mirrored copies) carry them as `random`, and the mesher picks one per position
  the way the game does, seeding its `java.util.Random` port with `Mth.getSeed(x, y, z)`, so a
  plain does not repeat one tile and every block turns the way the player sees it; mirrored model
  faces get a flipped tile. A water surface is drawn 8/9 of a block tall, as the game draws a source
  fluid, and only where no water sits above it, so a pool has one step at the top and none below.
  A block with no body of its own is not drawn, but when its cell also holds water the agent sends
  it with the `8` flag rather than dropping it, keeping its own key and colour: the water is a fact
  the server holds, either in the block's `waterlogged` state (coral fans, sea pickles) or in its
  very definition (seagrass, kelp). The viewer draws such a cell as water for now, so the sea has
  no holes where a plant stands, and the palette still says which plant it is for when the viewer
  can draw it. Blocks that are
  not full cubes take their particle texture on every face for now, the grass block's tinted side fringe is baked
  with the plains colour, and leaves follow the game's graphics setting, chosen in the viewer: *fancy*
  keeps the holes in their textures (an alpha test on the opaque pass) and draws the faces between
  two leaf blocks so the leaves behind show through; *fast* fills the holes with the foliage's
  own colour and draws only the outside of a canopy. Without the art the terrain draws in the flat colours, as before; the
  map colour is the fallback for blocks neither table knows (mods, newer versions).
- **The game's own art, fetched where Beacon runs, never shipped.** Textures, block models and
  the entity geometries and animations are Mojang's, so they are not in the repository or the
  image. `scripts/mc-assets.mjs` (run by `pnpm install`, and by the container's entrypoint into
  `/data`) downloads the client jar from piston-meta and Mojang's public `bedrock-samples`
  release, and keeps textures, block models, blockstates, entity geometries and animations under
  `data/mc-assets`; Beacon serves that tree at `/liveview/mc/…` to signed-in users. The player is
  drawn from the pack's own humanoid geometry (`lib/liveview/bedrock`: the file's bones and cubes
  as one skinned mesh, one draw call per model) and posed with the pack's player animations,
  ported as arithmetic rather than through a Molang interpreter. Mobs will come the same way.
- **The server's light, drawn the game's way.** The light engine runs on the server, so the agent
  sends its result: sky and block light per cell. The mesher lights each face with the cell it
  looks into and averages the three open cells around every corner (the game's smooth lighting,
  the same cells the ambient occlusion samples) into two bytes per vertex. The shader turns them
  into brightness as the game's light map does: the game's curve `f / (4 − 3f)` per channel, sky
  light scaled by the game's sky darken (1 by day, 0.2 at night, less in rain) in its bluish
  night tint, block light with the game's 1.5 factor and its warmth that fades in as the level
  drops, the two added, the faint 0.75/4 % floor, the brightness option's gamma (the game's
  `1 − (1 − c)⁴` lift; the game defaults to 50 %, the panel to 45 %, set in the Video tab) and the floor again. The levels are interpolated across
  the face and the map is evaluated per pixel, as the game samples its light texture, so a torch's
  falloff is a smooth gradient rather than shaded vertices. The ambient occlusion is the game's own
  0.4/0.6/0.8/1 curve, and a solid or unlit neighbour counts as the face's cell in the corner
  average, as the game blends it.
  Night vision (a Video setting, like the potion) lights every cell as full daylight. Chunks from
  agents before WCK4 carry no light and draw in daylight.
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
 "x":1.5,"y":64,"z":-3.2,"yaw":90,"pitch":0,"sneaking":false,"sprinting":false,"pose":"standing","onGround":true,"flying":false,"inWater":false,
 "gamemode":"survival","vanished":false}],
 "worlds":{"world":{"day":34,"time":6000,"gameTime":822000,"rain":false,"thunder":false}}}
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
u32 magic 0x344B4357 ("WCK4"; WCK3 had no light, WCK2 no orientation byte, WCK1 no block keys in the palette)
i32 cx, i32 cz
i16 yMin, i16 yMax            inclusive; height = yMax - yMin + 1
u16 paletteLen                index 0 is always air
u8  biomePaletteLen
u8  reserved
palette       paletteLen × { u8 r, u8 g, u8 b, u8 flags, u8 orient, u8 nameLen, UTF-8 block key such as "grass_block" }
              orient: 0 none · 1–3 axis x, y, z (logs, pillars) · 4–9 facing down, up, north, south, west, east
              (furnaces, dispensers, barrels, observers, glazed terracotta); a block turned two ways is two entries
biomePalette  biomePaletteLen × { u8 len, UTF-8 key such as "plains" }
biomes        256 × u8, index = z*16 + x  (biome of the column at its top block)
blocks        256 × height × u8, index = (x*16 + z)*height + (y - yMin)
light         256 × height × u8, same index: the server's sky light in the high nibble, block light
              (torches, lava) in the low one, for every cell of the band, air included
```

Palette flags are hints for blocks the viewer's colour table does not know (mods, newer
versions): `1` grass tint · `2` foliage tint · `4` liquid · `8` the cell also holds water (a
waterlogged block, or a plant the game keeps in water) · `16` partial (solid but not a full
cube; boxed, not yet read by the viewer). Known blocks take colour, translucency and tint from
`blocks.json`.

A format change bumps the magic. Cached rows in the old format fail to decode in the viewer and
are replaced within the agent's reconcile interval: the re-encoded chunk hashes differently, so it
is resent.

### wardend → Beacon

| REST | Role | Description |
|---|---|---|
| `GET /instances/{id}/map` | viewer | `{supported, agent:{connected, version?}, worlds:[{name,dimension,viewDistance,minY,maxY,chunks}], players:[…]}` |
| `POST /instances/{id}/map/{world}/chunks` | viewer | `{"chunks":[[cx,cz],…]}` (≤1024) → `application/octet-stream`: records `i32 cx · i32 cz · u64 hash · u32 len · gzip blob`, unknown chunks omitted |

WebSocket (instance-scoped): `world.players` (`{t, players, worlds}` at 5 Hz while anyone is
online; `worlds` carries each world's day, time of day, game time and weather, which the viewer
turns into sky colour, fog and lighting, the star field, the sun and the moon's phase, and the
drifting cloud layer, the way the game does, from the game's own textures and seeds; the viewer
renders without colour management, as the game does, so the texture colours times the light are
what reaches the screen),
`world.chunks` (`{world, chunks:[[cx,cz,hash],…]}`, coalesced to one message per second) and
`world.agent` (`{connected}`).

The viewer's camera has three modes. Orbit, the default, works like SketchUp's: the point under the
cursor when a drag or a wheel notch starts is the pivot for turning, the handle for dragging the
world and the target of the zoom; a selected player carries the camera along. Fly is the game's
spectator mode (WASD, Space and Shift, Ctrl to sprint, the wheel sets the speed, the mouse looks
under pointer lock, or a left drag where the lock is refused), with the game's flight feel: the
keys accelerate and the velocity decays by 0.91 each tick; unlike the game, forward follows the
whole view direction, so looking up and flying forward climbs. Player looks
through the selected player's eyes at the game's eye height with a wide field of view, following
the yaw and pitch the agent reports.

## Consequences

- One more build toolchain in the repository: the agent is a Gradle project compiled with a JDK 25
  toolchain against `paper-api 26.2`. `make agent` builds it into `wardend/internal/agent/dist/`,
  from where it is embedded in the daemon binary; CI and the release workflow build it first.
- The feature is Paper-only (Purpur included). Fabric and vanilla instances show the section with an
  explanation until an agent exists for them.
- The agent is part of the product, not an option: wardend installs it on every instance whose
  software loads Bukkit plugins (on create, on daemon start, before every server start), lists it
  as a `managed` plugin and refuses to disable, update or remove it from the panel. `instance.json`
  gains `liveView: {agentToken}`. The token is written into
  `plugins/WardenAgent/config.yml` together with the agent URL before every start, so the pair
  can never drift.
- Rows in `map_chunks` are deleted with the instance.

## Phases after this one

Biome tint, greedy meshing and an orthographic top-down camera (phase 2); full columns, a Y-level
slider and marker layers (phase 3); events and telemetry overlays (phase 4); an offline import from
region files (phase 5).
