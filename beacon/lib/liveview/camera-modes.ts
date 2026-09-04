// The camera modes and what each is like, declared once: the rig and the scene read these instead
// of comparing modes, and the panel's controls can import them without pulling three.js in.

export type CameraMode = "orbit" | "fly" | "eyes" | "isometric" | "map";

export interface CameraTraits {
  fov: number;
  /** Renders through the orthographic camera, straight down: no sides, no clouds, no fog, the ear on the ground. */
  ortho: boolean;
  /** The camera is placed by `aim` every frame (over the followed player or the pivot) rather than moved by hand. */
  aimed: boolean;
  /** The mode has no meaning without a player to be over or inside. */
  needsPlayer: boolean;
  /** Switching to the mode lands on the followed player. */
  lands: boolean;
  /** Looks at the players from outside: they get their outline. */
  outside: boolean;
}

/** The field of view: the panel's, a wide one for looking through a player's eyes, the isometric shot's narrow one. */
export const FOV = 55;
export const PLAYER_FOV = 90;
const ISOMETRIC_FOV = 45;

export const CAMERA_TRAITS: Record<CameraMode, CameraTraits> = {
  orbit: { fov: FOV, ortho: false, aimed: false, needsPlayer: false, lands: true, outside: true },
  fly: { fov: FOV, ortho: false, aimed: false, needsPlayer: false, lands: false, outside: true },
  eyes: { fov: PLAYER_FOV, ortho: false, aimed: false, needsPlayer: true, lands: false, outside: false },
  isometric: { fov: ISOMETRIC_FOV, ortho: false, aimed: true, needsPlayer: true, lands: true, outside: true },
  map: { fov: FOV, ortho: true, aimed: true, needsPlayer: false, lands: true, outside: false },
};

export const CAMERA_MODES = Object.keys(CAMERA_TRAITS) as CameraMode[];
