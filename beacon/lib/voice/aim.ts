/**
 * Where the admin's voice goes (ADR-019 §4, phase 3): the policy that turns the camera mode and the
 * viewer's choices into the header of every speak packet and the marker drawn in the scene. Pure,
 * so it is testable without React or three.js.
 */

import { SPEAK_ENTITY, SPEAK_LOCATIONAL, SPEAK_STATIC } from "./frames";

export const TARGETS = ["auto", "everyone"] as const;
export type Target = (typeof TARGETS)[number];
/** Radius steps for a locational voice, in blocks; `max` is the server's voice distance. */
export const RADII = ["8", "16", "32", "max"] as const;
export type Radius = (typeof RADII)[number];

/** The "conscience": an entity voice whispers to the followed player from this close. */
export const CONSCIENCE_DISTANCE = 2;

export type SpeakTargetKind = "camera" | "entity" | "none";

/**
 * What aiming needs from the scene every frame: where the current camera mode puts the voice, the
 * player the camera follows, the world shown, and a marker while talking.
 */
export interface SpeakStage {
  readonly worldName: string;
  /** Writes the point into `out` (three numbers) and says what it is. */
  speakTarget(out: Float32Array): SpeakTargetKind;
  followedUuid(): string | null;
  /** The emission point and reach, with the voice level 0..1 the drawing follows. */
  setEmitter(x: number, y: number, z: number, radius: number, level: number): void;
  clearEmitter(): void;
}

export interface AimPrefs {
  /** `auto` follows the camera mode (the camera, or the followed player); `everyone` is the static channel. */
  target: Target;
  radius: Radius;
}

/** The header every packet carries while an aim holds: one shape per channel kind. */
export type SpeakHead =
  | { mode: typeof SPEAK_STATIC; whisper: false; distance: 0 }
  | { mode: typeof SPEAK_LOCATIONAL; whisper: false; distance: number; world: string; x: number; y: number; z: number }
  | { mode: typeof SPEAK_ENTITY; whisper: true; distance: number; uuid: string };

export interface Aim {
  head: SpeakHead;
  /** Where the emitter is drawn and how far it reaches; null when the scene has no point for it. */
  marker: { x: number; y: number; z: number; radius: number } | null;
}

/**
 * The aim for this frame, or null when there is nowhere to speak from (player mode with nobody
 * followed). Everyone → the static channel; player mode → the followed player's entity channel,
 * whispered from up close; otherwise a locational voice at the camera with the chosen reach.
 */
export function aim(stage: SpeakStage, prefs: AimPrefs, maxDistance: number, out: Float32Array): Aim | null {
  const kind = stage.speakTarget(out);
  const point = kind === "none" ? null : { x: out[0], y: out[1], z: out[2] };
  if (prefs.target === "everyone") {
    return { head: { mode: SPEAK_STATIC, whisper: false, distance: 0 }, marker: point && { ...point, radius: 0 } };
  }
  if (!point) return null;
  if (kind === "entity") {
    const uuid = stage.followedUuid();
    if (!uuid) return null;
    return {
      head: { mode: SPEAK_ENTITY, whisper: true, distance: CONSCIENCE_DISTANCE, uuid },
      marker: { ...point, radius: CONSCIENCE_DISTANCE },
    };
  }
  const radius = prefs.radius === "max" ? maxDistance : Math.min(Number(prefs.radius), maxDistance);
  return {
    head: { mode: SPEAK_LOCATIONAL, whisper: false, distance: radius, world: stage.worldName, ...point },
    marker: { ...point, radius },
  };
}
