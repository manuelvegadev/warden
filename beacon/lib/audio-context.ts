/**
 * The page's one AudioContext for short sounds: the beacon hand-over cues and the voice controls'
 * blips. Created lazily, never closed (a context is an output stream; one per page is plenty), and
 * resumed on every use so a call from a click can start audio. It plays through the output device
 * chosen for voice, so the cues come out of the same headphones.
 */
let ctx: AudioContext | null = null;
let output = "";

export function uiAudioContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    void applyOutput(ctx, output);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** The output device the cues play through, by `deviceId`; "" is the browser's default. */
export function setUiOutput(deviceId: string): void {
  output = deviceId;
  if (ctx) void applyOutput(ctx, deviceId);
}

/** `AudioContext.setSinkId` (Chrome) is not in the DOM typings yet. */
type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };

/** Whether this browser can route an AudioContext to a chosen output device. */
export function canChooseOutput(): boolean {
  return typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;
}

/**
 * Routes a context to an output device; "" is the default. Quietly stays on the default where the
 * browser cannot (Safari) or the device is gone.
 */
export async function applyOutput(context: AudioContext, deviceId: string): Promise<void> {
  try {
    await (context as SinkContext).setSinkId?.(deviceId);
  } catch (e) {
    console.warn("audio: output device", e);
  }
}
