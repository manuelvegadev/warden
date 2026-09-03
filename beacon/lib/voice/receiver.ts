import type { VoiceFrame } from "./frames";
import { JITTER_PROCESSOR, registerJitterWorklet } from "./jitter-worklet";

/** Opus as Simple Voice Chat sends it: mono, 48 kHz, 20 ms packets. */
const OPUS_RATE = 48_000;
const PACKET_US = 20_000;
/** A speaker whose frames stopped this long ago is torn down. */
const IDLE_MS = 5_000;
/** A speaker counts as speaking while a frame arrived this recently. */
const SPEAKING_MS = 300;

interface Speaker {
  decoder: AudioDecoder;
  jitter: AudioWorkletNode;
  last: number;
}

/**
 * Plays the players' voices (ADR-019 §4). One AudioContext, created by `start()` from a user gesture
 * (Safari refuses otherwise); per speaking player an Opus decoder feeding a jitter buffer feeding
 * the output. Flat in phase 1: phase 2 puts a PannerNode between the jitter node and the destination.
 * Group audio is dropped: the game plays it regardless of distance, a conversation the viewer is not
 * part of.
 */
export class VoiceReceiver {
  private ctx: AudioContext | null = null;
  private readonly speakers = new Map<string, Speaker>();
  private sweep: ReturnType<typeof setInterval> | undefined;
  private readonly onVisible = () => {
    if (document.visibilityState === "visible") void this.ctx?.resume();
  };

  /** Call from a click handler: creates and resumes the context. */
  async start(): Promise<void> {
    if (this.ctx) return;
    const ctx = new AudioContext({ sampleRate: OPUS_RATE, latencyHint: "interactive" });
    this.ctx = ctx;
    await registerJitterWorklet(ctx);
    await ctx.resume();
    document.addEventListener("visibilitychange", this.onVisible);
    this.sweep = setInterval(() => this.dropIdle(), 1000);
  }

  stop(): void {
    document.removeEventListener("visibilitychange", this.onVisible);
    if (this.sweep) clearInterval(this.sweep);
    this.sweep = undefined;
    for (const uuid of [...this.speakers.keys()]) this.dispose(uuid);
    void this.ctx?.close();
    this.ctx = null;
  }

  push(frame: VoiceFrame): void {
    if (!this.ctx || frame.group) return;
    // SVC marks the end of a stream with an empty packet; there is nothing to decode.
    if (frame.opus.length === 0) return;
    const s = this.speakers.get(frame.speaker) ?? this.create(frame.speaker);
    if (!s) return;
    s.last = performance.now();
    if (s.decoder.state !== "configured") return;
    try {
      s.decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: frame.seq * PACKET_US, data: frame.opus }));
    } catch (e) {
      console.warn("voice: decode", e);
      this.dispose(frame.speaker);
    }
  }

  /** UUIDs of the players heard in the last 300 ms. */
  speaking(): Set<string> {
    const now = performance.now();
    const out = new Set<string>();
    for (const [uuid, s] of this.speakers) if (now - s.last <= SPEAKING_MS) out.add(uuid);
    return out;
  }

  private create(uuid: string): Speaker | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const jitter = new AudioWorkletNode(ctx, JITTER_PROCESSOR, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    jitter.connect(ctx.destination);
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
    const s: Speaker = { decoder, jitter, last: performance.now() };
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
  }

  private dropIdle(): void {
    const now = performance.now();
    for (const [uuid, s] of this.speakers) if (now - s.last > IDLE_MS) this.dispose(uuid);
  }
}
