// Builds what the live view draws blocks with, from the game art scripts/mc-assets.mjs fetched: a
// strip of every block face texture (16×16 tiles, one under the other, uploaded as a texture array)
// and, per block, which tile goes on each face and whether the biome tints it. Blocks that are not
// full cubes (stairs, fences, flowers) take their particle texture on every face for now: the
// viewer draws every block as a cube.
//
//   pnpm mc:atlas          rebuild from data/mc-assets/java (MC_ASSETS_DIR honoured)
//
// Output, next to the art: derived/blocks.png and derived/blocks.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openModels } from "./mc-models.mjs";
import { encodePng, png } from "./png.mjs";

const TILE = 16;
const FACES = ["up", "down", "north", "south", "east", "west"];
/**
 * The orientations the agent reports (lib/liveview/format.ts ORIENTATIONS): the blockstate
 * property and value each one matches.
 */
const ORIENTATIONS = {
  x: ["axis", "x"],
  y: ["axis", "y"],
  z: ["axis", "z"],
  down: ["facing", "down"],
  up: ["facing", "up"],
  north: ["facing", "north"],
  south: ["facing", "south"],
  west: ["facing", "west"],
  east: ["facing", "east"],
};

// ---- The game's face conventions, to turn a model with its blockstate's x/y rotation.
// Each face: its outward normal, and the directions the texture's u (right) and v-up run along, the
// game's default UVs (the viewer's mesher draws faces the same way).
const DIR = {
  north: { n: [0, 0, -1], r: [-1, 0, 0], u: [0, 1, 0] },
  south: { n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] },
  west: { n: [-1, 0, 0], r: [0, 0, 1], u: [0, 1, 0] },
  east: { n: [1, 0, 0], r: [0, 0, -1], u: [0, 1, 0] },
  up: { n: [0, 1, 0], r: [1, 0, 0], u: [0, 0, -1] },
  down: { n: [0, -1, 0], r: [1, 0, 0], u: [0, 0, 1] },
};
const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const neg = (v) => [-v[0], -v[1], -v[2]];
/** A blockstate rotation (degrees about x, then y) as the game applies it: clockwise seen from the axis's positive end. */
function rotator(xDeg, yDeg) {
  const rx = (-xDeg * Math.PI) / 180;
  const ry = (-yDeg * Math.PI) / 180;
  return ([x, y, z]) => {
    const y1 = Math.round(y * Math.cos(rx) - z * Math.sin(rx));
    const z1 = Math.round(y * Math.sin(rx) + z * Math.cos(rx));
    const x2 = Math.round(x * Math.cos(ry) + z1 * Math.sin(ry));
    const z2 = Math.round(-x * Math.sin(ry) + z1 * Math.cos(ry));
    return [x2, y1, z2];
  };
}
/**
 * Where each face of a model lands once turned, and how many quarter turns clockwise its texture
 * shows: for every model face, the world face with its rotated normal, and the turn that carries
 * that face's default u onto the rotated one. `uvlock` keeps textures unturned, as the game does.
 */
function turnFaces(xDeg, yDeg, uvlock) {
  const R = rotator(xDeg, yDeg);
  const out = {};
  for (const [name, d] of Object.entries(DIR)) {
    const n = R(d.n);
    const target = Object.entries(DIR).find(([, t]) => same(t.n, n))[0];
    let q = 0;
    if (!uvlock) {
      const r = R(d.r);
      const t = DIR[target];
      // Clockwise quarter turns: 1 sends the texture's right onto the face's down, 2 flips it, 3 onto up.
      q = same(r, t.r) ? 0 : same(r, neg(t.u)) ? 1 : same(r, neg(t.r)) ? 2 : 3;
    }
    out[name] = { face: target, turn: q };
  }
  return out;
}
/**
 * The grass block's sides are dirt with a tinted grass fringe drawn over them; one tile cannot be
 * both tinted and not, so the fringe is baked in with the plains colour.
 */
const OVERLAY_TINT = [0x91, 0xbd, 0x59];
/**
 * Leaves get a second, solid tile for the game's fast graphics: the holes in their textures are
 * filled with the foliage's own colour, darkened this much so a canopy keeps some depth. The
 * viewer picks the cut-out or the solid tile by its graphics setting.
 */
const LEAF_FILL = 0.7;
const isLeaves = (name) => name.endsWith("_leaves");

export function buildAtlas(dir) {
  const root = join(dir, "java");
  const out = join(dir, "derived");
  if (!existsSync(join(root, "blockstates"))) throw new Error(`no Java art under ${root}; run mc-assets first`);
  const { model, resolveTexture, firstModel, blockstates, texturePath } = openModels(root);
  const version = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).java;

  // ---- tiles: one 16×16 RGBA per distinct texture (or composite), in first-use order; 0 is white.
  const tiles = [];
  const tileIndex = new Map();
  const white = new Uint8Array(TILE * TILE * 4).fill(255);
  tiles.push(white);
  tileIndex.set("", 0);
  const decoded = new Map();
  /** A texture as one 16×16 tile: the first frame of a strip, a larger texture sampled down. */
  const tile = (id) => {
    if (decoded.has(id)) return decoded.get(id);
    const file = texturePath(id);
    let t = null;
    if (existsSync(file)) {
      const img = png(file);
      const scale = Math.max(1, Math.floor(img.w / TILE));
      t = new Uint8Array(TILE * TILE * 4);
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          // Box-filter the larger textures; a strip's first frame is its first 16 rows.
          let r = 0;
          let g = 0;
          let b = 0;
          let a = 0;
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              const o = ((y * scale + dy) * img.w + x * scale + dx) * 4;
              const al = img.data[o + 3];
              r += img.data[o] * al;
              g += img.data[o + 1] * al;
              b += img.data[o + 2] * al;
              a += al;
            }
          }
          const p = (y * TILE + x) * 4;
          const n = scale * scale;
          t[p] = a ? Math.round(r / a) : 0;
          t[p + 1] = a ? Math.round(g / a) : 0;
          t[p + 2] = a ? Math.round(b / a) : 0;
          t[p + 3] = Math.round(a / n);
        }
      }
    }
    decoded.set(id, t);
    return t;
  };
  const register = (key, pixels) => {
    const known = tileIndex.get(key);
    if (known !== undefined) return known;
    tiles.push(pixels);
    tileIndex.set(key, tiles.length - 1);
    return tiles.length - 1;
  };
  /** A cut-out made solid: every see-through texel takes the mean of the rest, darkened. */
  const solid = (pixels) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < TILE * TILE; i++) {
      if (pixels[i * 4 + 3] < 128) continue;
      r += pixels[i * 4];
      g += pixels[i * 4 + 1];
      b += pixels[i * 4 + 2];
      n++;
    }
    const fill = n ? [r, g, b].map((v) => Math.round((v / n) * LEAF_FILL)) : [0, 0, 0];
    const o = new Uint8Array(pixels);
    for (let i = 0; i < TILE * TILE; i++) {
      if (o[i * 4 + 3] >= 128) {
        o[i * 4 + 3] = 255;
        continue;
      }
      o.set([fill[0], fill[1], fill[2], 255], i * 4);
    }
    return o;
  };
  /** A tinted overlay composited over a base, the tint baked in. */
  /** The tile flipped left to right, for a model face whose u runs backwards. */
  const mirror = (pixels) => {
    const o = new Uint8Array(pixels.length);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++)
        o.set(pixels.subarray((y * TILE + x) * 4, (y * TILE + x) * 4 + 4), (y * TILE + TILE - 1 - x) * 4);
    }
    return o;
  };
  const composite = (base, overlay) => {
    const o = new Uint8Array(base);
    for (let i = 0; i < TILE * TILE; i++) {
      const a = overlay[i * 4 + 3] / 255;
      if (a === 0) continue;
      for (let c = 0; c < 3; c++) {
        const top = (overlay[i * 4 + c] * OVERLAY_TINT[c]) / 255;
        o[i * 4 + c] = Math.round(top * a + base[i * 4 + c] * (1 - a));
      }
      o[i * 4 + 3] = Math.max(o[i * 4 + 3], overlay[i * 4 + 3]);
    }
    return o;
  };

  // ---- blocks: the faces of the full-cube element, the particle texture otherwise.
  const isFullCube = (el) =>
    el.from?.every((v) => v === 0) && el.to?.every((v) => v === 16) && Object.keys(el.faces ?? {}).length > 0;
  /**
   * The six faces of a model as drawn with a blockstate variant's rotation: per world face the
   * texture ids (base, tinted overlay), whether the biome tints it, and the texture's quarter turns.
   */
  const facesOf = (m, variant) => {
    const turned = turnFaces(variant?.x ?? 0, variant?.y ?? 0, variant?.uvlock === true);
    const faces = {};
    for (const el of m.elements) {
      if (!isFullCube(el)) continue;
      for (const [dir, face] of Object.entries(el.faces)) {
        const tex = resolveTexture(m.textures, face.texture);
        if (!tex || !turned[dir]) continue;
        const { face: world, turn } = turned[dir];
        faces[world] ??= { base: null, tinted: false, overlay: null, turn: 0, mirror: false };
        const f = faces[world];
        if (!f.base) {
          f.base = tex;
          f.tinted = face.tintindex !== undefined;
          // The mirrored cube models (stone, bedrock, deepslate) flip u: the tile is stored flipped.
          f.mirror = face.uv !== undefined && face.uv[0] > face.uv[2];
          // A face's own rotation (the game turns its texture clockwise by it) adds to the model's.
          f.turn = (turn + Math.round((face.rotation ?? 0) / 90)) % 4;
        } else if (face.tintindex !== undefined) {
          f.overlay = tex;
        }
      }
    }
    return faces;
  };
  /** The tiles of a face set, in FACES order: layer indices, tint flags, turns, and the solid leaf tiles. */
  const layersOf = (name, faces, particle) => {
    const layers = [];
    const solidLayers = [];
    const tints = [];
    const turns = [];
    let any = false;
    for (const dir of FACES) {
      const f = faces[dir];
      let index = 0;
      let tinted = false;
      if (f?.base) {
        const base = tile(f.base);
        const overlay = f.overlay ? tile(f.overlay) : null;
        if (base) {
          const key = overlay ? `${f.base}+${f.overlay}` : f.base;
          const pixels = overlay ? composite(base, overlay) : base;
          index = f.mirror ? register(`${key}+mirror`, mirror(pixels)) : register(key, pixels);
          if (isLeaves(name)) solidLayers.push(register(`${f.base}+solid`, solid(base)));
          tinted = f.tinted;
        }
      } else if (particle) {
        const p = tile(particle);
        if (p) index = register(particle, p);
      }
      if (index) any = true;
      layers.push(index);
      tints.push(tinted ? 1 : 0);
      turns.push(f?.base ? f.turn : 0);
    }
    return any ? { layers, tints, turns, solidLayers } : null;
  };
  /** A blockstate's models for one orientation, by its key ("axis=x", "facing=east,lit=false"): the first key that matches. */
  const variantsFor = (state, prop, value) => {
    if (!state.variants) return null;
    const key = Object.keys(state.variants).find((k) => k.split(",").includes(`${prop}=${value}`));
    if (key === undefined) return null;
    const v = state.variants[key];
    return Array.isArray(v) ? v : [v];
  };
  const variantFor = (state, prop, value) => variantsFor(state, prop, value)?.[0] ?? null;
  /** A variant's faces as the table stores them, or null when the model has no textured cube. */
  const entryOf = (name, v, particle, fallback) => {
    const vm = (v?.model ? model(v.model) : null) ?? fallback;
    const set = vm ? layersOf(name, facesOf(vm, v), particle) : null;
    if (!set) return null;
    return set.turns.some(Boolean) ? { faces: set.layers, rot: set.turns } : { faces: set.layers };
  };
  const blocks = {};
  let textured = 0;
  let turnedBlocks = 0;
  let randomBlocks = 0;
  for (const [name, state] of blockstates()) {
    const mid = firstModel(state);
    const m = mid ? model(mid) : null;
    if (!m) continue;
    const particle = resolveTexture(m.textures, "#particle");
    // The default look: the y axis or facing north where the block turns, else its first variant.
    // A blockstate may list several models for it, and then the viewer picks one per position.
    const restList =
      variantsFor(state, "axis", "y") ??
      variantsFor(state, "facing", "north") ??
      (state.variants ? Object.values(state.variants)[0] : null);
    const rest = Array.isArray(restList) ? restList[0] : restList;
    const restModel = rest?.model ? (model(rest.model) ?? m) : m;
    const base = layersOf(name, facesOf(restModel, rest), particle);
    if (!base) continue;
    const entry = {
      faces: base.layers,
      tint: base.tints.some(Boolean) ? base.tints : undefined,
      solid: base.solidLayers.length === 6 ? base.solidLayers : undefined,
    };
    // Every orientation the blockstate has a variant for: its faces, turned as the game turns the model.
    const variants = {};
    for (const [orientation, [prop, value]] of Object.entries(ORIENTATIONS)) {
      const v = variantFor(state, prop, value);
      if (!v?.model) continue;
      const set = entryOf(name, v, particle, null);
      if (set) variants[orientation] = set;
    }
    if (Object.keys(variants).length) {
      entry.variants = variants;
      turnedBlocks++;
    }
    // The random models keep the game's order and weights, so the viewer's draw matches its own.
    if (Array.isArray(restList) && restList.length > 1) {
      const random = restList.flatMap((v) => {
        const e = entryOf(name, v, particle, m);
        return e ? Array.from({ length: v.weight ?? 1 }, () => e) : [];
      });
      if (random.length === restList.reduce((n, v) => n + (v.weight ?? 1), 0)) {
        entry.random = random;
        randomBlocks++;
      }
    }
    blocks[name] = entry;
    textured++;
  }

  // ---- write: the strip and the table.
  mkdirSync(out, { recursive: true });
  const strip = new Uint8Array(TILE * TILE * 4 * tiles.length);
  tiles.forEach((t, i) => {
    strip.set(t, i * TILE * TILE * 4);
  });
  writeFileSync(join(out, "blocks.png"), encodePng(TILE, TILE * tiles.length, strip));
  writeFileSync(join(out, "blocks.json"), `${JSON.stringify({ version, tile: TILE, tiles: tiles.length, blocks })}\n`);
  return { tiles: tiles.length, blocks: textured, turned: turnedBlocks, random: randomBlocks };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const beaconRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const dir = resolve(process.env.MC_ASSETS_DIR || join(beaconRoot, "data", "mc-assets"));
  const r = buildAtlas(dir);
  process.stdout.write(
    `mc-atlas: ${r.tiles} tiles for ${r.blocks} blocks (${r.turned} that turn, ${r.random} with random looks) in ${join(dir, "derived")}\n`,
  );
}
