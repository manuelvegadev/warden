/**
 * The jitter buffer that sits between a speaker's Opus decoder and the audio graph, as an
 * AudioWorklet processor. It lives here as a string so it can be registered from a Blob URL
 * without bundler configuration; `registerJitterWorklet` does that once per AudioContext.
 *
 * Decoded 48 kHz mono samples arrive over the port as Float32Arrays. Playback starts once
 * `target` seconds are buffered, goes silent on underrun and re-primes, drops the oldest audio when
 * the ring fills, and skips ahead when the backlog grows past four targets so a stalled tab does not
 * turn into permanent lag. The context may run at another rate (Safari follows the output device):
 * the processor resamples linearly from Opus's 48 kHz to its own rate.
 */

export const JITTER_PROCESSOR = "beacon-voice-jitter";

/** Sample rate of the incoming audio: Opus as Simple Voice Chat sends it. */
const INPUT_RATE = 48_000;
/** Seconds buffered before a speaker starts playing. */
const TARGET_S = 0.06;

const SOURCE = `
class BeaconVoiceJitter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.inputRate = ${INPUT_RATE};
    this.target = Math.round(${TARGET_S} * this.inputRate);
    this.capacity = this.inputRate * 2;
    this.ring = new Float32Array(this.capacity);
    this.write = 0;
    this.read = 0; // fractional index into the ring, in input samples
    this.buffered = 0;
    this.primed = false;
    this.step = this.inputRate / sampleRate;
    this.port.onmessage = (ev) => {
      const d = ev.data;
      if (d === "reset") { this.buffered = 0; this.read = this.write; this.primed = false; return; }
      this.push(d);
    };
  }
  push(samples) {
    const n = samples.length;
    if (n === 0) return;
    // Overflow: drop the oldest audio so the newest is always kept.
    const free = this.capacity - this.buffered;
    if (n > free) {
      const drop = n - free;
      this.read = (this.read + drop) % this.capacity;
      this.buffered -= drop;
    }
    const first = Math.min(n, this.capacity - this.write);
    this.ring.set(samples.subarray(0, first), this.write);
    if (first < n) this.ring.set(samples.subarray(first), 0);
    this.write = (this.write + n) % this.capacity;
    this.buffered += n;
    // Backlog: jump ahead to the target so latency never creeps.
    if (this.buffered > this.target * 4) {
      const skip = this.buffered - this.target;
      this.read = (this.read + skip) % this.capacity;
      this.buffered -= skip;
    }
  }
  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    if (!this.primed) {
      if (this.buffered >= this.target) this.primed = true;
      else { out.fill(0); return true; }
    }
    if (this.step === 1) {
      // Same rate (Chrome honours the 48 kHz context): plain copies, at most two around the wrap.
      const n = Math.min(out.length, this.buffered);
      const first = Math.min(n, this.capacity - this.read);
      out.set(this.ring.subarray(this.read, this.read + first));
      if (first < n) out.set(this.ring.subarray(0, n - first), first);
      if (n < out.length) { out.fill(0, n); this.primed = false; }
      this.read = (this.read + n) % this.capacity;
      this.buffered -= n;
      return true;
    }
    const step = this.step;
    for (let i = 0; i < out.length; i++) {
      if (this.buffered < 2) {
        out.fill(0, i);
        this.primed = false;
        break;
      }
      const base = Math.floor(this.read);
      const frac = this.read - base;
      const a = this.ring[base];
      const b = this.ring[(base + 1) % this.capacity];
      out[i] = a + (b - a) * frac;
      this.read += step;
      const consumed = Math.floor(this.read) - base;
      if (consumed > 0) {
        this.buffered -= consumed;
        if (this.read >= this.capacity) this.read -= this.capacity;
      }
    }
    return true;
  }
}
registerProcessor(${JSON.stringify(JITTER_PROCESSOR)}, BeaconVoiceJitter);
`;

const registered = new WeakSet<AudioContext>();

/** Registers the processor on the context (once). */
export async function registerJitterWorklet(ctx: AudioContext): Promise<void> {
  if (registered.has(ctx)) return;
  const url = URL.createObjectURL(new Blob([SOURCE], { type: "text/javascript" }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  registered.add(ctx);
}
