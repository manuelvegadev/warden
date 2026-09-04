# ADR-019: Voice chat in Beacon — a Simple Voice Chat addon in the Warden Agent

Date: 2026-09-02 · Status: accepted (phases 1–2 verified, phase 3 built 2026-09-03; phase 4 pending) · **Extends** ADR-018 (live world view) and ADR-017 (per-instance roles).

## Context

Simple Voice Chat (SVC, `henkelmax/simple-voice-chat`) is the de-facto proximity voice chat for Java
Edition: a Paper plugin on the server (Bukkit builds cover 1.8.8 to 26.2) and a Fabric/Forge/NeoForge/
Quilt mod on every client. Beacon can already install it from the catalog. What it cannot do is take
part: an administrator watching the live view sees players talk to each other and hears nothing, and
has no way to speak to a player, a place or the whole server.

### How SVC works (read from the 26.2 sources)

- **Two channels.** Control rides the Minecraft connection as plugin messages
  (`voicechat:request_secret` → `voicechat:secret`, player states, groups, categories). Voice rides a
  UDP socket of its own (default port 24454, or the server port with `port=-1`); the Velocity/Bungee
  plugins forward that UDP so a proxy exposes a single port.
- **Handshake.** The client mod asks for a secret; the server mints 16 random bytes per player and
  answers with the port, `voice_host`, codec, MTU, distance and keep-alive. Over UDP the client then
  sends `Authenticate`, gets `AuthenticateAck`, sends `ConnectionCheck`, gets its ack; the server sends
  `KeepAlive` every second and drops the connection after ten misses.
- **Wire format.** Client → server: `0xFF · player UUID (16, clear) · VarInt len · [IV 12 · AES-128-GCM
  (type u8 + body) · tag 16]`. Server → client: the same without the UUID. Types: 1 Mic, 2 PlayerSound,
  3 GroupSound, 4 LocationSound, 5/6 Authenticate/Ack, 7 Ping, 8 KeepAlive, 9/10 ConnectionCheck/Ack.
- **Audio.** Opus, mono, 48 kHz, 20 ms frames (960 samples), payload ≤ 1275 bytes, a sequence number
  and a whisper flag. The server mixes nothing: for every `MicPacket` it finds the players in range
  (`voice_chat_distance`, 48 blocks by default, or `whisper_distance`), honours groups and spectators,
  and relays one `PlayerSoundPacket` per receiver carrying the speaker's UUID and the distance. The
  client spatialises with OpenAL. One speaker costs 20–40 kbit/s.
- **Addon API.** A public jar (`de.maxhenkel.voicechat:voicechat-api` on
  `https://maven.maxhenkel.de/repository/public`) lets a Bukkit plugin register a `VoicechatPlugin`
  through `BukkitVoicechatService`. It exposes `MicrophonePacketEvent` (every Opus frame a player sends,
  before routing), `PlayerAudioListener` (everything a given player would hear), three outbound channel
  kinds — `StaticAudioChannel` (everyone, non-positional), `LocationalAudioChannel` (`updateLocation`,
  `setDistance`), `EntityAudioChannel` (`updateEntity`, `setWhispering`, `setDistance`) — each with
  `send(opus)`, `setFilter(Predicate<ServerPlayer>)` and `setCategory`, plus volume categories, an
  `AudioSender` (only for players *without* the mod) and Opus codecs.
- **Licence.** The mod is "All Rights Reserved" (source available). The API artifact is published for
  addons, which is the only part Beacon links against. Beacon never bundles the mod: the user installs
  it from the catalog like any plugin.

### Why not a native UDP client in wardend

The wire protocol is small and has been reimplemented (the Velocity UDP proxy, LabyMod), but the server
only hands secrets to a logged-in player with the mod, drops `MicPacket`s from UUIDs that are not online
players and only routes sound to players with a state. Beacon would have to impersonate a player, and
reimplementing a proprietary wire format from its source is a licence question we do not need to ask.
The addon API is the supported door.

## Decision

The Warden Agent (ADR-018) becomes an SVC addon when the plugin is present. Audio flows through the
paths ADR-018 already opened, with one new socket for the browser:

```
 player mic ─UDP─► SVC ─MicrophonePacketEvent─► Warden Agent ─loopback WS (binary kind 2)─► wardend
                                                                                              │
                        browser ◄──── /api/v1/instances/{id}/voice (binary frames, both ways) ─┘
                                                                                              │
 players ◄─UDP─ SVC ◄─AudioChannel.send(opus)─ Warden Agent ◄─loopback WS (binary kind 3)────┘
```

The browser decodes and encodes Opus with WebCodecs and spatialises with Web Audio, using the same scene
the live view draws. Nothing is decoded, mixed or encoded on the Minecraft server: the agent forwards
bytes. No WebRTC, no ICE, no new open port on the host.

### 1. The agent as an addon

- `plugin.yml` gains `softdepend: [voicechat]`; `build.gradle.kts` adds
  `compileOnly("de.maxhenkel.voicechat:voicechat-api:<version>")` from Max Henkel's repository. Every
  class that touches the API lives behind one `VoiceBridge` that is only constructed when
  `getServer().getServicesManager().load(BukkitVoicechatService.class)` returns non-null, so a server
  without SVC loads the agent exactly as today.
- `VoiceBridge` registers a `VoicechatPlugin` with id `warden` and, on `VoicechatServerStartedEvent`,
  reads the server's voice and whisper distances from `getServerConfig()` and reports them to wardend
  in a new text message `voice.info` (below).
- **Listen path.** `MicrophonePacketEvent` fires on SVC's packet thread for every frame. The handler
  does no work unless wardend has told the agent a listener is active (`voice.listen` below): it checks
  the speaker's consent, packs a frame and hands it to `WardendClient.sendBinary` — the existing
  single-thread sender, so the SVC thread is never blocked. The frame carries a `group` flag
  (`connection.isInGroup()`) so the viewer can drop private group audio, which SVC routes regardless of
  distance.
- **Speak path.** `WardendClient.Listener.onBinary`, a no-op today, becomes a dispatcher. A speak frame
  names a session; the bridge keeps one open channel per session: static (`createStaticAudioChannel`),
  locational (`createLocationalAudioChannel`, `updateLocation` on every frame — the position travels
  with the audio, no separate stream) or entity (`createEntityAudioChannel` on a player, whisper +
  a distance of a couple of blocks for the "conscience" mode). Every channel gets `setFilter` to
  exclude players who denied Beacon, and the volume category `beacon` ("Beacon") registered at start
  so players can turn the panel down in SVC's own volume menu.
- **Consent and visibility.** Policy comes from `config.yml` (`voice.consent: notify | ask`, written by
  wardend from the instance settings, preserved by `writeAgentConfig`).
  - `ask`: the first time a Beacon session touches a player, the agent opens a native dialog
    (Paper's Dialog API, Minecraft 1.21.6+, so within our 26.x baseline): "*Manuel* wants to use voice
    chat from Beacon. [Allow] [Deny]". The answer is stored per player in
    `plugins/WardenAgent/voice-consent.yml` and can be changed with `/warden voice allow|deny|status`.
    A player who denied is neither heard nor spoken to; enforcement is in the agent, not in the panel.
  - Both policies: a session announces itself in three layers. At start and end, a chat line
    ("🎧 *Manuel* is listening to voice chat from Beacon" / "… stopped listening") and a short note
    (`BLOCK_NOTE_BLOCK_PLING`, low volume); while it lasts, an **action bar** line
    ("🎧 *Manuel* is listening from Beacon" or "📢 … is speaking") re-sent every two seconds, cleared at
    the end; players who join mid-session get the chat line and the action bar. The rendering sits
    behind a `VoiceNotifier` interface so it can be swapped without touching the bridge. A boss bar was
    considered and rejected as too loud; a `TextDisplay` marker at the emission point joins in phase 3.
  - Consent state is reported in the `players` message (`voice: allowed | denied | unset`) so the
    viewer can show it on the name tag.

### 2. Agent ↔ wardend protocol additions (loopback WS, ADR-018)

Text (JSON):

| Direction | Message |
|---|---|
| agent → wardend | `{"type":"voice.info","available":true,"plugin":"2.6.21","distance":48,"whisper":24,"policy":"notify|ask"}` on hello and whenever SVC starts or stops |
| wardend → agent | `{"type":"voice.listen","active":true,"by":"Manuel, Ana"}` — start/stop forwarding mic frames; the names feed the in-game notice |
| wardend → agent | `{"type":"voice.session","id":"a1b2c3d4","by":"Manuel","open":true}` — a speak session begins/ends (push-to-talk pressed/released); the channel kind travels in the frames, so a session may switch between static, locational and entity without a new message |
| agent → wardend | `{"type":"players", …, "players":[{…,"voice":"allowed|denied|unset"}]}` — the player's consent, one more field per player (absent when the policy is `notify`) |

Binary, little-endian, first byte is the `kind` the world service dispatches on:

```
kind 2  voice (agent → wardend)  u8 2 · u8 flags (1 whisper · 2 group) · UUID speaker (16, RFC 4122 order) · u64 seq · opus
kind 3  speak (wardend → agent)  u8 3 · u8 sessionLen · session (ASCII) · body
        body = u8 mode (0 static · 1 locational · 2 entity) · u8 flags (1 whisper) · u64 seq · f32 distance
               · mode 1: u8 worldLen · world (UTF-8) · f64 x · f64 y · f64 z
               · mode 2: UUID player (16, RFC 4122 order)
               · opus
```

The browser sends the same `body` behind a bare `u8 3`; wardend inserts the session id and forwards
the rest untouched. The agent keeps one SVC channel per session and recreates it when the mode or
the entity changes (`flush()` on the old one); position and distance are applied on every frame
(`updateLocation`, `setDistance`, `setWhispering` for entity channels), so the source follows the
camera at frame rate with no separate stream.

### 3. wardend: a dedicated voice socket, not the hub

The browser hub (`internal/ws/hub.go`) writes text only, drops on a full 256-slot queue and carries
every stream of an instance to every subscriber. Audio needs binary frames, a queue that drops the
*oldest* frame under backpressure and a fan-out limited to the people who pressed "Listen".

- `GET /api/v1/instances/{id}/voice/ws` upgrades to a WebSocket, authenticated like the hub (first
  message `{"type":"auth","token"}`), then `{"type":"voice.hello","listen":bool,"speak":bool}` — at
  least one true; each capability is checked against its role. Handled by `internal/voice`, modelled
  on `world.HandleAgent`. Later text messages: `{"type":"voice.listen","active":bool}` toggles
  listening (the in-game notice and the agent's forwarding follow); `{"type":"voice.speak","active":bool}`
  marks push-to-talk pressed and released (a speak session: `voice.session` to the agent, an audit
  event, the name in `status.speaking`); `{"type":"ping"}`/`pong`. Binary: kind-2 frames down to
  listeners, kind-3 bodies up from speakers.
- Roles (`auth.needs`, mirrored in `beacon/lib/access.ts` and `access-vectors.json`):
  `ActionVoiceSpeak` → `operator` (it is `say` with a microphone); `ActionVoiceListen` → `manager`
  (hearing players is more than reading their chat). One table entry each if the owner disagrees.
- The service keeps, per instance, the set of listening browsers and the open speak sessions. It tells
  the agent `voice.listen` when the set goes from empty to non-empty and back, relays kind-2 frames to
  every listener and kind-3 frames from a speaker to the agent, and rewrites nothing.
- Browser ↔ wardend frames mirror the agent's: kind 2 downstream as-is; upstream kind 3 without the
  session id, which wardend adds (a short id per socket) before relaying to the agent.
- `voice.status` on the existing hub, `{available, listeners:[names], speaking:[names]}`, so every
  viewer of the instance sees that someone is listening, not only the person who is.
- Audit: the `events` table and `GET /instances/{id}/events` gain the kinds `voice.listen.start`,
  `voice.listen.stop`, `voice.speak.start`, `voice.speak.stop` with the admin's name in `player`. They
  show in the Events stream like a join or a kick.
- `GET /instances/{id}/voice` (plain GET, `viewer`) answers `{available, plugin, distance, whisper,
  policy, listeners, speaking}`; `PATCH /instances/{id}` accepts `voice: {policy}`, which wardend
  writes into the agent's `config.yml` as `voice-consent` before the next start.
- Nothing is recorded. Frames are relayed and forgotten; the daemon holds no audio.

### 4. Beacon

New module `lib/voice/`, consumed by `components/instance/live-view.tsx`:

- **Capability gate.** Supported browsers are **Safari 26+ and Chrome 94+** (WebCodecs `AudioDecoder`/
  `AudioEncoder` with Opus). The viewer shows the voice controls (over the scene, bottom left) only
  when both constructors exist; otherwise a short notice. No WASM fallback, no WebRTC.
- **`VoiceSocket`** — the `/voice` WebSocket with the same token and backoff as `use-wardend-socket.ts`.
- **`Receiver`** — per speaker UUID: `AudioDecoder({codec:"opus", sampleRate:48000, numberOfChannels:1})`
  → a ~60 ms jitter buffer in an `AudioWorklet` → the elevation filter → a source of the spatial
  renderer. The source position is the avatar's eye position (already smoothed from the 5 Hz samples);
  the listener follows `scene.camera` every rendered frame through the scene's `onFrame` hook: in
  **player** mode the admin hears what that player hears, with the followed player's own voice a step
  ahead of the camera rather than inside the listener's head (the "conscience" placement belongs to
  what the *player* hears when the admin speaks, phase 3); in **fly** what an invisible spectator would,
  in **orbit** the listener sits on the camera (a far orbit is silent, as in the game). Falloff is
  linear from 1 block to the server's voice distance, or the whisper distance for whispered frames,
  both from `voice.status`. Group-flagged frames are dropped. A speaking player's name tag lights up,
  as SVC does in-game. Global (static) speech, when it exists, plays flat, outside the renderer.
- **Two spatial renderers** (`lib/voice/spatial.ts`), chosen in the viewer and remembered per browser.
  The browser's `PannerNode` in HRTF mode uses one HRTF set averaged over IRCAM's LISTEN subjects at
  15° resolution in every engine: lateral cues are fine, elevation and externalisation are poor, and
  there is no room. **Resonance Audio** (Google, Apache-2.0, archived in 2026, native Web Audio nodes
  only, 129 KB minified, `resonance-audio` on npm) is therefore the default: third-order ambisonics
  decoded with the SADIE KU100 HRTFs plus a room with directional early reflections and a late reverb,
  the cues that put a voice outside the head. Resonance keeps its room centred on the origin, so the
  room travels with the camera: the listener sits at ear height above the room's floor and sources
  are fed relative to it. Resonance fades the room sends out for a source beyond the walls, so the
  outdoor room is wide and tall enough to hold anyone within voice range above or below the camera.
  Presets: *Outdoors* (open sky, distant walls, a grass floor for the reflection that anchors a voice
  to the ground; the default),
  *Room*, *Hall*, *No room*. If Resonance cannot be loaded the receiver falls back to the browser's
  panner and says so; the panner is also selectable outright.
- **Elevation cue.** A generic HRTF cannot tell up from down. Spectral energy between 2 and 10 kHz
  is read as height (Rajendran & Gamper, JASA 2019), so a peaking filter centred at 5 kHz is boosted
  for voices above the listener and cut for voices below, up to ±6 dB at 45°. On by default, a
  checkbox in the same menu. What no generic renderer gives is fine height: a player two blocks higher
  will not be heard as such.
- **`Transmitter`** — `getUserMedia({audio:{echoCancellation, noiseSuppression}})` → effects graph →
  `AudioEncoder({codec:"opus", sampleRate:48000, numberOfChannels:1, bitrate})` at 20 ms → kind-3 frames.
  The controls follow Discord: **Join voice** opens the session (the socket, the receiver, the
  microphone, so the permission prompt happens once, up front); **mute** turns the microphone off and
  keeps the listening; **deafen** turns the listening off and mutes with it — one cannot talk without
  hearing; **leave** ends it. The choices behind them sit in the live view's settings dialog (the
  gear over the scene), Audio tab, kept in the browser: the **microphone** and the **output device**
  (`enumerateDevices`; the output through `AudioContext.setSinkId`, so only where the browser has it
  — Chrome; Safari plays through the system's output), the microphone's mode, the target, the reach,
  the renderer and the room. The microphone works in two modes: **push-to-talk**
  (hold **V** or the microphone button) or **open mic** (on until muted). The **target** follows the
  camera mode: fly and orbit → locational at the camera, where the admin is, not where the camera
  points; player → entity channel on the followed player. A fourth choice, **Everyone**, uses the
  static channel. The
  viewer draws the source and a translucent sphere with the current radius while transmitting, so the
  admin sees who can hear before speaking; the radius is a slider capped by the instance setting.
- **Effects presets** (browser-side, before encoding; the mod plays what it receives):
  *Clean*; *Conscience* (short closed reverb, ~120 ms feedback echo, low-pass, a doubled copy a few cents
  flat and a few ms late; suggested in player mode, paired with the whispering entity channel);
  *Divine* (long convolution reverb, bass lift; suggested when the source is above the players);
  *PA* (narrow band-pass, light saturation, a short chime on key-down; suggested for Everyone).
  Impulse responses are synthesised at start (decaying noise), nothing is downloaded. Presets with
  reverb encode at 64 kbit/s, clean at 32.
- Consent icons on name tags (`voice` field), the "someone is listening" pill from `voice.status`, and
  the Events tab showing the audit kinds.
- Safari specifics handled regardless of version: `AudioContext` resumes only after a click (the
  "Listen" button is that click); microphone needs HTTPS and a per-site permission; on iOS a tab switch
  suspends capture, so the session reconnects and resumes on `visibilitychange`; the context's sample
  rate is not guaranteed to be 48 kHz, so the transmitter resamples before encoding.

### 5. Installing and configuring SVC from Beacon

- **wardend installs SVC itself.** Voice is a Beacon feature, and the agent is an addon to SVC, so
  the daemon does not ask an admin to go and find the plugin: on the first start of a server whose
  software loads Bukkit plugins it fetches the newest release from the catalog (Modrinth
  `simple-voice-chat`, loader `paper`) and puts it in `plugins/`, the same path the Plugins tab
  uses. It picks the release listed for the server's Minecraft version, falling back to the newest
  one when the catalog lists none, since the Bukkit build is one jar across versions. The download
  is bounded and never fatal: a failure costs voice, not the start, and says so in the console.
  Afterwards it is an ordinary catalog install — the tab shows it, offers its updates and can
  remove it — and a removal is remembered in the manifest (`voice.noAutoInstall`), so wardend does
  not put it back; installing it again from the tab clears the mark. A jar an admin dropped in by
  hand counts as installed, by the plugin name in its descriptor.
- The Live view shows "Restart the server to enable voice" while `available` is false.
- `plugins/voicechat/voicechat-server.properties` joins the confined file editor allowlist (`port`,
  `bind_address`, `voice_host`). `docs/deploy.md` gains the UDP port note: the host firewall (and a
  proxy, if any) must pass the voice port; wardend itself opens nothing new.

## Consequences

- One more compile-time dependency for the agent (the API jar, not the mod) and one more Maven
  repository in its build. The agent keeps working unchanged where SVC is absent.
- A second browser WebSocket per instance while voice is in use. The hub is untouched apart from one
  status message.
- Audio-rate traffic on the loopback socket: ~50 frames/s per speaker while someone listens, zero
  otherwise. The agent forwards bytes; no codec runs in the JVM.
- The browser floor for voice is stricter than for the rest of Beacon and is enforced by feature
  detection, not by user-agent sniffing.
- One archived third-party library in the viewer's voice chunk (`resonance-audio`, with Omnitone
  bundled). It is Apache-2.0 and built on APIs that have not changed in a decade; if it ever breaks,
  the browser renderer behind the same interface keeps voice working while it is vendored or replaced.
- Privacy is a product decision made explicit: listening is `manager`-only, visible in-game for as
  long as it lasts, optionally consented per player, enforced by the agent and written to the event log.
- Beacon links only against SVC's published addon API; the mod's proprietary licence is respected.

## Phases

1. **Listen, mono.** Agent addon (`softdepend`, `VoiceBridge`, `voice.info`, kind-2 frames gated by
   `voice.listen`), `internal/voice` service and `/voice` socket, roles, `voice.status`, audit events,
   consent policy `notify` with the action-bar notice, Beacon `VoiceSocket` + `Receiver` playing flat. Verified
   against a real Paper server with two clients.
2. **3D.** Panner per speaker placed on its avatar's head from the scene's per-frame hook, listener
   from the camera per mode, group filter, name-tag indicator, whisper radius.
3. **Speak.** kind-3 frames, `onBinary` dispatcher, static/locational/entity channels with filter and
   volume category, push-to-talk, targets per camera mode, source marker and radius sphere, `ask`
   policy with the Paper dialog and `/warden voice`, consent icons on the name tags.
4. **Effects.** Presets and the encoder bitrate switch; local monitor.
5. **Later, if needed.** `PlayerAudioListener` as an alternative listen mode ("hear exactly what X
   hears, groups included"); WebRTC (pion) if jitter over WebSocket proves unacceptable on real links;
   voice-side controls for SVC's server config (distance, groups) from the instance settings.
