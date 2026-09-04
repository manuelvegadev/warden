// Turns a decoded chunk into geometry: one quad per exposed face, colour from the block's texture
// average (tinted by the column's biome), translucency as vertex alpha, shade by face direction and
// per-vertex ambient occlusion baked into the vertex colour. Runs in the worker.
import { type ChunkData, FLAG_FOLIAGE, FLAG_GRASS, FLAG_WATER, FLAG_WATERLOGGED, ORIENTATIONS } from "./format";
import { variantAt } from "./java-random";

/** One pass of a chunk's geometry. */
export interface MeshPart {
  positions: Float32Array;
  /** 4 bytes per vertex (RGBA), normalized. */
  colors: Uint8Array;
  /** The map's relief per vertex (a vanilla map's three shades), normalized; 255 on faces that are not tops. */
  mapShade: Uint8Array;
  /** Texture coordinates within the face's tile, 2 bytes per vertex (0 or 255), normalized. */
  tileUv: Uint8Array;
  /** The face's tile in the block texture array, per vertex; 0 is the white tile of untextured blocks. */
  tileLayer: Uint16Array;
  /** The server's light at each vertex, 2 bytes (sky, block) scaled to 0–255, normalized. */
  light: Uint8Array;
  indices: Uint32Array;
}

export interface MeshData {
  opaque: MeshPart;
  /** The translucent pass: water, ice, glass, leaves. */
  trans: MeshPart;
}

export type TintKind = "grass" | "foliage" | "water";

/**
 * The block texture table (scripts/mc-atlas.mjs): per block, the tile of each face in the order
 * up, down, north, south, east, west, and which of those faces the biome tints (all, when the
 * block is tinted and the list is missing). Leaves also carry `solid` tiles, their holes filled,
 * for the fast graphics. Blocks that turn (logs, furnaces) carry a variant per orientation
 * (`ORIENTATIONS` names): its faces, and how many quarter turns clockwise each face's texture is
 * rotated, as the game rotates the model.
 */
export interface FaceVariant {
  faces: number[];
  rot?: number[];
}
export type FaceTable = Record<
  string,
  FaceVariant & {
    tint?: number[];
    solid?: number[];
    variants?: Record<string, FaceVariant>;
    /**
     * The blockstate's random models for the default look, weights expanded, in the game's order:
     * the position picks one, so a plain of grass or stone does not repeat one tile.
     */
    random?: FaceVariant[];
  }
>;

/**
 * How leaves are drawn, the game's two graphics settings: `fast` fills their holes and hides the
 * faces between two leaf blocks (a solid canopy); `fancy` keeps the holes, through which the
 * leaves behind show.
 */
export type LeavesMode = "fast" | "fancy";

/** lib/liveview/blocks.json: texture averages per block and the biome tints (scripts/block-colors.mjs); the textures once fetched. */
export interface BlockTables {
  blocks: Record<string, { rgb: number[]; alpha?: number; tint?: TintKind }>;
  biomes: Record<string, Record<TintKind, number[]> & { sky?: number[] }>;
  faces?: FaceTable;
  leaves?: LeavesMode;
}

/** The face table's order for each of `FACES`. */
const FACE_SLOT = [4, 5, 0, 1, 3, 2];

/** The chunk at (dx, dz) relative to the one being meshed; undefined = not loaded (treated as air). */
export type NeighborLookup = (dx: -1 | 0 | 1, dz: -1 | 0 | 1) => ChunkData | undefined;

// Culling groups. Every translucent block is one group: the surface between water and the ice on
// top of it is not drawn. It would be a second translucent layer under the first, and two stacked
// layers cannot be blended in the right order across chunk borders from every camera angle (the
// mesh under one chunk's ice would paint over the neighbouring chunk's ice along their border).
// Cut-outs (fancy leaves) are opaque with holes: they hide nothing but other blocks hide them, and
// two leaf blocks keep the faces between them, seen through the holes.
const AIR = 0;
const OPAQUE = 1;
const TRANSLUCENT = 2;
const CUTOUT = 3;

// A vanilla map's relief: a column brighter than the one north of it, level with it, or lower.
const RELIEF_HIGHER = 255;
const RELIEF_LEVEL = 220;
const RELIEF_LOWER = 180;

// Face table: normal, the two tangents, and the corner order. `order` lists (i, j) packed as i*2+j:
// positive faces go 00, 10, 11, 01 (counter-clockwise seen from outside, since cross(T1, T2) = +N);
// negative faces take the reverse. `uv` maps a corner (i, j) to the tile: u = uv[0] + uv[1]·i + uv[2]·j
// and v likewise, so a side's texture stands upright with its left edge on the viewer's left, a
// top's has north at the top and a bottom's south, the game's default face UVs.
const CCW = [0, 2, 3, 1] as const;
const CW = [0, 1, 3, 2] as const;
const FACES = [
  { n: [1, 0, 0], t1: [0, 1, 0], t2: [0, 0, 1], order: CCW, shade: 0.6, uv: [1, 0, -1, 1, -1, 0] }, // +x east
  { n: [-1, 0, 0], t1: [0, 1, 0], t2: [0, 0, 1], order: CW, shade: 0.6, uv: [0, 0, 1, 1, -1, 0] }, // -x west
  { n: [0, 1, 0], t1: [0, 0, 1], t2: [1, 0, 0], order: CCW, shade: 1.0, uv: [0, 0, 1, 0, 1, 0] }, // +y top
  { n: [0, -1, 0], t1: [0, 0, 1], t2: [1, 0, 0], order: CW, shade: 0.5, uv: [0, 0, 1, 1, -1, 0] }, // -y bottom (south edge up, as the game)
  { n: [0, 0, 1], t1: [1, 0, 0], t2: [0, 1, 0], order: CCW, shade: 0.8, uv: [0, 1, 0, 1, 0, -1] }, // +z south
  { n: [0, 0, -1], t1: [1, 0, 0], t2: [0, 1, 0], order: CW, shade: 0.8, uv: [1, -1, 0, 1, 0, -1] }, // -z north
] as const;

/**
 * Ambient occlusion per vertex, by how many of the three blocks around the corner (two sides and
 * the diagonal) are solid: both sides (which hide the diagonal), two, one, none. The game's own
 * curve: the mean of the four cells' shade, 1 for an open cell and 0.2 for a solid block.
 */
const AO_FACTOR = [0.4, 0.6, 0.8, 1.0];
const WHITE = [255, 255, 255];
/** Blocks that darken the corners next to them: solid ones, and leaves (the game shades under a canopy). */
const occludes = (group: number) => group === OPAQUE || group === CUTOUT;

/** A buffer of the same kind, twice as long, holding what the old one held. */
function grown<T extends { length: number; set(a: T): void }>(a: T): T {
  const bigger = new (a.constructor as new (n: number) => T)(a.length * 2);
  bigger.set(a);
  return bigger;
}

/** `n` quads of `per` entries each, cut to size and moved to where `to` sends each quad. */
function reorder<T extends { length: number; [i: number]: number }>(
  src: T,
  n: number,
  per: number,
  to: Uint32Array,
): T {
  const out = new (src.constructor as new (n: number) => T)(n * per);
  for (let q = 0; q < n; q++) {
    const from = q * per;
    const at = to[q] * per;
    for (let k = 0; k < per; k++) out[at + k] = src[from + k];
  }
  return out;
}

/**
 * Quad buffers that grow geometrically and are reused across chunks (the worker meshes one chunk
 * at a time): no per-chunk allocation beyond the exact-size copies handed out by finish().
 */
class Builder {
  private positions = new Float32Array(12 * 2048);
  private colors = new Uint8Array(16 * 2048);
  private mapShade = new Uint8Array(4 * 2048);
  private tileUv = new Uint8Array(8 * 2048);
  private tileLayer = new Uint16Array(4 * 2048);
  private light = new Uint8Array(8 * 2048);
  private indices = new Uint32Array(6 * 2048);
  private quads = 0;

  reset() {
    this.quads = 0;
  }

  /**
   * @param uvs per corner, the texture coordinates within the tile (0 or 1)
   * @param layer the face's tile in the texture array
   * @param lights per corner, the sky and block light 0–255
   */
  quad(
    corners: number[][],
    uvs: number[][],
    layer: number,
    lights: number[][],
    color: number[],
    alpha: number,
    ao: number[],
    shade: number,
    relief: number,
  ) {
    if ((this.quads + 1) * 12 > this.positions.length) this.grow();
    const q = this.quads;
    const base = q * 4;
    this.mapShade.fill(relief, q * 4, q * 4 + 4);
    this.tileLayer.fill(layer, q * 4, q * 4 + 4);
    for (let i = 0; i < 4; i++) {
      const p = (q * 4 + i) * 3;
      this.positions[p] = corners[i][0];
      this.positions[p + 1] = corners[i][1];
      this.positions[p + 2] = corners[i][2];
      this.tileUv[(q * 4 + i) * 2] = uvs[i][0] * 255;
      this.tileUv[(q * 4 + i) * 2 + 1] = uvs[i][1] * 255;
      this.light[(q * 4 + i) * 2] = lights[i][0];
      this.light[(q * 4 + i) * 2 + 1] = lights[i][1];
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
    this.positions = grown(this.positions);
    this.colors = grown(this.colors);
    this.mapShade = grown(this.mapShade);
    this.tileUv = grown(this.tileUv);
    this.tileLayer = grown(this.tileLayer);
    this.light = grown(this.light);
    this.indices = grown(this.indices);
  }

  finish(): MeshPart {
    return {
      positions: this.positions.slice(0, this.quads * 12),
      colors: this.colors.slice(0, this.quads * 16),
      mapShade: this.mapShade.slice(0, this.quads * 4),
      tileUv: this.tileUv.slice(0, this.quads * 8),
      tileLayer: this.tileLayer.slice(0, this.quads * 4),
      light: this.light.slice(0, this.quads * 8),
      indices: this.indices.slice(0, this.quads * 6),
    };
  }

  /**
   * The same, with the quads ordered bottom-up. Translucent faces blend in draw order (no depth
   * write), and the camera is always above the ground, so lower faces must come first. Quad heights
   * are integers (or halves, for side faces) in a small range, so this is a counting sort.
   */
  finishSortedByY(yMin: number, height: number): MeshPart {
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
    // Where each quad lands, so every buffer is reordered the same way.
    const to = new Uint32Array(n);
    for (let q = 0; q < n; q++) to[q] = counts[key[q]]++;
    const indices = new Uint32Array(n * 6);
    for (let q = 0; q < n; q++) {
      const i = to[q];
      for (let k = 0; k < 6; k++) indices[i * 6 + k] = this.indices[q * 6 + k] - q * 4 + i * 4;
    }
    return {
      positions: reorder(this.positions, n, 12, to),
      colors: reorder(this.colors, n, 16, to),
      mapShade: reorder(this.mapShade, n, 4, to),
      tileUv: reorder(this.tileUv, n, 8, to),
      tileLayer: reorder(this.tileLayer, n, 4, to),
      light: reorder(this.light, n, 8, to),
      indices,
    };
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
  /** Per palette index, the tile of each of `FACES`; 0 (white) when the block has no texture. */
  layers: Uint16Array;
  /** Per palette index, a bit per `FACES` entry: the biome tints that face's texture. */
  tinted: Uint8Array;
  /** Per palette index, the quarter turns clockwise of each of `FACES`' textures. */
  rot: Uint8Array;
  /** Per palette index, the block's random variants when it has them: the position picks one. */
  random: (RandomFaces | undefined)[];
  /** Per palette index: the cell holds water, so a surface of it is drawn a little lower. */
  water: Uint8Array;
}

/** A block's random variants, `count` of them, each with the tile and turn of every `FACES` entry. */
interface RandomFaces {
  count: number;
  layers: Uint16Array;
  rot: Uint8Array;
}

/**
 * A block's random variants, flattened once per face table rather than once per chunk: the list
 * comes from the table, so it is the same object for every chunk that holds the block.
 */
const randomCache = new WeakMap<FaceVariant[], RandomFaces>();
function randomFacesOf(variants: FaceVariant[]): RandomFaces {
  let r = randomCache.get(variants);
  if (r) return r;
  const count = variants.length;
  r = { count, layers: new Uint16Array(count * 6), rot: new Uint8Array(count * 6) };
  for (let k = 0; k < count; k++) fillFaces(r.layers, r.rot, k * 6, variants[k]);
  randomCache.set(variants, r);
  return r;
}

/** The tiles and turns of a variant in `FACES` order. */
function fillFaces(layers: Uint16Array, rot: Uint8Array, at: number, variant: FaceVariant) {
  for (let f = 0; f < 6; f++) {
    layers[at + f] = variant.faces[FACE_SLOT[f]];
    rot[at + f] = variant.rot?.[FACE_SLOT[f]] ?? 0;
  }
}

let resolvedCache = new WeakMap<ChunkData, Resolved>();

/** The tables changed (the textures arrived): every chunk is resolved afresh. */
export function forgetResolved() {
  resolvedCache = new WeakMap();
}

function resolve(chunk: ChunkData, tables: BlockTables): Resolved {
  let r = resolvedCache.get(chunk);
  if (r) return r;
  const n = chunk.entries.length;
  const groups = new Uint8Array(n);
  const alpha = new Uint8Array(n);
  const rgb: number[][] = [];
  const tint: (TintKind | null)[] = [];
  const layers = new Uint16Array(n * 6);
  const tinted = new Uint8Array(n);
  const rot = new Uint8Array(n * 6);
  const random: (RandomFaces | undefined)[] = new Array(n);
  const water = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const { name, flags, orient } = chunk.entries[i];
    // A block that shares its cell with water is drawn as that water until the viewer can draw the
    // block itself: seagrass, kelp, a waterlogged coral fan. The palette keeps its real key.
    const holdsWater = (flags & FLAG_WATERLOGGED) !== 0;
    const drawn = holdsWater ? "water" : name;
    const known = tables.blocks[drawn];
    const textured = tables.faces?.[drawn];
    rgb.push(known ? known.rgb : chunk.entries[i].rgb);
    // Textured leaves are opaque either way: solid tiles in fast graphics, cut-outs in fancy.
    const leaves = textured?.solid;
    const fancy = leaves !== undefined && tables.leaves === "fancy";
    if (textured) {
      // A turned block takes its orientation's faces (and their texture turns); the rest, the default.
      const variant = orient ? textured.variants?.[ORIENTATIONS[orient]] : undefined;
      const solidLeaves = leaves && !fancy;
      fillFaces(layers, rot, i * 6, solidLeaves ? { faces: leaves } : (variant ?? textured));
      for (let f = 0; f < 6; f++) if (!textured.tint || textured.tint[FACE_SLOT[f]]) tinted[i] |= 1 << f;
      // In its default look a block with random models varies by position; a turned one keeps its orientation's.
      if (textured.random && !variant && !solidLeaves) random[i] = randomFacesOf(textured.random);
    }
    water[i] = i > 0 && flags & (FLAG_WATER | FLAG_WATERLOGGED) ? 1 : 0;
    // Unknown blocks fall back to opaque; a cell holding water takes the table's water instead.
    const a = leaves ? 1 : (known?.alpha ?? (water[i] ? (tables.blocks.water?.alpha ?? 1) : 1));
    alpha[i] = Math.round(a * 255);
    tint.push(
      known?.tint ?? (water[i] ? "water" : flags & FLAG_FOLIAGE ? "foliage" : flags & FLAG_GRASS ? "grass" : null),
    );
    groups[i] = i === 0 ? AIR : fancy ? CUTOUT : a >= 1 ? OPAQUE : TRANSLUCENT;
  }
  r = { groups, rgb, alpha, tint, layers, tinted, rot, random, water };
  resolvedCache.set(chunk, r);
  return r;
}

/** How far below its block's top the game draws a water surface: a source fluid is 8/9 of a block tall. */
const WATER_DROP = 1 / 9;

/** Full daylight and no block light: what cells outside the data are taken to have. */
const DAYLIGHT = 0xf0;

/**
 * One lookup by chunk-local x, z (which may be -1 or 16) and absolute y, resolving the cell once
 * for both facts the mesher needs there: the culling group of the block in the low byte, and the
 * server's light byte (daylight where the chunk carries none) in the high one. Both are read for
 * the same cell all around a face, so they share the neighbour lookup and the index arithmetic.
 */
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
    if (!e) return AIR | (DAYLIGHT << 8);
    // Outside the band: below is the ground that was cut away, above is open sky.
    if (y < e.c.yMin) return OPAQUE;
    if (y > e.c.yMax) return AIR | (DAYLIGHT << 8);
    const i = ((x - dx * 16) * 16 + (z - dz * 16)) * e.c.height + (y - e.c.yMin);
    return e.g[e.c.blocks[i]] | ((e.c.light ? e.c.light[i] : DAYLIGHT) << 8);
  };
}

/** The two halves of a sampled cell. */
const groupOf = (cell: number) => cell & 0xff;
const lightOf = (cell: number) => cell >> 8;

export function meshChunk(chunk: ChunkData, neighbor: NeighborLookup, tables: BlockTables): MeshData {
  const own = resolve(chunk, tables);
  const cellAt = makeSampler(chunk, own, neighbor, tables);
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
  const uvs: number[][] = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  const lights: number[][] = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ];
  /**
   * Sums one of the three cells around a corner into its light average; a solid block, or a cell
   * with no light at all, counts as the face's own cell instead, as the game blends it.
   */
  let skySum = 0;
  let blockSum = 0;
  const gather = (cell: number, faceLight: number) => {
    const l = occludes(groupOf(cell)) ? 0 : lightOf(cell);
    const use = l === 0 ? faceLight : l;
    skySum += use >> 4;
    blockSum += use & 15;
  };

  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      const base = (x * 16 + z) * height;
      const biome = tints[chunk.biomes[z * 16 + x]];
      for (let i = 0; i < height; i++) {
        const idx = blocks[base + i];
        if (idx === 0) continue;
        const y = yMin + i;
        const group = own.groups[idx];
        const translucent = group === TRANSLUCENT;
        const tintKind = own.tint[idx];
        const tintColor = tintKind && biome ? biome[tintKind] : WHITE;
        // The random variant this position draws, found on the block's first visible face.
        const randomFaces = own.random[idx];
        let pick = -1;
        // A water surface sits a little below the block's top, as the game draws a source fluid;
        // water with water over it is full height, so the column below the surface has no step.
        const drop = own.water[idx] && !own.water[i + 1 < height ? blocks[base + i + 1] : 0] ? WATER_DROP : 0;
        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nx = x + face.n[0];
          const ny = y + face.n[1];
          const nz = z + face.n[2];
          const other = cellAt(nx, ny, nz);
          const otherGroup = groupOf(other);
          // An opaque or cut-out face shows unless it meets an opaque block (the grass under water
          // shows through, leaves show behind leaves); a translucent face shows only against air.
          if (translucent ? otherGroup !== AIR : otherGroup === OPAQUE) continue;
          // The face is lit by the cell it looks into: the server's sky and block light there.
          const faceLight = lightOf(other);
          // A textured face is white (the tile supplies the colour) or the tint alone; without a
          // texture the block's flat colour, tinted, as before.
          if (randomFaces && pick < 0) pick = variantAt(chunk.cx * 16 + x, y, chunk.cz * 16 + z, randomFaces.count);
          const slot = randomFaces ? pick * 6 + f : idx * 6 + f;
          const layer = randomFaces ? randomFaces.layers[slot] : own.layers[slot];
          const t = layer ? ((own.tinted[idx] >> f) & 1 ? tintColor : WHITE) : tintColor;
          const rgb = layer ? WHITE : own.rgb[idx];
          color[0] = (rgb[0] * t[0]) / 255;
          color[1] = (rgb[1] * t[1]) / 255;
          color[2] = (rgb[2] * t[2]) / 255;

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
            if (drop && corners[k][1] === y + 1) corners[k][1] -= drop;
            corners[k][2] = oz + ci * face.t1[2] + cj * face.t2[2];
            // The tile's corner for this one, then the texture's quarter turns clockwise on the face:
            // a corner shows what sat a turn counter-clockwise from it.
            const u0 = face.uv[0] + face.uv[1] * ci + face.uv[2] * cj;
            const v0 = face.uv[3] + face.uv[4] * ci + face.uv[5] * cj;
            const q = randomFaces ? randomFaces.rot[slot] : own.rot[slot];
            uvs[k][0] = q === 0 ? u0 : q === 1 ? v0 : q === 2 ? 1 - u0 : 1 - v0;
            uvs[k][1] = q === 0 ? v0 : q === 1 ? 1 - u0 : q === 2 ? 1 - v0 : u0;
            if (translucent) {
              ao[k] = 3;
              lights[k][0] = (faceLight >> 4) * 17;
              lights[k][1] = (faceLight & 15) * 17;
              continue;
            }
            // The three cells around the corner, on the face's side: they occlude, and, when open,
            // their light is averaged into the corner's (the game's smooth lighting).
            const s1 = ci ? 1 : -1;
            const s2 = cj ? 1 : -1;
            const x1 = nx + s1 * face.t1[0];
            const y1 = ny + s1 * face.t1[1];
            const z1 = nz + s1 * face.t1[2];
            const x2 = nx + s2 * face.t2[0];
            const y2 = ny + s2 * face.t2[1];
            const z2 = nz + s2 * face.t2[2];
            const xc = x1 + s2 * face.t2[0];
            const yc = y1 + s2 * face.t2[1];
            const zc = z1 + s2 * face.t2[2];
            const c1 = cellAt(x1, y1, z1);
            const c2 = cellAt(x2, y2, z2);
            const cc = cellAt(xc, yc, zc);
            const side1 = occludes(groupOf(c1)) ? 1 : 0;
            const side2 = occludes(groupOf(c2)) ? 1 : 0;
            const corner = occludes(groupOf(cc)) ? 1 : 0;
            ao[k] = side1 && side2 ? 0 : 3 - (side1 + side2 + corner);
            skySum = faceLight >> 4;
            blockSum = faceLight & 15;
            gather(c1, faceLight);
            gather(c2, faceLight);
            // Two solid sides hide the diagonal, so it does not light the corner either.
            gather(side1 && side2 ? OPAQUE : cc, faceLight);
            lights[k][0] = Math.round((skySum / 4) * 17);
            lights[k][1] = Math.round((blockSum / 4) * 17);
          }
          // The map's relief, on tops only: is the column to the north higher, level, or lower? A
          // canopy is looked for a couple of blocks up, so the edge of a tree reads as a rise.
          let relief = RELIEF_HIGHER;
          if (face.n[1] > 0) {
            if (groupOf(cellAt(x, y + 1, z - 1)) !== AIR || groupOf(cellAt(x, y + 2, z - 1)) !== AIR)
              relief = RELIEF_LOWER;
            else if (groupOf(cellAt(x, y, z - 1)) !== AIR) relief = RELIEF_LEVEL;
          }
          (translucent ? trans : opaque).quad(
            corners,
            uvs,
            layer,
            lights,
            color,
            own.alpha[idx],
            ao,
            face.shade,
            relief,
          );
        }
      }
    }
  }

  return { opaque: opaque.finish(), trans: trans.finishSortedByY(yMin, height) };
}
