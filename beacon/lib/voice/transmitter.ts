/**
 * The admin's microphone as Opus packets (ADR-019 §4, phase 3). Its own AudioContext at 48 kHz (the
 * browser resamples the track into it): microphone → effects (a pass-through gain today; phase 4
 * inserts the presets there) → a capture worklet that hands out 20 ms frames → `AudioEncoder`
 * (Opus, mono, 48 kHz) → `onOpus`. The microphone stays open once started so push-to-talk has no
 * ramp-up; while not transmitting the worklet drops the audio before it ever leaves the audio thread.
 */

import { OPUS_RATE, PACKET_US } from "./frames";
import { registerWorklet } from "./worklet";

/** 20 ms at 48 kHz, one Opus packet. */
const FRAME = 960;
const BITRATE = 32_000;

const CAPTURE_PROCESSOR = "beacon-voice-capture";

/**
 * Collects the 128-sample render quanta into 960-sample frames and posts each one, transferring the
 * buffer. Off (a `false` on the port) it does nothing at all, so an idle open microphone costs no
 * allocations and no main-thread wake-ups; on, it starts a fresh frame.
 */
const CAPTURE_SOURCE = `
class BeaconVoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(${FRAME});
    this.fill = 0;
    this.on = false;
    this.port.onmessage = (ev) => {
      this.on = ev.data === true;
      this.fill = 0;
    };
  }
  process(inputs) {
    if (!this.on) return true;
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    let i = 0;
    while (i < input.length) {
      const n = Math.min(input.length - i, ${FRAME} - this.fill);
      this.frame.set(input.subarray(i, i + n), this.fill);
      this.fill += n;
      i += n;
      if (this.fill === ${FRAME}) {
        this.port.postMessage(this.frame, [this.frame.buffer]);
        this.frame = new Float32Array(${FRAME});
        this.fill = 0;
      }
    }
    return true;
  }
}
registerProcessor(${JSON.stringify(CAPTURE_PROCESSOR)}, BeaconVoiceCapture);
`;

export interface VoiceTransmitterHandlers {
  /** One encoded packet while transmitting. */
  onOpus: (opus: Uint8Array, seq: number) => void;
}

export class VoiceTransmitter {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private encoder: AudioEncoder | null = null;
  private capture: AudioWorkletNode | null = null;
  private transmitting = false;
  private seq = 0;
  private lastLevel = 0;

  constructor(private readonly handlers: VoiceTransmitterHandlers) {}

  /** Call from a gesture: asks for the microphone and builds the graph. Throws when refused. */
  async start(): Promise<void> {
    if (this.ctx) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const ctx = new AudioContext({ sampleRate: OPUS_RATE, latencyHint: "interactive" });
    this.stream = stream;
    this.ctx = ctx;
    await registerWorklet(ctx, CAPTURE_PROCESSOR, CAPTURE_SOURCE);
    const source = ctx.createMediaStreamSource(stream);
    // Where phase 4 puts the effect presets: between the microphone and the capture.
    const effects = ctx.createGain();
    const capture = new AudioWorkletNode(ctx, CAPTURE_PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: "explicit",
    });
    source.connect(effects).connect(capture);
    capture.port.onmessage = (ev: MessageEvent<Float32Array>) => this.onFrame(ev.data);
    this.capture = capture;
    const encoder = new AudioEncoder({
      output: (chunk) => {
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        this.handlers.onOpus(bytes, this.seq++);
      },
      error: (e) => console.warn("voice: encoder", e),
    });
    encoder.configure({ codec: "opus", sampleRate: OPUS_RATE, numberOfChannels: 1, bitrate: BITRATE });
    this.encoder = encoder;
    await ctx.resume();
  }

  stop(): void {
    this.transmitting = false;
    this.capture?.port.close();
    this.capture?.disconnect();
    this.capture = null;
    try {
      if (this.encoder && this.encoder.state !== "closed") this.encoder.close();
    } catch {}
    this.encoder = null;
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
    this.lastLevel = 0;
  }

  get isTransmitting(): boolean {
    return this.transmitting;
  }

  /** Push-to-talk: the worklet captures while on. Releasing flushes the encoder so the last packets go out. */
  setTransmitting(on: boolean): void {
    if (this.transmitting === on) return;
    this.transmitting = on;
    this.capture?.port.postMessage(on);
    if (!on) {
      this.lastLevel = 0;
      const enc = this.encoder;
      if (enc && enc.state === "configured") void enc.flush().catch(() => {});
    }
  }

  /** RMS of the last captured frame while transmitting, 0..1, for a level meter. */
  level(): number {
    return this.lastLevel;
  }

  private onFrame(samples: Float32Array): void {
    if (!this.transmitting) return;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    this.lastLevel = Math.sqrt(sum / samples.length);
    const enc = this.encoder;
    if (enc?.state !== "configured") return;
    const data = new AudioData({
      format: "f32-planar",
      sampleRate: OPUS_RATE,
      numberOfFrames: samples.length,
      numberOfChannels: 1,
      timestamp: this.seq * PACKET_US,
      // The worklet transfers a plain ArrayBuffer; the lib's BufferSource typing cannot tell.
      data: samples as Float32Array<ArrayBuffer>,
    });
    enc.encode(data);
    data.close();
  }
}
