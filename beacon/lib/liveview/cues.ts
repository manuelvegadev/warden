/**
 * The two sound cues of the waiting scene's hand-over, the game's own: `block.beacon.activate` when
 * the first player arrives and the block burns to white, `block.beacon.deactivate` when the last one
 * leaves and the world flashes back to the waiting room. The transitions take exactly as long as the
 * sounds, so the durations come from the decoded audio; the measured lengths are the fallback for a
 * browser that cannot decode them.
 *
 * Playback needs a prior user gesture on the page (the autoplay policy); when the context stays
 * suspended the cue is silent and the transition still runs to the sound's length. The context is
 * the page's shared one (`lib/audio-context.ts`).
 */

import { uiAudioContext } from "@/lib/audio-context";
import { BEACON_ACTIVATE_MS, BEACON_DEACTIVATE_MS } from "./constants";

export type Cue = "activate" | "deactivate";

const FILES: Record<Cue, string> = {
  activate: "/liveview/beacon-activate.ogg",
  deactivate: "/liveview/beacon-deactivate.ogg",
};

const FALLBACK_MS: Record<Cue, number> = {
  activate: BEACON_ACTIVATE_MS,
  deactivate: BEACON_DEACTIVATE_MS,
};

const buffers = new Map<Cue, AudioBuffer | null>();
const loading = new Map<Cue, Promise<void>>();

/** Fetches and decodes a cue once; safe to call early, before any gesture. */
export function preloadCue(cue: Cue): Promise<void> {
  let p = loading.get(cue);
  if (!p) {
    p = fetch(FILES[cue])
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
      .then((b) => uiAudioContext().decodeAudioData(b))
      .then(
        (buf) => void buffers.set(cue, buf),
        (e) => {
          console.warn("cue:", cue, e);
          buffers.set(cue, null);
        },
      );
    loading.set(cue, p);
  }
  return p;
}

/** The cue's length in milliseconds: decoded when loaded, the measured fallback otherwise. */
function cueMs(cue: Cue): number {
  const buf = buffers.get(cue);
  return buf ? Math.round(buf.duration * 1000) : FALLBACK_MS[cue];
}

/** Plays the cue if it is loaded and the browser lets audio start; returns its length either way. */
export function playCue(cue: Cue): number {
  const buf = buffers.get(cue);
  if (buf) {
    const c = uiAudioContext();
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start();
  } else {
    void preloadCue(cue);
  }
  return cueMs(cue);
}
