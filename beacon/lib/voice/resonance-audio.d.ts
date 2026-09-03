/**
 * The parts of Resonance Audio's UMD build (1.0.0, Apache-2.0) the voice renderer uses. The
 * package ships no types; the dependency is pinned, and the library is archived, so this is the
 * whole contract we rely on — including the one internal, noted where it is declared.
 */
declare module "resonance-audio" {
  export type RoomMaterial =
    | "transparent"
    | "acoustic-ceiling-tiles"
    | "brick-bare"
    | "brick-painted"
    | "concrete-block-coarse"
    | "concrete-block-painted"
    | "curtain-heavy"
    | "fiber-glass-insulation"
    | "glass-thin"
    | "glass-thick"
    | "grass"
    | "linoleum-on-concrete"
    | "marble"
    | "metal"
    | "parquet-on-concrete"
    | "plaster-rough"
    | "plaster-smooth"
    | "plywood-panel"
    | "polished-concrete-or-tile"
    | "sheet-rock"
    | "water-or-ice-surface"
    | "wood-ceiling"
    | "wood-panel"
    | "uniform";

  export interface RoomDimensions {
    width: number;
    height: number;
    depth: number;
  }

  export interface RoomMaterials {
    left: RoomMaterial;
    right: RoomMaterial;
    front: RoomMaterial;
    back: RoomMaterial;
    down: RoomMaterial;
    up: RoomMaterial;
  }

  export interface SourceOptions {
    minDistance?: number;
    maxDistance?: number;
    rolloff?: "logarithmic" | "linear" | "none";
  }

  export class Source {
    readonly input: GainNode;
    setPosition(x: number, y: number, z: number): void;
    setMaxDistance(d: number): void;
  }

  export interface ResonanceAudioOptions {
    ambisonicOrder?: 1 | 2 | 3;
    listenerPosition?: [number, number, number];
    dimensions?: RoomDimensions;
    materials?: RoomMaterials;
  }

  export class ResonanceAudio {
    constructor(context: BaseAudioContext, options?: ResonanceAudioOptions);
    readonly output: GainNode;
    /**
     * Internal. The late reverb is derived from the room with no switch to turn it off; muting its
     * output node is the only seam, and the outdoor preset needs it (spatial.ts).
     */
    readonly _room: { late: { output: GainNode } };
    createSource(options?: SourceOptions): Source;
    setRoomProperties(dimensions: RoomDimensions, materials: RoomMaterials): void;
    setListenerPosition(x: number, y: number, z: number): void;
    setListenerOrientation(fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void;
  }
}
