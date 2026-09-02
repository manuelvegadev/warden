import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeChunk } from "./format";
import { encodePayload, FLAT_PALETTE, flatBlock } from "./format.test";
import { type BlockTables, meshChunk } from "./mesher";

const flat = (cx: number, cz: number) =>
  decodeChunk(encodePayload({ cx, cz, yMin: 56, yMax: 70, palette: FLAT_PALETTE, block: flatBlock }));

const none = () => undefined;

/** Stone to 59, water 60..61, an ice sheet at 62, in a chunk whose palette lists the blocks in the given order. */
const sheet = (cx: number, names: string[], palette: number[][], ice: number, water: number) =>
  decodeChunk(
    encodePayload({
      cx,
      cz: 0,
      yMin: 56,
      yMax: 64,
      names,
      palette,
      block: (_x, y) => (y <= 59 ? 1 : y <= 61 ? water : y === 62 ? ice : 0),
    }),
  );
const ICE_FIRST = {
  names: ["air", "stone", "ice", "water"],
  palette: [
    [0, 0, 0, 0],
    [112, 112, 112, 0],
    [160, 160, 255, 0],
    [64, 64, 255, 4],
  ],
};
const WATER_FIRST = {
  names: ["air", "stone", "water", "ice"],
  palette: [
    [0, 0, 0, 0],
    [112, 112, 112, 0],
    [64, 64, 255, 4],
    [160, 160, 255, 0],
  ],
};
const ICE_TABLES: BlockTables = {
  blocks: { water: { rgb: [177, 177, 177], alpha: 0.55 }, ice: { rgb: [146, 184, 254], alpha: 0.75 } },
  biomes: {},
};

/** Texture colours that equal the map colours of the fixture, so the numbers below stay readable. */
const TABLES: BlockTables = {
  blocks: {
    stone: { rgb: [112, 112, 112] },
    grass_block: { rgb: [127, 178, 56], tint: "grass" },
    water: { rgb: [64, 64, 255], alpha: 0.55, tint: "water" },
  },
  biomes: { plains: { grass: [255, 255, 255], foliage: [255, 255, 255], water: [255, 255, 255] } },
};

describe("meshChunk", () => {
  it("emits one top face per column plus the sides of an isolated chunk", () => {
    const m = meshChunk(flat(0, 0), none, TABLES);
    // Opaque: 252 grass tops + 4 pool floors (stone under water) + 4 sides × 16 columns × 9 rows (56..64)
    // + the 8 grass walls around the pool, which water does not hide.
    const opaqueQuads = m.indices.length / 6;
    assert.equal(opaqueQuads, 256 + 4 * 16 * 9 + 8);
    assert.equal(m.positions.length, opaqueQuads * 12);
    assert.equal(m.colors.length, opaqueQuads * 16);
    // Translucent: 4 water tops; the pool is enclosed by grass on every side, so no side faces.
    assert.equal(m.transIndices.length / 6, 4);
    assert.equal(m.transColors[3], Math.round(0.55 * 255));
    assert.equal(m.colors[3], 255);
  });

  it("winds every face counter-clockwise seen from outside", () => {
    const m = meshChunk(flat(0, 0), none, TABLES);
    // Outward normal of each quad's first triangle, compared with the face direction its position implies.
    let checked = 0;
    for (let q = 0; q < m.positions.length / 12; q++) {
      const v = (k: number) => [
        m.positions[q * 12 + k * 3],
        m.positions[q * 12 + k * 3 + 1],
        m.positions[q * 12 + k * 3 + 2],
      ];
      const [a, b, c] = [m.indices[q * 6], m.indices[q * 6 + 1], m.indices[q * 6 + 2]].map((i) => v(i - q * 4));
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const ys = [0, 1, 2, 3].map((k) => v(k)[1]);
      const xs = [0, 1, 2, 3].map((k) => v(k)[0]);
      if (ys.every((y) => y === 65)) {
        assert.ok(n[1] > 0, `top face at ${a} has normal ${n}`);
        checked++;
      } else if (xs.every((x) => x === 0)) {
        assert.ok(n[0] < 0, `west face at ${a} has normal ${n}`);
        checked++;
      } else if (xs.every((x) => x === 16)) {
        assert.ok(n[0] > 0, `east face at ${a} has normal ${n}`);
        checked++;
      }
    }
    assert.ok(checked > 300);
  });

  it("culls the faces that touch a loaded neighbour", () => {
    const east = flat(1, 0);
    const m = meshChunk(flat(0, 0), (dx, dz) => (dx === 1 && dz === 0 ? east : undefined), TABLES);
    // One side (16 columns × 9 rows) is now hidden.
    assert.equal(m.indices.length / 6, 256 + 3 * 16 * 9 + 8);
  });

  it("shades tops brighter than sides and darkens occluded corners", () => {
    const m = meshChunk(flat(0, 0), none, TABLES);
    // A top face in the middle of the plain: every corner is open (ao 3), shade 1.0.
    const top = quad(m, (xs, ys, zs) => ys.every((y) => y === 65) && within(xs, 5, 6) && within(zs, 5, 6));
    assert.deepEqual(top, [127, 178, 56]);
    // A west face at the chunk edge (x = 0), two rows under the surface: shade 0.72, corners open.
    const side = quad(m, (xs, ys, zs) => xs.every((x) => x === 0) && within(ys, 58, 59) && within(zs, 5, 6));
    assert.deepEqual(side, [Math.round(112 * 0.72), Math.round(112 * 0.72), Math.round(112 * 0.72)]);
    // The pool floor (stone under water) at the pool's corner: the vertex against two grass walls is
    // fully occluded (ao 0), the one inside the pool sees only water (ao 3). Water never occludes.
    const floor = quadColors(m, (xs, ys, zs) => ys.every((y) => y === 64) && within(xs, 10, 11) && within(zs, 10, 11));
    assert.ok(floor);
    const reds = [0, 4, 8, 12].map((k) => floor[k]);
    assert.equal(Math.min(...reds), Math.round(112 * 0.5));
    assert.equal(Math.max(...reds), 112);
    // The grass wall of the pool, facing the water at x = 10: darker than an open side face.
    const wall = quad(m, (xs, ys, zs) => xs.every((x) => x === 10) && within(ys, 64, 65) && within(zs, 10, 11));
    assert.ok(wall);
    assert.ok(wall[0] < Math.round(127 * 0.72), `wall ${wall}`);
  });

  it("culls translucent faces across chunk borders even when palettes differ", () => {
    // The west chunk lists ice before water, the east one water before ice: the sheet must still be seamless.
    const west = sheet(0, ICE_FIRST.names, ICE_FIRST.palette, 2, 3);
    const east = sheet(1, WATER_FIRST.names, WATER_FIRST.palette, 3, 2);
    const m = meshChunk(west, (dx, dz) => (dx === 1 && dz === 0 ? east : undefined), ICE_TABLES);
    // No translucent face on the shared border at x = 16.
    for (let q = 0; q < m.transPositions.length / 12; q++) {
      const xs = [0, 3, 6, 9].map((k) => m.transPositions[q * 12 + k]);
      assert.ok(!xs.every((x) => x === 16), "a translucent face leaked onto the chunk border");
    }
  });

  it("orders translucent quads bottom-up so layers blend correctly from above", () => {
    // The chunk-edge water sides (y 60..62) must precede the ice tops (y 63).
    const m = meshChunk(sheet(0, WATER_FIRST.names, WATER_FIRST.palette, 3, 2), none, ICE_TABLES);
    let last = -Infinity;
    for (let q = 0; q < m.transPositions.length / 12; q++) {
      const y =
        m.transPositions[q * 12 + 1] +
        m.transPositions[q * 12 + 4] +
        m.transPositions[q * 12 + 7] +
        m.transPositions[q * 12 + 10];
      assert.ok(y >= last, `quad ${q} at y ${y / 4} after ${last / 4}`);
      last = y;
      // Indices still address this quad's own four vertices.
      for (let k = 0; k < 6; k++)
        assert.ok(m.transIndices[q * 6 + k] >= q * 4 && m.transIndices[q * 6 + k] < q * 4 + 4);
    }
    // One translucent shell: the ice tops and the chunk-edge sides of ice and water. No ice-water interface.
    assert.equal(m.transIndices.length / 6, 256 + 4 * 16 * 3);
  });

  it("tints by the column's biome and falls back to the map colour for unknown blocks", () => {
    const tables: BlockTables = {
      blocks: { grass_block: { rgb: [200, 200, 200], tint: "grass" }, water: { rgb: [177, 177, 177], alpha: 0.55 } },
      biomes: { plains: { grass: [255, 128, 0], foliage: [255, 255, 255], water: [255, 255, 255] } },
    };
    // The pool is a modded liquid the table does not know: only its wire flag says it is water-like.
    const c = decodeChunk(
      encodePayload({
        cx: 0,
        cz: 0,
        yMin: 56,
        yMax: 70,
        palette: FLAT_PALETTE,
        names: ["air", "stone", "grass_block", "slime_fluid"],
        block: flatBlock,
      }),
    );
    const m = meshChunk(c, none, tables);
    const top = quad(m, (xs, ys, zs) => ys.every((y) => y === 65) && within(xs, 5, 6) && within(zs, 5, 6));
    assert.deepEqual(top, [200, 100, 0]);
    // Stone is not in the table: its palette (map) colour is used as is.
    const side = quad(m, (xs, ys, zs) => xs.every((x) => x === 0) && within(ys, 58, 59) && within(zs, 5, 6));
    assert.deepEqual(side, [Math.round(112 * 0.72), Math.round(112 * 0.72), Math.round(112 * 0.72)]);
    // The unknown liquid is translucent through its flag, with the table's water alpha.
    assert.equal(m.transIndices.length / 6, 4);
    assert.equal(m.transColors[3], Math.round(0.55 * 255));
  });
});

/** Colours (16 numbers, RGBA × 4) of the first quad whose corner coordinates satisfy `pred`. */
function quadColors(
  m: ReturnType<typeof meshChunk>,
  pred: (xs: number[], ys: number[], zs: number[]) => boolean,
): number[] | null {
  for (let q = 0; q < m.positions.length / 12; q++) {
    const xs = [0, 3, 6, 9].map((k) => m.positions[q * 12 + k]);
    const ys = [1, 4, 7, 10].map((k) => m.positions[q * 12 + k]);
    const zs = [2, 5, 8, 11].map((k) => m.positions[q * 12 + k]);
    if (pred(xs, ys, zs)) return Array.from(m.colors.subarray(q * 16, q * 16 + 16));
  }
  return null;
}

/** RGB of the first vertex of that quad. */
const quad = (m: ReturnType<typeof meshChunk>, pred: (xs: number[], ys: number[], zs: number[]) => boolean) =>
  quadColors(m, pred)?.slice(0, 3) ?? null;

const within = (vs: number[], lo: number, hi: number) => Math.min(...vs) === lo && Math.max(...vs) === hi;
