/**
 * The panel's own voice sounds, synthesized: one sine blip per action, the smallest signal that
 * still says something. Join bends upward, leave bends downward, mute is a flat blip (unmute and
 * undeafen reuse it: the switch clicked back) and deafen a flat pair. They answer a click, so the
 * context can start on the spot; nothing is loaded.
 */

import { uiAudioContext } from "@/lib/audio-context";

export type UiCue = "join" | "leave" | "mute" | "deafen";

/** A sine blip with a short attack, a hold and a release, optionally gliding to another pitch. */
function blip(
  c: AudioContext,
  t: number,
  from: number,
  hold: number,
  release: number,
  peak: number,
  to?: number,
): void {
  const attack = 0.006;
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.setValueAtTime(from, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + attack + hold);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.setValueAtTime(peak, t + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + attack + hold + release + 0.02);
}

const CUES: Record<UiCue, (c: AudioContext, t: number) => void> = {
  join: (c, t) => blip(c, t, 420, 0.1, 0.1, 0.4, 640),
  leave: (c, t) => blip(c, t, 640, 0.1, 0.12, 0.4, 420),
  mute: (c, t) => blip(c, t, 300, 0.05, 0.06, 0.3),
  deafen: (c, t) => {
    blip(c, t, 300, 0.04, 0.05, 0.3);
    blip(c, t + 0.09, 300, 0.04, 0.08, 0.3);
  },
};

/** Plays a cue; call it from the click that caused it. */
export function playUiCue(cue: UiCue): void {
  try {
    const c = uiAudioContext();
    CUES[cue](c, c.currentTime + 0.01);
  } catch (e) {
    console.warn("voice: ui cue", e);
  }
}
