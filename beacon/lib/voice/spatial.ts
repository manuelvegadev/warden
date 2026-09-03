/**
 * The two spatial renderers behind the voice receiver (ADR-019 §4, phase 2). Both take mono
 * speakers and put them around a listener in world (scene) coordinates; the receiver only knows
 * this interface.
 *
 * - `resonance`, the default: Resonance Audio (Google, Apache-2.0, archived 2026 but built on
 *   native Web Audio nodes only). Third-order ambisonics decoded with the SADIE KU100 HRTFs, a room
 *   with early reflections that arrive from the right direction and a late reverb — the cues that
 *   make a voice sit outside the head. The room travels with the listener: Resonance keeps its room
 *   centred on the origin, so sources are fed relative to the camera.
 * - `browser`: the browser's own `PannerNode` in HRTF mode, no room. The fallback when Resonance
 *   cannot be loaded, and a choice for anyone who prefers it.
 *
 * Both share the elevation cue and the same discipline on the per-frame path: an AudioParam is a
 * message to the audio thread, so nothing is written unless it changed.
 */

import type { ResonanceAudio, RoomDimensions, RoomMaterials, Source } from "resonance-audio";
import { EYE_HEIGHT } from "@/lib/liveview/constants";

export const RENDERERS = ["resonance", "browser"] as const;
export type Renderer = (typeof RENDERERS)[number];

export const ROOM_PRESETS = ["outdoors", "room", "hall", "none"] as const;
export type RoomPreset = (typeof ROOM_PRESETS)[number];

/** One speaker's place in the field. */
export interface SpatialSource {
  /** Where the speaker's mono audio goes. */
  readonly input: AudioNode;
  setPosition(x: number, y: number, z: number): void;
  /** The distance at which the voice falls silent (linear falloff from 1 block). */
  setMaxDistance(d: number): void;
  dispose(): void;
}

export interface Spatializer {
  /** The renderer actually running: the requested one, or the browser's after a failed load. */
  readonly renderer: Renderer;
  createSource(maxDistance: number): SpatialSource;
  /** Position, forward and up of the listener: nine numbers. */
  setListener(pose: Float32Array): void;
  setRoom(preset: RoomPreset): void;
  setElevationCue(on: boolean): void;
  dispose(): void;
}

/**
 * Loads the requested renderer. Resonance may fail (a blocked script, an unsupported context); the
 * browser's panner then takes its place, and `renderer` on the result says which one is running.
 */
export async function createSpatializer(ctx: AudioContext, renderer: Renderer, room: RoomPreset): Promise<Spatializer> {
  if (renderer === "resonance") {
    try {
      const { ResonanceAudio } = await import("resonance-audio");
      return new ResonanceSpatializer(ctx, ResonanceAudio, room);
    } catch (e) {
      console.warn("voice: Resonance Audio unavailable, using the browser's renderer", e);
    }
  }
  return new PannerSpatializer(ctx);
}

// --- shared: the listener, the elevation cue, and not repeating oneself to the audio thread ---

/**
 * Pseudo-elevation: with a generic HRTF the ear cannot tell up from down, but spectral energy
 * between 2 and 10 kHz reads as height (Rajendran & Gamper, JASA 2019). A peaking filter centred
 * in that band, boosted for voices above the listener and cut for voices below, proportional to
 * the elevation angle and saturating at 45°.
 */
const ELEVATION_HZ = 5_000;
const ELEVATION_Q = 0.6;
const ELEVATION_DB = 6;
/** Below these, a change is not worth a message to the audio thread. */
const MOVE_EPSILON = 0.01;
const GAIN_EPSILON_DB = 0.05;

abstract class BaseSpatializer implements Spatializer {
  abstract readonly renderer: Renderer;
  /** The listener's last pose; sources read its position for the elevation cue. */
  readonly pose = new Float32Array(9);
  protected readonly sources = new Set<BaseSource>();
  private elevation = true;

  constructor(protected readonly ctx: AudioContext) {}

  abstract createSource(maxDistance: number): SpatialSource;

  /** The renderer's own listener update, called when the pose changed. */
  protected abstract applyListener(pose: Float32Array): void;

  setListener(pose: Float32Array): void {
    let moved = false;
    let turned = false;
    for (let i = 0; i < 9; i++) {
      if (Math.abs(pose[i] - this.pose[i]) > (i < 3 ? MOVE_EPSILON : 1e-4)) {
        if (i < 3) moved = true;
        else turned = true;
      }
    }
    if (!moved && !turned) return;
    this.pose.set(pose);
    this.applyListener(pose);
    if (moved) for (const s of this.sources) s.replace();
  }

  setRoom(_preset: RoomPreset): void {}

  setElevationCue(on: boolean): void {
    this.elevation = on;
    for (const s of this.sources) s.replace();
  }

  get elevationCue(): boolean {
    return this.elevation;
  }

  dispose(): void {
    for (const s of this.sources) s.dispose();
  }
}

/**
 * A source of either renderer: the elevation filter in front of the renderer's input, the last
 * position remembered so nothing is re-sent while a speaker (or a parked one) stays put.
 */
abstract class BaseSource implements SpatialSource {
  readonly input: BiquadFilterNode;
  private x = Number.NaN;
  private y = Number.NaN;
  private z = Number.NaN;
  private gainDb = 0;

  constructor(
    protected readonly owner: BaseSpatializer,
    ctx: AudioContext,
    target: AudioNode,
  ) {
    this.input = new BiquadFilterNode(ctx, { type: "peaking", frequency: ELEVATION_HZ, Q: ELEVATION_Q, gain: 0 });
    this.input.connect(target);
  }

  /** The renderer's own placement, in world coordinates. */
  protected abstract place(x: number, y: number, z: number): void;
  abstract setMaxDistance(d: number): void;

  setPosition(x: number, y: number, z: number): void {
    if (
      Math.abs(x - this.x) < MOVE_EPSILON &&
      Math.abs(y - this.y) < MOVE_EPSILON &&
      Math.abs(z - this.z) < MOVE_EPSILON
    ) {
      return;
    }
    this.x = x;
    this.y = y;
    this.z = z;
    this.replace();
  }

  /** Re-sends the current position: the listener moved, or the cue was toggled. */
  replace(): void {
    if (Number.isNaN(this.x)) return;
    this.place(this.x, this.y, this.z);
    const pose = this.owner.pose;
    let db = 0;
    if (this.owner.elevationCue) {
      const dx = this.x - pose[0];
      const dy = this.y - pose[1];
      const dz = this.z - pose[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // sin(elevation) saturating at 45°: ±1 → ±ELEVATION_DB.
      const t = d > 0.5 ? Math.max(-1, Math.min(1, (dy / d) * Math.SQRT2)) : 0;
      db = t * ELEVATION_DB;
    }
    if (Math.abs(db - this.gainDb) > GAIN_EPSILON_DB) {
      this.gainDb = db;
      this.input.gain.value = db;
    }
  }

  dispose(): void {
    this.input.disconnect();
  }
}

// --- the browser's PannerNode ---

class PannerSpatializer extends BaseSpatializer {
  readonly renderer = "browser" as const;

  createSource(maxDistance: number): SpatialSource {
    const s = new PannerSource(this, this.ctx, maxDistance);
    this.sources.add(s);
    return s;
  }

  protected applyListener(pose: Float32Array): void {
    const l = this.ctx.listener;
    l.positionX.value = pose[0];
    l.positionY.value = pose[1];
    l.positionZ.value = pose[2];
    l.forwardX.value = pose[3];
    l.forwardY.value = pose[4];
    l.forwardZ.value = pose[5];
    l.upX.value = pose[6];
    l.upY.value = pose[7];
    l.upZ.value = pose[8];
  }
}

class PannerSource extends BaseSource {
  private readonly panner: PannerNode;

  constructor(owner: PannerSpatializer, ctx: AudioContext, maxDistance: number) {
    // The game's model: full volume up close, fading linearly to nothing at the voice distance.
    const panner = new PannerNode(ctx, {
      panningModel: "HRTF",
      distanceModel: "linear",
      refDistance: 1,
      rolloffFactor: 1,
      maxDistance,
    });
    panner.connect(ctx.destination);
    super(owner, ctx, panner);
    this.panner = panner;
  }

  protected place(x: number, y: number, z: number): void {
    this.panner.positionX.value = x;
    this.panner.positionY.value = y;
    this.panner.positionZ.value = z;
  }

  setMaxDistance(d: number): void {
    this.panner.maxDistance = d;
  }

  dispose(): void {
    super.dispose();
    this.panner.disconnect();
  }
}

// --- Resonance Audio ---

type Room = {
  dimensions: RoomDimensions;
  materials: RoomMaterials;
  /** Whether the late reverb tail plays. Off outdoors: the open air reflects but has no tail. */
  reverb: boolean;
};

/**
 * The rooms. Outdoors is the Minecraft default: open sky and walls so far they do not reflect, a
 * grass floor for the one reflection that anchors a voice to the ground. The others are for those
 * who want a space around the voices; none is the bare HRTF.
 */
const ROOMS: Record<RoomPreset, Room> = {
  outdoors: {
    // Wide and tall enough that a player anywhere within voice range, above or below, is still
    // "inside": Resonance fades the room sends out for sources beyond its walls. Sabine's formula
    // would give a room this size a tail of seconds, so the late reverb is muted and only the floor
    // reflection remains.
    dimensions: { width: 120, height: 60, depth: 120 },
    reverb: false,
    materials: {
      left: "transparent",
      right: "transparent",
      front: "transparent",
      back: "transparent",
      down: "grass",
      up: "transparent",
    },
  },
  room: {
    dimensions: { width: 10, height: 3.4, depth: 12 },
    reverb: true,
    materials: {
      left: "plaster-smooth",
      right: "plaster-smooth",
      front: "plaster-smooth",
      back: "curtain-heavy",
      down: "wood-panel",
      up: "plaster-rough",
    },
  },
  hall: {
    dimensions: { width: 30, height: 12, depth: 45 },
    reverb: true,
    materials: {
      left: "concrete-block-coarse",
      right: "concrete-block-coarse",
      front: "brick-bare",
      back: "brick-bare",
      down: "polished-concrete-or-tile",
      up: "wood-ceiling",
    },
  },
  none: {
    dimensions: { width: 0, height: 0, depth: 0 },
    reverb: false,
    materials: {
      left: "transparent",
      right: "transparent",
      front: "transparent",
      back: "transparent",
      down: "transparent",
      up: "transparent",
    },
  },
};

/** The listener's height inside a room centred on the origin: ears at eye height above the floor at -height/2. */
function listenerY(room: Room): number {
  return room.dimensions.height > 0 ? EYE_HEIGHT - room.dimensions.height / 2 : 0;
}

class ResonanceSpatializer extends BaseSpatializer {
  readonly renderer = "resonance" as const;
  readonly scene: ResonanceAudio;
  /** The listener's height in the current room; sources are fed relative to the camera plus this. */
  listenerY: number;

  constructor(ctx: AudioContext, Resonance: typeof ResonanceAudio, room: RoomPreset) {
    super(ctx);
    const r = ROOMS[room];
    this.listenerY = listenerY(r);
    this.scene = new Resonance(ctx, {
      ambisonicOrder: 3,
      dimensions: r.dimensions,
      materials: r.materials,
      listenerPosition: [0, this.listenerY, 0],
    });
    this.scene.output.connect(ctx.destination);
    this.scene._room.late.output.gain.value = r.reverb ? 1 : 0;
  }

  createSource(maxDistance: number): SpatialSource {
    const s = new ResonanceSource(this, this.ctx, maxDistance);
    this.sources.add(s);
    return s;
  }

  protected applyListener(pose: Float32Array): void {
    // The room stays put around the listener: a turn rotates the sound field here, a move re-places
    // the sources relative to the camera (the base class does that).
    this.scene.setListenerOrientation(pose[3], pose[4], pose[5], pose[6], pose[7], pose[8]);
  }

  setRoom(preset: RoomPreset): void {
    const r = ROOMS[preset];
    this.listenerY = listenerY(r);
    this.scene.setRoomProperties(r.dimensions, r.materials);
    this.scene.setListenerPosition(0, this.listenerY, 0);
    this.scene._room.late.output.gain.value = r.reverb ? 1 : 0;
    for (const s of this.sources) s.replace();
  }

  dispose(): void {
    super.dispose();
    this.scene.output.disconnect();
  }
}

class ResonanceSource extends BaseSource {
  private readonly src: Source;

  constructor(
    private readonly scene: ResonanceSpatializer,
    ctx: AudioContext,
    maxDistance: number,
  ) {
    const src = scene.scene.createSource({ rolloff: "linear", minDistance: 1, maxDistance });
    super(scene, ctx, src.input);
    this.src = src;
  }

  protected place(x: number, y: number, z: number): void {
    const p = this.scene.pose;
    this.src.setPosition(x - p[0], y - p[1] + this.scene.listenerY, z - p[2]);
  }

  setMaxDistance(d: number): void {
    this.src.setMaxDistance(d);
  }

  dispose(): void {
    super.dispose();
    this.src.input.disconnect();
  }
}
