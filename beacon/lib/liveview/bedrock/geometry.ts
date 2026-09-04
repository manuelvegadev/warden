// Bedrock entity geometry (the `.geo.json` files of Mojang's resource pack, and the older
// `mobs.json`): bones with a pivot and cubes, textured the way Minecraft unwraps a box. This module
// reads them and lays out the vertices; it knows nothing of three.js, so it is tested on its own.
//
// Spaces. A file's coordinates are the game's model space: 16 units to a block, y up, the model
// facing north (−z), its right arm at negative x. The game draws models mirrored in x (a person
// facing you has their right hand on your left), so the vertices come out with x negated: that is
// the space the scene places bones in, and it is why a bone's x and y rotations flip sign
// (`toModelRotation`) while z keeps it.

export type Vec3 = [number, number, number];

export interface FaceUV {
  uv: [number, number];
  uv_size?: [number, number];
}

export type FaceName = "north" | "south" | "east" | "west" | "up" | "down";

export interface CubeDef {
  origin: Vec3;
  size: Vec3;
  /** Box UV: the top-left of the unwrapped box; or one rectangle per face. */
  uv: [number, number] | Partial<Record<FaceName, FaceUV>>;
  inflate: number;
  mirror: boolean;
  pivot?: Vec3;
  /** Degrees, the file's convention. */
  rotation?: Vec3;
}

export interface BoneDef {
  name: string;
  parent?: string;
  pivot: Vec3;
  /** Degrees, the file's convention; the rest pose. */
  rotation: Vec3;
  cubes: CubeDef[];
}

export interface Geometry {
  id: string;
  textureWidth: number;
  textureHeight: number;
  bones: BoneDef[];
}

/** The vertices of a whole model, every vertex weighted to one bone. */
export interface ModelBuffers {
  positions: Float32Array;
  /** Texture coordinates, already 0..1 with v flipped for a texture uploaded the usual way. */
  uvs: Float32Array;
  /** Per vertex: the index of its bone in the geometry's bone list. */
  boneIndex: Uint16Array;
  indices: Uint32Array;
}

// --- parsing ---

const vec = (v: unknown, fallback: Vec3 = [0, 0, 0]): Vec3 =>
  Array.isArray(v) && v.length === 3 ? [Number(v[0]), Number(v[1]), Number(v[2])] : fallback;

interface RawCube {
  origin?: unknown;
  size?: unknown;
  uv?: unknown;
  inflate?: unknown;
  mirror?: unknown;
  pivot?: unknown;
  rotation?: unknown;
}

interface RawBone {
  name: string;
  parent?: string;
  pivot?: unknown;
  rotation?: unknown;
  mirror?: unknown;
  cubes?: RawCube[];
}

function parseBone(raw: RawBone): BoneDef {
  const mirror = raw.mirror === true;
  return {
    name: raw.name,
    parent: raw.parent,
    pivot: vec(raw.pivot),
    rotation: vec(raw.rotation),
    cubes: (raw.cubes ?? []).map((c) => ({
      origin: vec(c.origin),
      size: vec(c.size),
      uv: (Array.isArray(c.uv) ? [Number(c.uv[0]), Number(c.uv[1])] : (c.uv ?? [0, 0])) as CubeDef["uv"],
      inflate: Number(c.inflate ?? 0),
      mirror: c.mirror === undefined ? mirror : c.mirror === true,
      pivot: c.pivot === undefined ? undefined : vec(c.pivot),
      rotation: c.rotation === undefined ? undefined : vec(c.rotation),
    })),
  };
}

/**
 * Every geometry in a file, by identifier. Reads the current format (`minecraft:geometry` with a
 * description) and the old one (`geometry.<name>` keys, where `a:b` means a extends b and takes
 * b's bones under its own).
 */
export function parseGeometries(doc: unknown): Map<string, Geometry> {
  const out = new Map<string, Geometry>();
  if (!doc || typeof doc !== "object") return out;
  const d = doc as Record<string, unknown>;
  const modern = d["minecraft:geometry"];
  if (Array.isArray(modern)) {
    for (const g of modern as Array<{ description?: Record<string, unknown>; bones?: RawBone[] }>) {
      const desc = g.description ?? {};
      const id = String(desc.identifier ?? "");
      if (!id) continue;
      out.set(id, {
        id,
        textureWidth: Number(desc.texture_width ?? 64),
        textureHeight: Number(desc.texture_height ?? 64),
        bones: (g.bones ?? []).map(parseBone),
      });
    }
    return out;
  }
  // The old format: parents first, so a child can take their bones.
  const legacy = Object.keys(d).filter((k) => k.startsWith("geometry."));
  const pending = new Map(legacy.map((k) => [k.split(":")[0], k]));
  const build = (id: string): Geometry | undefined => {
    const known = out.get(id);
    if (known) return known;
    const key = pending.get(id);
    if (!key) return undefined;
    const [, parentId] = key.split(":");
    const g = d[key] as { texturewidth?: unknown; textureheight?: unknown; bones?: RawBone[] };
    const parent = parentId ? build(parentId) : undefined;
    const bones = new Map<string, BoneDef>();
    for (const b of parent?.bones ?? []) bones.set(b.name, b);
    for (const b of (g.bones ?? []).map(parseBone)) bones.set(b.name, b);
    const geo: Geometry = {
      id,
      textureWidth: Number(g.texturewidth ?? parent?.textureWidth ?? 64),
      textureHeight: Number(g.textureheight ?? parent?.textureHeight ?? 64),
      bones: [...bones.values()],
    };
    out.set(id, geo);
    return geo;
  };
  for (const id of pending.keys()) build(id);
  return out;
}

// --- vertices ---

const DEG = Math.PI / 180;

/** A file rotation, degrees, as radians in the mirrored model space. */
export function toModelRotation(deg: Vec3): Vec3 {
  return [-deg[0] * DEG, -deg[1] * DEG, deg[2] * DEG];
}

/** A file position or offset in the mirrored model space. */
export const toModelPosition = (p: Vec3): Vec3 => [-p[0], p[1], p[2]];

/**
 * The corners of one face in file space, in the order the texture reads them: top-left, top-right,
 * bottom-right, bottom-left, exactly as the game assigns them (the file space is mirrored, so
 * "left" here is the viewer's right once drawn). Tops read with the back edge up, bottoms with the
 * front edge up.
 */
function faceCorners(name: FaceName, a: Vec3, b: Vec3): [Vec3, Vec3, Vec3, Vec3] {
  const [x0, y0, z0] = a;
  const [x1, y1, z1] = b;
  switch (name) {
    case "north":
      return [
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y0, z0],
        [x0, y0, z0],
      ];
    case "south":
      return [
        [x1, y1, z1],
        [x0, y1, z1],
        [x0, y0, z1],
        [x1, y0, z1],
      ];
    case "west":
      return [
        [x0, y1, z1],
        [x0, y1, z0],
        [x0, y0, z0],
        [x0, y0, z1],
      ];
    case "east":
      return [
        [x1, y1, z0],
        [x1, y1, z1],
        [x1, y0, z1],
        [x1, y0, z0],
      ];
    case "up":
      return [
        [x0, y1, z1],
        [x1, y1, z1],
        [x1, y1, z0],
        [x0, y1, z0],
      ];
    case "down":
      return [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
        [x0, y0, z1],
      ];
  }
}

/**
 * The texture rectangle of each face, in pixels, top-left and bottom-right, from the box layout
 * the game uses: the top and bottom in the first row, then the four sides in a row (west, north,
 * east, south) at the box's height. `mirror` swaps the two sides and reads every face right to left.
 */
export function boxFaceRects(
  uv: [number, number],
  size: Vec3,
  mirror: boolean,
): Record<FaceName, [number, number, number, number]> {
  const [u, v] = uv;
  const [w, h, d] = size;
  const rects: Record<FaceName, [number, number, number, number]> = {
    up: [u + d, v, u + d + w, v + d],
    down: [u + d + w, v + d, u + d + 2 * w, v], // the game draws the bottom flipped
    west: [u, v + d, u + d, v + d + h],
    north: [u + d, v + d, u + d + w, v + d + h],
    east: [u + d + w, v + d, u + 2 * d + w, v + d + h],
    south: [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h],
  };
  if (mirror) {
    const west = rects.west;
    rects.west = rects.east;
    rects.east = west;
    for (const k of Object.keys(rects) as FaceName[]) {
      const r = rects[k];
      rects[k] = [r[2], r[1], r[0], r[3]];
    }
  }
  return rects;
}

function faceRects(cube: CubeDef): Partial<Record<FaceName, [number, number, number, number]>> {
  if (Array.isArray(cube.uv)) return boxFaceRects(cube.uv, cube.size, cube.mirror);
  const out: Partial<Record<FaceName, [number, number, number, number]>> = {};
  for (const [name, f] of Object.entries(cube.uv) as [FaceName, FaceUV | undefined][]) {
    if (!f) continue;
    const [w, h, d] = cube.size;
    const fallback: [number, number] =
      name === "up" || name === "down" ? [w, d] : name === "east" || name === "west" ? [d, h] : [w, h];
    const [sw, sh] = f.uv_size ?? fallback;
    out[name] = [f.uv[0], f.uv[1], f.uv[0] + sw, f.uv[1] + sh];
  }
  return out;
}

/** Rotates `p` about `pivot` by a file rotation in degrees, applied z, then y, then x. */
function rotateAbout(p: Vec3, pivot: Vec3, deg: Vec3): Vec3 {
  let [x, y, z] = [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]];
  const rz = deg[2] * DEG;
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  const ry = deg[1] * DEG;
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  const rx = deg[0] * DEG;
  [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  return [x + pivot[0], y + pivot[1], z + pivot[2]];
}

const FACES: FaceName[] = ["north", "south", "west", "east", "up", "down"];

/**
 * Lays out every cube of every bone: 4 vertices and 6 indices per face, positions in the mirrored
 * model space relative to nothing (the bones' rest transforms are the identity at bind time), each
 * vertex owned by its bone.
 */
export function buildBuffers(geo: Geometry): ModelBuffers {
  const positions: number[] = [];
  const uvs: number[] = [];
  const boneIndex: number[] = [];
  const indices: number[] = [];
  const tw = geo.textureWidth;
  const th = geo.textureHeight;
  geo.bones.forEach((bone, bi) => {
    for (const cube of bone.cubes) {
      const inf = cube.inflate;
      const a: Vec3 = [cube.origin[0] - inf, cube.origin[1] - inf, cube.origin[2] - inf];
      const b: Vec3 = [
        cube.origin[0] + cube.size[0] + inf,
        cube.origin[1] + cube.size[1] + inf,
        cube.origin[2] + cube.size[2] + inf,
      ];
      const rects = faceRects(cube);
      for (const name of FACES) {
        const rect = rects[name];
        if (!rect) continue;
        const [u0, v0, u1, v1] = rect;
        if (u0 === u1 || v0 === v1) continue; // a face with no texture is not drawn
        const corners = faceCorners(name, a, b);
        const uvCorners: [number, number][] = [
          [u0, v0],
          [u1, v0],
          [u1, v1],
          [u0, v1],
        ];
        const base = positions.length / 3;
        for (let k = 0; k < 4; k++) {
          let p = corners[k];
          if (cube.rotation) p = rotateAbout(p, cube.pivot ?? cube.origin, cube.rotation);
          positions.push(-p[0], p[1], p[2]);
          uvs.push(uvCorners[k][0] / tw, 1 - uvCorners[k][1] / th);
          boneIndex.push(bi);
        }
        // Counter-clockwise in file space, so clockwise once x is mirrored: reversed to face outward.
        indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    }
  });
  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    boneIndex: new Uint16Array(boneIndex),
    indices: new Uint32Array(indices),
  };
}
