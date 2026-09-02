// Turns a decoded chunk into geometry: one quad per exposed face, colour from the block's texture
// average (tinted by the column's biome), translucency as vertex alpha, shade by face direction and
// per-vertex ambient occlusion baked into the vertex colour. Runs in the worker.
import { type ChunkData, FLAG_FOLIAGE, FLAG_GRASS, FLAG_WATER } from "./format";

export interface MeshData {
  positions: Float32Array;
  /** 4 bytes per vertex (RGBA), normalized. */
  colors: Uint8Array;
  indices: Uint32Array;
  /** The translucent pass: water, ice, glass, leaves. */
  transPositions: Float32Array;
  transColors: Uint8Array;
  transIndices: Uint32Array;
}

export type TintKind = "grass" | "foliage" | "water";

/** lib/liveview/blocks.json: texture averages per block and the biome tints (scripts/block-colors.mjs). */
export interface BlockTables {
  blocks: Record<string, { rgb: number[]; alpha?: number; tint?: TintKind }>;
  biomes: Record<string, Record<TintKind, number[]> & { sky?: number[] }>;
}

/** The chunk at (dx, dz) relative to the one being meshed; undefined = not loaded (treated as air). */
export type NeighborLookup = (dx: -1 | 0 | 1, dz: -1 | 0 | 1) => ChunkData | undefined;

// Culling groups. Every translucent block is one group: the surface between water and the ice on
// top of it is not drawn. It would be a second translucent layer under the first, and two stacked
// layers cannot be blended in the right order across chunk borders from every camera angle (the
// mesh under one chunk's ice would paint over the neighbouring chunk's ice along their border).
const AIR = 0;
const OPAQUE = 1;
const TRANSLUCENT = 2;

// Face table: normal, the two tangents, and the corner order. `order` lists (i, j) packed as i*2+j:
// positive faces go 00, 10, 11, 01 (counter-clockwise seen from outside, since cross(T1, T2) = +N);
// negative faces take the reverse.
const CCW = [0, 2, 3, 1] as const;
const CW = [0, 1, 3, 2] as const;
const FACES = [
  { n: [1, 0, 0], t1: [0, 1, 0], t2: [0, 0, 1], order: CCW, shade: 0.6 }, // +x east
  { n: [-1, 0, 0], t1: [0, 1, 0], t2: [0, 0, 1], order: CW, shade: 0.6 }, // -x west
  { n: [0, 1, 0], t1: [0, 0, 1], t2: [1, 0, 0], order: CCW, shade: 1.0 }, // +y top
  { n: [0, -1, 0], t1: [0, 0, 1], t2: [1, 0, 0], order: CW, shade: 0.5 }, // -y bottom
  { n: [0, 0, 1], t1: [1, 0, 0], t2: [0, 1, 0], order: CCW, shade: 0.8 }, // +z south
  { n: [0, 0, -1], t1: [1, 0, 0], t2: [0, 1, 0], order: CW, shade: 0.8 }, // -z north
] as const;

const AO_FACTOR = [0.5, 0.68, 0.84, 1.0];
const WHITE = [255, 255, 255];

/**
 * Quad buffers that grow geometrically and are reused across chunks (the worker meshes one chunk
 * at a time): no per-chunk allocation beyond the exact-size copies handed out by finish().
 */
class Builder {
  private positions = new Float32Array(12 * 2048);
  private colors = new Uint8Array(16 * 2048);
  private indices = new Uint32Array(6 * 2048);
  private quads = 0;

  reset() {
    this.quads = 0;
  }

  quad(corners: number[][], color: number[], alpha: number, ao: number[], shade: number) {
    if ((this.quads + 1) * 12 > this.positions.length) this.grow();
    const q = this.quads;
    const base = q * 4;
    for (let i = 0; i < 4; i++) {
      const p = (q * 4 + i) * 3;
      this.positions[p] = corners[i][0];
      this.positions[p + 1] = corners[i][1];
      this.positions[p + 2] = corners[i][2];
      const f = shade * AO_FACTOR[ao[i]];
      const c = (q * 4 + i) * 4;
      this.colors[c] = Math.round(color[0] * f);
      this.colors[c + 1] = Math.round(color[1] * f);
      this.colors[c + 2] = Math.round(color[2] * f);
      this.colors[c + 3] = alpha;
    }
    // Flip the diagonal when the occlusion is uneven, so the darker corners interpolate cleanly.
    const ix = q * 6;
    const ind = this.indices;
    if (ao[0] + ao[2] > ao[1] + ao[3]) {
      ind[ix] = base;
      ind[ix + 1] = base + 1;
      ind[ix + 2] = base + 2;
      ind[ix + 3] = base;
      ind[ix + 4] = base + 2;
      ind[ix + 5] = base + 3;
    } else {
      ind[ix] = base + 1;
      ind[ix + 1] = base + 2;
      ind[ix + 2] = base + 3;
      ind[ix + 3] = base + 1;
      ind[ix + 4] = base + 3;
      ind[ix + 5] = base;
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

  finish() {
    return {
      positions: this.positions.slice(0, this.quads * 12),
      colors: this.colors.slice(0, this.quads * 16),
      indices: this.indices.slice(0, this.quads * 6),
    };
  }

  /**
   * The same, with the quads ordered bottom-up. Translucent faces blend in draw order (no depth
   * write), and the camera is always above the ground, so lower faces must come first. Quad heights
   * are integers (or halves, for side faces) in a small range, so this is a counting sort.
   */
  finishSortedByY(yMin: number, height: number) {
    const n = this.quads;
    const buckets = 2 * (height + 2);
    const counts = new Uint32Array(buckets + 1);
    const key = new Uint32Array(n);
    for (let q = 0; q < n; q++) {
      const y =
        this.positions[q * 12 + 1] +
        this.positions[q * 12 + 4] +
        this.positions[q * 12 + 7] +
        this.positions[q * 12 + 10];
      const k = Math.min(buckets - 1, Math.max(0, Math.round(y / 2) - 2 * yMin)); // 0.5 steps → integers
      key[q] = k;
      counts[k + 1]++;
    }
    for (let k = 0; k < buckets; k++) counts[k + 1] += counts[k];
    const positions = new Float32Array(n * 12);
    const colors = new Uint8Array(n * 16);
    const indices = new Uint32Array(n * 6);
    for (let q = 0; q < n; q++) {
      const i = counts[key[q]]++;
      for (let k = 0; k < 12; k++) positions[i * 12 + k] = this.positions[q * 12 + k];
      for (let k = 0; k < 16; k++) colors[i * 16 + k] = this.colors[q * 16 + k];
      for (let k = 0; k < 6; k++) indices[i * 6 + k] = this.indices[q * 6 + k] - q * 4 + i * 4;
    }
    return { positions, colors, indices };
  }
}

const opaqueBuilder = new Builder();
const transBuilder = new Builder();

/** What the mesher knows about each palette entry of a chunk, resolved once per chunk. */
interface Resolved {
  /** Culling group per palette index. */
  groups: Uint8Array;
  /** Base colour per palette index (texture average, or the map colour for unknown blocks). */
  rgb: number[][];
  /** 0–255 per palette index. */
  alpha: Uint8Array;
  tint: (TintKind | null)[];
}

const resolvedCache = new WeakMap<ChunkData, Resolved>();

function resolve(chunk: ChunkData, tables: BlockTables): Resolved {
  let r = resolvedCache.get(chunk);
  if (r) return r;
  const n = chunk.entries.length;
  const groups = new Uint8Array(n);
  const alpha = new Uint8Array(n);
  const rgb: number[][] = [];
  const tint: (TintKind | null)[] = [];
  for (let i = 0; i < n; i++) {
    const { name, flags } = chunk.entries[i];
    const known = tables.blocks[name];
    rgb.push(known ? known.rgb : chunk.entries[i].rgb);
    // Unknown blocks fall back to the wire flags; unknown liquids look like the table's water.
    const a = known ? (known.alpha ?? 1) : flags & FLAG_WATER ? (tables.blocks.water?.alpha ?? 1) : 1;
    alpha[i] = Math.round(a * 255);
    tint.push(
      known?.tint ??
        (flags & FLAG_WATER ? "water" : flags & FLAG_FOLIAGE ? "foliage" : flags & FLAG_GRASS ? "grass" : null),
    );
    groups[i] = i === 0 ? AIR : a >= 1 ? OPAQUE : TRANSLUCENT;
  }
  r = { groups, rgb, alpha, tint };
  resolvedCache.set(chunk, r);
  return r;
}

/** Culling group of the block at chunk-local x, z (which may be -1 or 16) and absolute y. */
function makeSampler(chunk: ChunkData, own: Resolved, neighbor: NeighborLookup, tables: BlockTables) {
  const cache: ({ c: ChunkData; g: Uint8Array } | undefined | null)[] = new Array(9).fill(null);
  cache[4] = { c: chunk, g: own.groups };
  const at = (dx: number, dz: number) => {
    const i = (dx + 1) * 3 + (dz + 1);
    let e = cache[i];
    if (e === null) {
      const c = neighbor(dx as -1 | 0 | 1, dz as -1 | 0 | 1);
      e = c ? { c, g: resolve(c, tables).groups } : undefined;
      cache[i] = e;
    }
    return e;
  };
  return (x: number, y: number, z: number): number => {
    const dx = x < 0 ? -1 : x > 15 ? 1 : 0;
    const dz = z < 0 ? -1 : z > 15 ? 1 : 0;
    const e = at(dx, dz);
    if (!e) return AIR;
    if (y < e.c.yMin) return OPAQUE; // below the band: ground that was cut away
    if (y > e.c.yMax) return AIR;
    const lx = x - dx * 16;
    const lz = z - dz * 16;
    return e.g[e.c.blocks[(lx * 16 + lz) * e.c.height + (y - e.c.yMin)]];
  };
}

export function meshChunk(chunk: ChunkData, neighbor: NeighborLookup, tables: BlockTables): MeshData {
  const own = resolve(chunk, tables);
  const sample = makeSampler(chunk, own, neighbor, tables);
  const opaque = opaqueBuilder;
  const trans = transBuilder;
  opaque.reset();
  trans.reset();
  const { yMin, height, blocks } = chunk;
  // Biome tints per column biome index, resolved once per chunk.
  const tints = chunk.biomeNames.map((b) => tables.biomes[b] ?? tables.biomes.plains ?? null);
  const color = [0, 0, 0];
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
      const biome = tints[chunk.biomes[z * 16 + x]];
      for (let i = 0; i < height; i++) {
        const idx = blocks[base + i];
        if (idx === 0) continue;
        const y = yMin + i;
        const group = own.groups[idx];
        const translucent = group !== OPAQUE;
        let coloured = false; // most blocks are buried: the tint is only worked out for a visible face
        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nx = x + face.n[0];
          const ny = y + face.n[1];
          const nz = z + face.n[2];
          const other = sample(nx, ny, nz);
          // An opaque face shows unless it meets another opaque block (the grass under water shows
          // through); a translucent face shows only against air.
          if (translucent ? other !== AIR : other === OPAQUE) continue;
          if (!coloured) {
            const tintKind = own.tint[idx];
            const t = tintKind && biome ? biome[tintKind] : WHITE;
            const rgb = own.rgb[idx];
            color[0] = (rgb[0] * t[0]) / 255;
            color[1] = (rgb[1] * t[1]) / 255;
            color[2] = (rgb[2] * t[2]) / 255;
            coloured = true;
          }

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
            if (translucent) {
              ao[k] = 3;
              continue;
            }
            const s1 = ci ? 1 : -1;
            const s2 = cj ? 1 : -1;
            const side1 = sample(nx + s1 * face.t1[0], ny + s1 * face.t1[1], nz + s1 * face.t1[2]) === OPAQUE ? 1 : 0;
            const side2 = sample(nx + s2 * face.t2[0], ny + s2 * face.t2[1], nz + s2 * face.t2[2]) === OPAQUE ? 1 : 0;
            const corner =
              sample(
                nx + s1 * face.t1[0] + s2 * face.t2[0],
                ny + s1 * face.t1[1] + s2 * face.t2[1],
                nz + s1 * face.t1[2] + s2 * face.t2[2],
              ) === OPAQUE
                ? 1
                : 0;
            ao[k] = side1 && side2 ? 0 : 3 - (side1 + side2 + corner);
          }
          (translucent ? trans : opaque).quad(corners, color, own.alpha[idx], ao, face.shade);
        }
      }
    }
  }

  const o = opaque.finish();
  const w = trans.finishSortedByY(yMin, height);
  return {
    positions: o.positions,
    colors: o.colors,
    indices: o.indices,
    transPositions: w.positions,
    transColors: w.colors,
    transIndices: w.indices,
  };
}
