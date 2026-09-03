/**
 * Whether this browser can take part in voice chat (ADR-019 §4). The floor is Safari 26+ and
 * Chrome 94+, decided by what the browser exposes, never by its user agent: listening decodes Opus
 * with WebCodecs, speaking encodes with it, and both play through Web Audio.
 */
export function voiceSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof AudioDecoder !== "undefined" &&
    typeof AudioEncoder !== "undefined" &&
    typeof AudioContext !== "undefined" &&
    typeof AudioWorkletNode !== "undefined"
  );
}

/** The hint shown in place of the voice controls when `voiceSupported()` is false. */
export const VOICE_UNSUPPORTED = "Voice needs Safari 26+ or Chrome 94+";
