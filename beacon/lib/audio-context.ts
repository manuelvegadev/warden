/**
 * The page's one AudioContext for short sounds: the beacon hand-over cues and the voice controls'
 * blips. Created lazily, never closed (a context is an output stream; one per page is plenty), and
 * resumed on every use so a call from a click can start audio.
 */
let ctx: AudioContext | null = null;

export function uiAudioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}
