import { applyOutput } from "../audio-context";
import { OPUS_RATE, PACKET_US, type VoiceFrame } from "./frames";
import { JITTER_PROCESSOR, registerJitterWorklet } from "./jitter-worklet";
import { createSpatializer, type Renderer, type RoomPreset, type Spatializer, type SpatialSource } from "./spatial";

/** A speaker whose frames stopped this long ago is torn down. */
const IDLE_MS = 5_000;
/** A speaker counts as speaking while a frame arrived this recently. */
const SPEAKING_MS = 300;
/** Simple Voice Chat's defaults, until the daemon reports the server's values. */
const DEFAULT_DISTANCE = 48;
const DEFAULT_WHISPER = 24;
/** Where a speaker whose avatar is not in the scene is parked: past any max distance, so silent. */
const NOWHERE = -1e6;
/**
 * The player whose eyes the camera looks through has their mouth at the listener's own position,
 * and a voice at distance zero sounds like a thought. It is placed this far ahead along the gaze
 * and this far below the eyes instead, like a companion walking beside you.
 */
const COMPANION_STEP = 1.5;
const COMPANION_DROP = 0.2;

export interface VoiceOptions {
  renderer: Renderer;
  room: RoomPreset;
  elevation: boolean;
  /** The output device, as `enumerateDevices` names it; "" is the browser's default. */
  output: string;
}

interface Speaker {
  decoder: AudioDecoder;
  jitter: AudioWorkletNode;
  source: SpatialSource;
  whisper: boolean;
  /** Placed by the last `update`; a speaker nobody placed is parked out of earshot. */
  placed: boolean;
  last: number;
}

/**
 * What the receiver needs from the scene every frame: the camera as listener (position, forward,
 * up: nine numbers) and each shown player's head, in the same coordinates, with the player the
 * camera looks through marked.
 */
export interface VoiceStage {
  listenerPose(out: Float32Array): void;
  heads(cb: (uuid: string, x: number, y: number, z: number, self: boolean) => void): void;
}

/**
 * Plays the players' voices in 3D (ADR-019 §4). One AudioContext, created by `start()` from a user
 * gesture (Safari refuses otherwise); per speaking player an Opus decoder feeding a jitter buffer
 * feeding a source of the spatial renderer (`lib/voice/spatial.ts`). The scene drives it:
 * `update(stage)` every rendered frame puts the listener on the camera and each speaker on its
 * avatar's head, so a voice comes from where the player is drawn and fades linearly to the server's
 * voice distance (the whisper distance for whispers), the way the game plays it. Group audio is
 * dropped: the game plays it regardless of distance, a conversation the viewer is not part of.
 */
export class VoiceReceiver {
  private ctx: AudioContext | null = null;
  private spatial: Spatializer | null = null;
  private readonly speakers = new Map<string, Speaker>();
  private sweep: ReturnType<typeof setInterval> | undefined;
  private distance = DEFAULT_DISTANCE;
  private whisperDistance = DEFAULT_WHISPER;
  private options: VoiceOptions;
  private readonly pose = new Float32Array(9);
  private readonly onVisible = () => {
    if (document.visibilityState === "visible") void this.ctx?.resume();
  };

  constructor(options: VoiceOptions) {
    this.options = { ...options };
  }

  /** The renderer actually running, once started: Resonance may have given way to the browser's. */
  get renderer(): Renderer | null {
    return this.spatial?.renderer ?? null;
  }

  /** Call from a click handler: creates and resumes the context. */
  async start(): Promise<void> {
    if (this.ctx) return;
    const ctx = new AudioContext({ sampleRate: OPUS_RATE, latencyHint: "interactive" });
    this.ctx = ctx;
    // The worklet, the output device and the renderer (Resonance is a lazy import) load side by side.
    await Promise.all([registerJitterWorklet(ctx), applyOutput(ctx, this.options.output), this.openSpatializer()]);
    await ctx.resume();
    document.addEventListener("visibilitychange", this.onVisible);
    this.sweep = setInterval(() => this.dropIdle(), 1000);
  }

  stop(): void {
    document.removeEventListener("visibilitychange", this.onVisible);
    if (this.sweep) clearInterval(this.sweep);
    this.sweep = undefined;
    for (const uuid of [...this.speakers.keys()]) this.dispose(uuid);
    this.spatial?.dispose();
    this.spatial = null;
    void this.ctx?.close();
    this.ctx = null;
  }

  /** The server's voice and whisper distances in blocks, from `voice.status`. */
  setDistances(distance: number, whisper: number): void {
    this.distance = distance > 0 ? distance : DEFAULT_DISTANCE;
    this.whisperDistance = whisper > 0 ? whisper : DEFAULT_WHISPER;
    for (const s of this.speakers.values()) s.source.setMaxDistance(this.rangeOf(s));
  }

  /**
   * Changes the renderer, the room, the elevation cue or the output device while playing. A
   * renderer change rebuilds the field: the speakers are dropped and come back with their next frame.
   */
  async setOptions(next: VoiceOptions): Promise<void> {
    const prev = this.options;
    this.options = { ...next };
    if (!this.ctx || !this.spatial) return;
    if (next.output !== prev.output) await applyOutput(this.ctx, next.output);
    if (next.renderer !== prev.renderer) {
      for (const uuid of [...this.speakers.keys()]) this.dispose(uuid);
      this.spatial.dispose();
      this.spatial = null;
      await this.openSpatializer();
      return;
    }
    if (next.room !== prev.room) this.spatial.setRoom(next.room);
    if (next.elevation !== prev.elevation) this.spatial.setElevationCue(next.elevation);
  }

  push(frame: VoiceFrame): void {
    if (!this.ctx || !this.spatial || frame.group) return;
    // SVC marks the end of a stream with an empty packet; there is nothing to decode.
    if (frame.opus.length === 0) return;
    const s = this.speakers.get(frame.speaker) ?? this.create(frame.speaker);
    if (!s) return;
    s.last = performance.now();
    if (s.whisper !== frame.whisper) {
      s.whisper = frame.whisper;
      s.source.setMaxDistance(this.rangeOf(s));
    }
    if (s.decoder.state !== "configured") return;
    try {
      s.decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: frame.seq * PACKET_US, data: frame.opus }));
    } catch (e) {
      console.warn("voice: decode", e);
      this.dispose(frame.speaker);
    }
  }

  /** Every rendered frame: the listener follows the camera, each speaker its avatar. */
  update(stage: VoiceStage): void {
    const spatial = this.spatial;
    if (!spatial || this.speakers.size === 0) return;
    const pose = this.pose;
    stage.listenerPose(pose);
    spatial.setListener(pose);
    for (const s of this.speakers.values()) s.placed = false;
    stage.heads((uuid, x, y, z, self) => {
      const s = this.speakers.get(uuid);
      if (!s) return;
      s.placed = true;
      if (self) {
        // A step ahead along the gaze, flattened so looking down does not put the voice underfoot.
        const fx = pose[3];
        const fz = pose[5];
        const len = Math.sqrt(fx * fx + fz * fz) || 1;
        x += (fx / len) * COMPANION_STEP;
        z += (fz / len) * COMPANION_STEP;
        y -= COMPANION_DROP;
      }
      s.source.setPosition(x, y, z);
    });
    for (const s of this.speakers.values()) if (!s.placed) s.source.setPosition(0, NOWHERE, 0);
  }

  /** UUIDs of the players heard in the last 300 ms. */
  speaking(): Set<string> {
    const now = performance.now();
    const out = new Set<string>();
    for (const [uuid, s] of this.speakers) if (now - s.last <= SPEAKING_MS) out.add(uuid);
    return out;
  }

  private rangeOf(s: Speaker): number {
    return s.whisper ? this.whisperDistance : this.distance;
  }

  private async openSpatializer(): Promise<void> {
    if (!this.ctx) return;
    this.spatial = await createSpatializer(this.ctx, this.options.renderer, this.options.room);
    this.spatial.setElevationCue(this.options.elevation);
  }

  private create(uuid: string): Speaker | null {
    const ctx = this.ctx;
    const spatial = this.spatial;
    if (!ctx || !spatial) return null;
    const jitter = new AudioWorkletNode(ctx, JITTER_PROCESSOR, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const source = spatial.createSource(this.distance);
    source.setPosition(0, NOWHERE, 0);
    jitter.connect(source.input);
    const decoder = new AudioDecoder({
      output: (data) => {
        // Mono f32; a decoder that hands back another layout is converted by copyTo.
        const samples = new Float32Array(data.numberOfFrames);
        data.copyTo(samples, { planeIndex: 0, format: "f32-planar" });
        data.close();
        jitter.port.postMessage(samples, [samples.buffer]);
      },
      error: (e) => {
        console.warn("voice: decoder", e);
        this.dispose(uuid);
      },
    });
    decoder.configure({ codec: "opus", sampleRate: OPUS_RATE, numberOfChannels: 1 });
    const s: Speaker = { decoder, jitter, source, whisper: false, placed: false, last: performance.now() };
    this.speakers.set(uuid, s);
    return s;
  }

  private dispose(uuid: string): void {
    const s = this.speakers.get(uuid);
    if (!s) return;
    this.speakers.delete(uuid);
    try {
      if (s.decoder.state !== "closed") s.decoder.close();
    } catch {}
    s.jitter.port.postMessage("reset");
    s.jitter.disconnect();
    s.source.dispose();
  }

  private dropIdle(): void {
    const now = performance.now();
    for (const [uuid, s] of this.speakers) if (now - s.last > IDLE_MS) this.dispose(uuid);
  }
}
