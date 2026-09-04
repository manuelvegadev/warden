import { Box, Eye, Map as MapIcon, Orbit, Plane } from "lucide-react";
import { CAMERA_TRAITS, type CameraMode } from "@/lib/liveview/camera-modes";

export { CAMERA_MODES } from "@/lib/liveview/camera-modes";

interface CameraCopy {
  label: string;
  icon: typeof Orbit;
  /** One line on what the mode shows, for the select's list. */
  short: string;
  /** How it is driven, for the hint under the scene and the settings' cheat-sheet; blank when there is nothing to drive. */
  controls: string;
  /** What the hint says instead while locked to a player. */
  locked?: (name: string) => string;
}

/** The camera modes as the viewer describes them, keyed by the scene's mode so the two cannot drift. */
export const CAMERAS: Record<CameraMode, CameraCopy> = {
  orbit: {
    label: "Orbit",
    icon: Orbit,
    short: "Turn around any point of the world",
    controls: "Left drag moves the world · right drag turns around the point under the cursor · wheel zooms to it",
  },
  fly: {
    label: "Fly",
    icon: Plane,
    short: "Free flight with the mouse and WASD",
    controls:
      "Click to look around · WASD · Space and Shift up and down · Ctrl faster · wheel sets the speed · Esc frees the mouse",
  },
  eyes: {
    label: "First person",
    icon: Eye,
    short: "Through the selected player's eyes",
    controls: "",
    locked: (name) => `Through ${name}'s eyes`,
  },
  isometric: {
    label: "Isometric",
    icon: Box,
    short: "Locked over the selected player at 45°",
    controls: "Drag turns around them · wheel zooms",
    locked: (name) => `Over ${name}`,
  },
  map: {
    label: "Map",
    icon: MapIcon,
    short: "Straight down, north up, no perspective",
    controls: "Drag pans · wheel zooms",
    locked: (name) => `Centred on ${name}`,
  },
};

export const CAMERA_LABELS = Object.fromEntries(Object.entries(CAMERAS).map(([m, c]) => [m, c.label])) as Record<
  CameraMode,
  string
>;

/** What the mode shows and how it is driven, in one line. */
export function cameraDescription(mode: CameraMode): string {
  const c = CAMERAS[mode];
  return c.controls ? `${c.short} · ${c.controls}` : c.short;
}

/** The line under the scene: who the camera is locked to and the controls, or the controls alone, or what is missing. */
export function cameraHint(mode: CameraMode, following: string | null): string {
  const c = CAMERAS[mode];
  if (following && c.locked) return [c.locked(following), c.controls].filter(Boolean).join(" · ");
  return CAMERA_TRAITS[mode].needsPlayer ? "Select a player" : c.controls;
}
