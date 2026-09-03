// Numbers the live view's component and its three.js modules must agree on. Kept free of three so
// the component can import them without pulling the renderer into the page bundle (the scenes
// themselves are loaded on demand).

/** Chunk radius the view can show; the server's view distance caps it further, the agent sees no farther. */
export const RADIUS_MIN = 2;
export const RADIUS_MAX = 32;

/** The sky dome's radius; the sun, moon and stars sit inside it and the camera's far plane beyond it. */
export const SKY_DOME_RADIUS = 1500;

/**
 * The hand-over between the waiting scene and the world is paced by the game's beacon sounds
 * (`lib/liveview/cues.ts`); these are their measured lengths, used when they cannot be decoded.
 * Arriving: the charge runs the block up to white over the sound minus the reveal, the veil fades
 * in over the last part of the charge, then the world fades in under the veil for the reveal.
 * Leaving: a flash to white over the onset, then the waiting room fades in over the sound's decay.
 */
export const BEACON_ACTIVATE_MS = 2953;
export const BEACON_DEACTIVATE_MS = 3501;
export const HANDOVER_VEIL_MS = 900;
export const HANDOVER_REVEAL_MS = 700;
export const HANDOVER_FLASH_MS = 250;

/** A player's eyes above their feet, standing and sneaking (the game's values): the camera in player mode and where a voice comes from. */
export const EYE_HEIGHT = 1.62;
export const EYE_HEIGHT_SNEAKING = 1.27;
