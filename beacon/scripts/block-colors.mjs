// Builds lib/liveview/blocks.json for the live view: the average colour of every block's textures
// (what a flat-coloured cube should look like), its translucency, which biome tint applies to it,
// and the per-biome grass / foliage / water tints from the game's colormaps.
//
//   pnpm block-colors <path-to-client.jar>      (the Minecraft client jar; piston-meta lists it)
//
// Only the JDK-free bits of the jar are read: blockstates, block models, block textures, the two
// colormaps and the biome definitions. The PNG decoder below covers what those textures use.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const jar = process.argv[2];
if (!jar || !existsSync(jar)) {
  console.error("usage: pnpm block-colors <client.jar>");
  process.exit(2);
}
const root = join(tmpdir(), `warden-client-${process.pid}`);
mkdirSync(root, { recursive: true });
execFileSync("unzip", [
  "-o",
  "-q",
  jar,
  "assets/minecraft/blockstates/*",
  "assets/minecraft/models/block/*",
  "assets/minecraft/textures/block/*",
  "assets/minecraft/textures/colormap/*",
  "data/minecraft/worldgen/biome/*",
  "version.json",
  "-d",
  root,
]);
const A = join(root, "assets/minecraft");

// ---- PNG: enough of the format for Minecraft's block textures (8-bit RGB/RGBA/gray, palettes of any depth).
function png(path) {
  const b = readFileSync(path);
  let p = 8;
  let w = 0;
  let h = 0;
  let depth = 8;
  let type = 6;
  let palette = null;
  let trns = null;
  const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const kind = b.toString("ascii", p + 4, p + 8);
    const data = b.subarray(p + 8, p + 8 + len);
    if (kind === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      type = data[9];
      if (data[12] !== 0) throw new Error(`${path}: interlaced`);
    } else if (kind === "PLTE") palette = data;
    else if (kind === "tRNS") trns = data;
    else if (kind === "IDAT") idat.push(data);
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  const bpp = Math.max(1, (channels * depth) >> 3); // bytes per pixel for filtering
  const stride = Math.ceil((w * channels * depth) / 8);
  const out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const up = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      if (f === 1) line[i] += a;
      else if (f === 2) line[i] += up;
      else if (f === 3) line[i] += (a + up) >> 1;
      else if (f === 4) {
        const pa = Math.abs(up - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + up - 2 * c);
        line[i] += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
    }
    const sample = (i) => {
      // i-th sample of the row at `depth` bits
      if (depth === 8) return line[i];
      if (depth === 16) return line[i * 2];
      const bit = i * depth;
      return (line[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    };
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (type === 6) {
        out.set([sample(x * 4), sample(x * 4 + 1), sample(x * 4 + 2), sample(x * 4 + 3)], o);
      } else if (type === 2) {
        out.set([sample(x * 3), sample(x * 3 + 1), sample(x * 3 + 2), 255], o);
      } else if (type === 0) {
        const g = depth < 8 ? Math.round((sample(x) * 255) / ((1 << depth) - 1)) : sample(x);
        out.set([g, g, g, 255], o);
      } else if (type === 4) {
        const g = sample(x * 2);
        out.set([g, g, g, sample(x * 2 + 1)], o);
      } else if (type === 3) {
        const i = sample(x);
        out.set([palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2], trns && i < trns.length ? trns[i] : 255], o);
      }
    }
    prev = line;
  }
  return { w, h, data: out };
}

/** Alpha-weighted mean colour and mean alpha of a texture (animated strips average every frame). */
function average(texture) {
  const img = png(texture);
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  const n = img.w * img.h;
  for (let i = 0; i < n; i++) {
    const al = img.data[i * 4 + 3] / 255;
    r += img.data[i * 4] * al;
    g += img.data[i * 4 + 1] * al;
    b += img.data[i * 4 + 2] * al;
    a += al;
  }
  if (a === 0) return { rgb: [0, 0, 0], alpha: 0 };
  return { rgb: [Math.round(r / a), Math.round(g / a), Math.round(b / a)], alpha: a / n };
}

// ---- Models: resolve the parent chain, substitute texture variables, read the faces of the cube.
const modelCache = new Map();
function model(id) {
  const name = id.replace(/^minecraft:/, "");
  if (modelCache.has(name)) return modelCache.get(name);
  const file = join(A, "models", `${name}.json`);
  if (!existsSync(file)) return null;
  const m = JSON.parse(readFileSync(file, "utf8"));
  const parent = m.parent ? model(m.parent) : null;
  const textures = { ...(parent?.textures ?? {}), ...(m.textures ?? {}) };
  const elements = m.elements ?? parent?.elements ?? [];
  const out = { textures, elements };
  modelCache.set(name, out);
  return out;
}

function resolveTexture(textures, ref) {
  let v = ref;
  for (let i = 0; i < 10; i++) {
    if (v && typeof v === "object") v = v.sprite; // 26.x: { sprite, force_translucent }
    if (typeof v !== "string" || !v.startsWith("#")) break;
    v = textures[v.slice(1)];
  }
  return typeof v === "string" ? v.replace(/^minecraft:/, "") : null;
}

const texCache = new Map();
function textureAverage(id) {
  if (!texCache.has(id)) {
    const file = join(A, "textures", `${id}.png`);
    texCache.set(id, existsSync(file) ? average(file) : null);
  }
  return texCache.get(id);
}

/** The first model a blockstate names (its default look). */
function firstModel(state) {
  if (state.variants) {
    const v = state.variants[""] ?? Object.values(state.variants)[0];
    const one = Array.isArray(v) ? v[0] : v;
    return one?.model ?? null;
  }
  if (state.multipart?.length) {
    const apply = state.multipart[0].apply;
    return (Array.isArray(apply) ? apply[0] : apply)?.model ?? null;
  }
  return null;
}

/**
 * Which blocks the game tints by biome, and how. Models mark tinted faces with `tintindex`, but the
 * index also drives redstone power, cauldron contents and stem age, so the biome-tinted set is an
 * explicit list (what the game registers in BlockColors), not a heuristic. Everything else with a
 * tintindex gets no biome tint. Birch and spruce leaves and lily pads use fixed colours instead.
 */
const GRASS_TINTED = new Set([
  "grass_block",
  "short_grass",
  "tall_grass",
  "fern",
  "large_fern",
  "sugar_cane",
  "potted_fern",
  "bush",
  "pink_petals",
  "wildflowers",
]);
const FOLIAGE_UNTINTED = new Set(["cherry_leaves", "azalea_leaves", "flowering_azalea_leaves"]);
const FIXED_TINTS = { birch_leaves: 0x80a755, spruce_leaves: 0x619961, lily_pad: 0x208030 };
const WATER_TINTED = new Set(["water", "bubble_column", "water_cauldron"]);
function tintKind(name) {
  if (WATER_TINTED.has(name)) return "water";
  if (GRASS_TINTED.has(name)) return "grass";
  if ((name.endsWith("_leaves") && !FOLIAGE_UNTINTED.has(name) && !(name in FIXED_TINTS)) || name === "vine")
    return "foliage";
  return null;
}

/** Blocks whose texture alpha understates or overstates how see-through they should look in a flat render. */
const ALPHA_OVERRIDES = { water: 0.55, ice: 0.75, frosted_ice: 0.75, packed_ice: 1, blue_ice: 1 };
/** Leaves are cut-outs (alpha 0.5–0.7 by pixel count) but read as nearly solid canopies in the game. */
const LEAVES_ALPHA = 0.85;

const hex = (v) => (typeof v === "string" ? Number.parseInt(v.replace("#", ""), 16) : v);
const split = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

const blocks = {};
const opaqueSides = ["north", "south", "east", "west"];
for (const file of readdirSync(join(A, "blockstates")).sort()) {
  const name = file.replace(/\.json$/, "");
  const state = JSON.parse(readFileSync(join(A, "blockstates", file), "utf8"));
  const mid = firstModel(state);
  const m = mid ? model(mid) : null;
  if (!m) continue;
  // Per face: colour, weight and whether the face is biome-tinted. Every cube face is 1/6, but the
  // top is what the viewer sees most, so up counts for half and the sides share the rest.
  const faces = [];
  for (const el of m.elements) {
    for (const [dir, face] of Object.entries(el.faces ?? {})) {
      const tex = resolveTexture(m.textures, face.texture);
      const avg = tex ? textureAverage(tex) : null;
      if (!avg || avg.alpha === 0) continue;
      faces.push({ dir, avg, tinted: face.tintindex !== undefined });
    }
  }
  if (faces.length === 0) {
    // No elements (e.g. air, a model without geometry): fall back to the particle texture.
    const tex = resolveTexture(m.textures, "#particle");
    const avg = tex ? textureAverage(tex) : null;
    if (avg && avg.alpha > 0) faces.push({ dir: "up", avg, tinted: false });
    else continue;
  }
  // A tinted block takes its colour from its tinted top (the grass block's side overlays are a thin
  // strip over dirt and would only muddy it); otherwise every face counts.
  const tinted = faces.filter((f) => f.tinted);
  const tintedUp = tinted.filter((f) => f.dir === "up");
  const use = tintedUp.length ? tintedUp : tinted.length ? tinted : faces;
  // Colour: faces weighted by direction and by how much of the face the texture covers, so a mostly
  // transparent overlay (the grass block's side strip) does not drag the colour down.
  const weight = (f) => (f.dir === "up" ? 0.5 : opaqueSides.includes(f.dir) ? 0.125 : 0.05) * f.avg.alpha;
  let wsum = 0;
  const rgb = [0, 0, 0];
  for (const f of use) {
    const w = weight(f);
    wsum += w;
    for (let i = 0; i < 3; i++) rgb[i] += f.avg.rgb[i] * w;
  }
  const entry = { rgb: rgb.map((v) => Math.round(v / wsum)) };
  // Translucency: what the top face covers (overlays stack on opaque faces, so no averaging across elements).
  const ups = faces.filter((f) => f.dir === "up");
  const coverage = Math.max(...(ups.length ? ups : faces).map((f) => f.avg.alpha));
  const override = name.includes("leaves") ? LEAVES_ALPHA : ALPHA_OVERRIDES[name];
  const a = Math.round(Math.min(1, override ?? coverage) * 100) / 100;
  if (a < 0.98) entry.alpha = a;
  const kind = tintKind(name);
  if (kind) entry.tint = kind;
  else if (name in FIXED_TINTS) {
    // The texture is grey; bake the game's fixed colour in.
    const c = split(FIXED_TINTS[name]);
    entry.rgb = entry.rgb.map((v, i) => Math.round((v * c[i]) / 255));
  }
  blocks[name] = entry;
}

// ---- Biomes: temperature/downfall → colormap pixel, plus the per-biome overrides.
const grassMap = png(join(A, "textures/colormap/grass.png"));
const foliageMap = png(join(A, "textures/colormap/foliage.png"));
const lookup = (map, t, d) => {
  const temperature = Math.min(1, Math.max(0, t));
  const downfall = Math.min(1, Math.max(0, d)) * temperature;
  const x = Math.round((1 - temperature) * 255);
  const y = Math.round((1 - downfall) * 255);
  const o = (y * map.w + x) * 4;
  return [map.data[o], map.data[o + 1], map.data[o + 2]];
};
const biomes = {};
for (const file of readdirSync(join(root, "data/minecraft/worldgen/biome")).sort()) {
  const key = file.replace(/\.json$/, "");
  const b = JSON.parse(readFileSync(join(root, "data/minecraft/worldgen/biome", file), "utf8"));
  const fx = b.effects ?? {};
  let grass = fx.grass_color != null ? split(hex(fx.grass_color)) : lookup(grassMap, b.temperature, b.downfall);
  const foliage =
    fx.foliage_color != null ? split(hex(fx.foliage_color)) : lookup(foliageMap, b.temperature, b.downfall);
  if (fx.grass_color_modifier === "swamp") grass = split(0x6a7039);
  else if (fx.grass_color_modifier === "dark_forest") {
    grass = grass.map((v, i) => ((v & 0xfe) + split(0x28340a)[i]) >> 1);
  }
  const water = fx.water_color != null ? split(hex(fx.water_color)) : split(0x3f76e4);
  biomes[key] = { grass, foliage, water };
}

const version = JSON.parse(readFileSync(join(root, "version.json"), "utf8")).id ?? "unknown";
const out = { version, blocks, biomes };
const file = join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "liveview", "blocks.json");
writeFileSync(file, `${JSON.stringify(out)}\n`);
rmSync(root, { recursive: true, force: true });
process.stdout.write(
  `block colours ${version}: ${Object.keys(blocks).length} blocks, ${Object.keys(biomes).length} biomes → lib/liveview/blocks.json\n`,
);
