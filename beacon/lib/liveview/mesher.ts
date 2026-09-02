// Turns a decoded chunk into geometry: one quad per exposed face, colour from the palette, shade by
// face direction and per-vertex ambient occlusion baked into the vertex colour. Runs in the worker.
import { type ChunkData, FLAG_WATER } from "./format";

export interface MeshData {
  positions: Float32Array;
  /** 3 bytes per vertex, normalized. */
  colors: Uint8Array;
  indices: Uint32Array;
  waterPositions: Float32Array;
  waterColors: Uint8Array;
  waterIndices: Uint32Array;
}

/** The chunk at (dx, dz) relative to the one being meshed; undefined = not loaded (treated as air). */
export type NeighborLookup = (dx: -1 | 0 | 1, dz: -1 | 0 | 1) => ChunkData | undefined;

const AIR = 0;
const SOLID = 1;
const WATER = 2;

// Face table: normal, the two tangents, and the corner order. `order` lists (i, j) packed as i*2+j:
// positive faces go 00, 10, 11, 01 (counter-clockwise seen from outside, since cross(T1, T2) = +N);
// negative faces take the reverse.
const CCW = [0, 2, 3, 1] as const;
const CW = [0, 1, 3, 2] as const;
const FACES = [
  { n: [1, 0, 0], t1: [0, 1, 0], t2: [0, 0, 1], order: CCW, shade: 0.72 }, // +x east
  { n: [-1, 0, 0], t1: [0, 1, 0], t2: [0, 0, 1], order: CW, shade: 0.72 }, // -x west
  { n: [0, 1, 0], t1: [0, 0, 1], t2: [1, 0, 0], order: CCW, shade: 1.0 }, // +y top
  { n: [0, -1, 0], t1: [0, 0, 1], t2: [1, 0, 0], order: CW, shade: 0.5 }, // -y bottom
  { n: [0, 0, 1], t1: [1, 0, 0], t2: [0, 1, 0], order: CCW, shade: 0.82 }, // +z south
  { n: [0, 0, -1], t1: [1, 0, 0], t2: [0, 1, 0], order: CW, shade: 0.82 }, // -z north
] as const;

const AO_FACTOR = [0.5, 0.68, 0.84, 1.0];

/** Grows typed arrays geometrically and hands out exact-size views: no JS arrays, no final copy. */
class Builder {
  private positions = new Float32Array(12 * 256);
  private colors = new Uint8Array(12 * 256);
  private indices = new Uint32Array(6 * 256);
  private quads = 0;

  quad(corners: number[][], color: [number, number, number], ao: number[], shade: number) {
    if ((this.quads + 1) * 12 > this.positions.length) this.grow();
    const q = this.quads;
    const base = q * 4;
    for (let i = 0; i < 4; i++) {
      const p = (q * 4 + i) * 3;
      this.positions[p] = corners[i][0];
      this.positions[p + 1] = corners[i][1];
      this.positions[p + 2] = corners[i][2];
      const f = shade * AO_FACTOR[ao[i]];
      this.colors[p] = Math.round(color[0] * f);
      this.colors[p + 1] = Math.round(color[1] * f);
      this.colors[p + 2] = Math.round(color[2] * f);
    }
    // Flip the diagonal when the occlusion is uneven, so the darker corners interpolate cleanly.
    const ix = q * 6;
    if (ao[0] + ao[2] > ao[1] + ao[3]) {
      this.indices.set([base, base + 1, base + 2, base, base + 2, base + 3], ix);
    } else {
      this.indices.set([base + 1, base + 2, base + 3, base + 1, base + 3, base], ix);
    }
    this.quads++;
  }

  private grow() {
    const positions = new Float32Array(this.positions.length * 2);
    positions.set(this.positions);
    this.positions = positions;
    const colors = new Uint8Array(this.colors.length * 2);
    colors.set(this.colors);
    this.colors = colors;
    const indices = new Uint32Array(this.indices.length * 2);
    indices.set(this.indices);
    this.indices = indices;
  }

  /** Exact-size copies, so the transferred buffers carry no slack. */
  finish() {
    return {
      positions: this.positions.slice(0, this.quads * 12),
      colors: this.colors.slice(0, this.quads * 12),
      indices: this.indices.slice(0, this.quads * 6),
    };
  }
}

/** Kind of the block at chunk-local x, z (which may be -1 or 16) and absolute y. */
function makeSampler(chunk: ChunkData, neighbor: NeighborLookup) {
  const cache: (ChunkData | undefined | null)[] = new Array(9).fill(null);
  const chunkAt = (dx: number, dz: number): ChunkData | undefined => {
    if (dx === 0 && dz === 0) return chunk;
    const i = (dx + 1) * 3 + (dz + 1);
    let c = cache[i];
    if (c === null) {
      c = neighbor(dx as -1 | 0 | 1, dz as -1 | 0 | 1);
      cache[i] = c;
    }
    return c;
  };
  return (x: number, y: number, z: number): number => {
    const dx = x < 0 ? -1 : x > 15 ? 1 : 0;
    const dz = z < 0 ? -1 : z > 15 ? 1 : 0;
    const c = chunkAt(dx, dz);
    if (!c) return AIR;
    if (y < c.yMin) return SOLID; // below the band: ground that was cut away
    if (y > c.yMax) return AIR;
    const lx = x - dx * 16;
    const lz = z - dz * 16;
    const idx = c.blocks[(lx * 16 + lz) * c.height + (y - c.yMin)];
    if (idx === 0) return AIR;
    return c.palette[idx * 4 + 3] & FLAG_WATER ? WATER : SOLID;
  };
}

export function meshChunk(chunk: ChunkData, neighbor: NeighborLookup): MeshData {
  const sample = makeSampler(chunk, neighbor);
  const opaque = new Builder();
  const water = new Builder();
  const { yMin, height, blocks, palette } = chunk;
  const color: [number, number, number] = [0, 0, 0];
  const ao = [3, 3, 3, 3];
  const corners: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      const base = (x * 16 + z) * height;
      for (let i = 0; i < height; i++) {
        const idx = blocks[base + i];
        if (idx === 0) continue;
        const y = yMin + i;
        const isWater = (palette[idx * 4 + 3] & FLAG_WATER) !== 0;
        color[0] = palette[idx * 4];
        color[1] = palette[idx * 4 + 1];
        color[2] = palette[idx * 4 + 2];
        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nx = x + face.n[0];
          const ny = y + face.n[1];
          const nz = z + face.n[2];
          const other = sample(nx, ny, nz);
          if (isWater ? other !== AIR : other === SOLID) continue;

          // Corner (i, j) = block corner + N (for positive faces) + i*T1 + j*T2.
          const ox = x + (face.n[0] > 0 ? 1 : 0);
          const oy = y + (face.n[1] > 0 ? 1 : 0);
          const oz = z + (face.n[2] > 0 ? 1 : 0);
          const order = face.order;
          for (let k = 0; k < 4; k++) {
            const ij = order[k];
            const ci = ij >> 1;
            const cj = ij & 1;
            corners[k][0] = ox + ci * face.t1[0] + cj * face.t2[0];
            corners[k][1] = oy + ci * face.t1[1] + cj * face.t2[1];
            corners[k][2] = oz + ci * face.t1[2] + cj * face.t2[2];
            if (isWater) {
              ao[k] = 3;
              continue;
            }
            const s1 = ci ? 1 : -1;
            const s2 = cj ? 1 : -1;
            const side1 = sample(nx + s1 * face.t1[0], ny + s1 * face.t1[1], nz + s1 * face.t1[2]) === SOLID ? 1 : 0;
            const side2 = sample(nx + s2 * face.t2[0], ny + s2 * face.t2[1], nz + s2 * face.t2[2]) === SOLID ? 1 : 0;
            const corner =
              sample(
                nx + s1 * face.t1[0] + s2 * face.t2[0],
                ny + s1 * face.t1[1] + s2 * face.t2[1],
                nz + s1 * face.t1[2] + s2 * face.t2[2],
              ) === SOLID
                ? 1
                : 0;
            ao[k] = side1 && side2 ? 0 : 3 - (side1 + side2 + corner);
          }
          (isWater ? water : opaque).quad(corners, color, ao, face.shade);
        }
      }
    }
  }

  const o = opaque.finish();
  const w = water.finish();
  return {
    positions: o.positions,
    colors: o.colors,
    indices: o.indices,
    waterPositions: w.positions,
    waterColors: w.colors,
    waterIndices: w.indices,
  };
}
