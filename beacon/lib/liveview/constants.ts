// Numbers the live view's component and its three.js modules must agree on. Kept free of three so
// the component can import them without pulling the renderer into the page bundle (the scenes
// themselves are loaded on demand).

/** Chunk radius the view can show; the server's view distance caps it further, the agent sees no farther. */
export const RADIUS_MIN = 2;
export const RADIUS_MAX = 32;

/** The sky dome's radius; the sun, moon and stars sit inside it and the camera's far plane beyond it. */
export const SKY_DOME_RADIUS = 1500;

/**
 * The hand-over from the waiting scene to the world: the charge runs the block up to white, the veil
 * only fades in over the last part of it, then the world fades in under the veil.
 */
export const HANDOVER_CHARGE_MS = 3000;
export const HANDOVER_VEIL_MS = 900;
export const HANDOVER_REVEAL_MS = 700;
