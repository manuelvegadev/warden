import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeChunk, FLAG_WATER, FLAG_WATERLOGGED } from "./format";
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
    const opaqueQuads = m.opaque.indices.length / 6;
    assert.equal(opaqueQuads, 256 + 4 * 16 * 9 + 8);
    assert.equal(m.opaque.positions.length, opaqueQuads * 12);
    assert.equal(m.opaque.colors.length, opaqueQuads * 16);
    // Translucent: 4 water tops; the pool is enclosed by grass on every side, so no side faces.
    assert.equal(m.trans.indices.length / 6, 4);
    assert.equal(m.trans.colors[3], Math.round(0.55 * 255));
    assert.equal(m.opaque.colors[3], 255);
  });

  it("winds every face counter-clockwise seen from outside", () => {
    const m = meshChunk(flat(0, 0), none, TABLES);
    // Outward normal of each quad's first triangle, compared with the face direction its position implies.
    let checked = 0;
    for (let q = 0; q < m.opaque.positions.length / 12; q++) {
      const v = (k: number) => [
        m.opaque.positions[q * 12 + k * 3],
        m.opaque.positions[q * 12 + k * 3 + 1],
        m.opaque.positions[q * 12 + k * 3 + 2],
      ];
      const [a, b, c] = [m.opaque.indices[q * 6], m.opaque.indices[q * 6 + 1], m.opaque.indices[q * 6 + 2]].map((i) =>
        v(i - q * 4),
      );
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
    assert.equal(m.opaque.indices.length / 6, 256 + 3 * 16 * 9 + 8);
  });

  it("shades tops brighter than sides and darkens occluded corners", () => {
    const m = meshChunk(flat(0, 0), none, TABLES);
    // A top face in the middle of the plain: every corner is open (ao 3), shade 1.0.
    const top = quad(m, (xs, ys, zs) => ys.every((y) => y === 65) && within(xs, 5, 6) && within(zs, 5, 6));
    assert.deepEqual(top, [127, 178, 56]);
    // A west face at the chunk edge (x = 0), two rows under the surface: shade 0.6, corners open.
    const side = quad(m, (xs, ys, zs) => xs.every((x) => x === 0) && within(ys, 58, 59) && within(zs, 5, 6));
    assert.deepEqual(side, [Math.round(112 * 0.6), Math.round(112 * 0.6), Math.round(112 * 0.6)]);
    // The pool floor (stone under water) at the pool's corner: the vertex against two grass walls is
    // fully occluded (ao 0), the one inside the pool sees only water (ao 3). Water never occludes.
    const floor = quadColors(m, (xs, ys, zs) => ys.every((y) => y === 64) && within(xs, 10, 11) && within(zs, 10, 11));
    assert.ok(floor);
    const reds = [0, 4, 8, 12].map((k) => floor[k]);
    assert.equal(Math.min(...reds), Math.round(112 * 0.4)); // the fully occluded corner's shade
    assert.equal(Math.max(...reds), 112);
    // The grass wall of the pool, facing the water at x = 10: darker than an open side face.
    const wall = quad(m, (xs, ys, zs) => xs.every((x) => x === 10) && within(ys, 64, 65) && within(zs, 10, 11));
    assert.ok(wall);
    assert.ok(wall[0] < Math.round(127 * 0.6), `wall ${wall}`);
  });

  it("culls translucent faces across chunk borders even when palettes differ", () => {
    // The west chunk lists ice before water, the east one water before ice: the sheet must still be seamless.
    const west = sheet(0, ICE_FIRST.names, ICE_FIRST.palette, 2, 3);
    const east = sheet(1, WATER_FIRST.names, WATER_FIRST.palette, 3, 2);
    const m = meshChunk(west, (dx, dz) => (dx === 1 && dz === 0 ? east : undefined), ICE_TABLES);
    // No translucent face on the shared border at x = 16.
    for (let q = 0; q < m.trans.positions.length / 12; q++) {
      const xs = [0, 3, 6, 9].map((k) => m.trans.positions[q * 12 + k]);
      assert.ok(!xs.every((x) => x === 16), "a translucent face leaked onto the chunk border");
    }
  });

  it("orders translucent quads bottom-up so layers blend correctly from above", () => {
    // The chunk-edge water sides (y 60..62) must precede the ice tops (y 63).
    const m = meshChunk(sheet(0, WATER_FIRST.names, WATER_FIRST.palette, 3, 2), none, ICE_TABLES);
    let last = -Infinity;
    for (let q = 0; q < m.trans.positions.length / 12; q++) {
      const y =
        m.trans.positions[q * 12 + 1] +
        m.trans.positions[q * 12 + 4] +
        m.trans.positions[q * 12 + 7] +
        m.trans.positions[q * 12 + 10];
      assert.ok(y >= last, `quad ${q} at y ${y / 4} after ${last / 4}`);
      last = y;
      // Indices still address this quad's own four vertices.
      for (let k = 0; k < 6; k++)
        assert.ok(m.trans.indices[q * 6 + k] >= q * 4 && m.trans.indices[q * 6 + k] < q * 4 + 4);
    }
    // One translucent shell: the ice tops and the chunk-edge sides of ice and water. No ice-water interface.
    assert.equal(m.trans.indices.length / 6, 256 + 4 * 16 * 3);
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
    assert.deepEqual(side, [Math.round(112 * 0.6), Math.round(112 * 0.6), Math.round(112 * 0.6)]);
    // The unknown liquid is translucent through its flag, with the table's water alpha.
    assert.equal(m.trans.indices.length / 6, 4);
    assert.equal(m.trans.colors[3], Math.round(0.55 * 255));
  });
});

/** Colours (16 numbers, RGBA × 4) of the first quad whose corner coordinates satisfy `pred`. */
function quadColors(
  m: ReturnType<typeof meshChunk>,
  pred: (xs: number[], ys: number[], zs: number[]) => boolean,
): number[] | null {
  for (let q = 0; q < m.opaque.positions.length / 12; q++) {
    const xs = [0, 3, 6, 9].map((k) => m.opaque.positions[q * 12 + k]);
    const ys = [1, 4, 7, 10].map((k) => m.opaque.positions[q * 12 + k]);
    const zs = [2, 5, 8, 11].map((k) => m.opaque.positions[q * 12 + k]);
    if (pred(xs, ys, zs)) return Array.from(m.opaque.colors.subarray(q * 16, q * 16 + 16));
  }
  return null;
}

/** RGB of the first vertex of that quad. */
const quad = (m: ReturnType<typeof meshChunk>, pred: (xs: number[], ys: number[], zs: number[]) => boolean) =>
  quadColors(m, pred)?.slice(0, 3) ?? null;

const within = (vs: number[], lo: number, hi: number) => Math.min(...vs) === lo && Math.max(...vs) === hi;

describe("meshChunk with water", () => {
  /** Stone to 59, water at 60 and 61 over the west half of the chunk, air above and to the east. */
  const pool = () =>
    decodeChunk(
      encodePayload({
        cx: 0,
        cz: 0,
        yMin: 56,
        yMax: 64,
        names: ["air", "stone", "water"],
        palette: [
          [0, 0, 0, 0],
          [112, 112, 112, 0],
          [64, 64, 255, FLAG_WATER],
        ],
        block: (x, y) => (y <= 59 ? 1 : y <= 61 && x < 8 ? 2 : 0),
      }),
    );
  const TABLES_WATER: BlockTables = {
    blocks: { stone: { rgb: [112, 112, 112] }, water: { rgb: [64, 64, 255], alpha: 0.55, tint: "water" } },
    biomes: {},
  };

  it("draws a block that holds water as that water, keeping its key in the palette", () => {
    // Seagrass at 61 with its own key and the waterlogged flag: the sea has no hole where it stands.
    const chunk = decodeChunk(
      encodePayload({
        cx: 0,
        cz: 0,
        yMin: 56,
        yMax: 64,
        names: ["air", "stone", "water", "seagrass"],
        palette: [
          [0, 0, 0, 0],
          [112, 112, 112, 0],
          [64, 64, 255, FLAG_WATER],
          [0, 153, 0, FLAG_WATERLOGGED],
        ],
        block: (x, y) => (y <= 59 ? 1 : y > 61 || x >= 8 ? 0 : y === 61 && x === 3 ? 3 : 2),
      }),
    );
    assert.equal(chunk.entries[3].name, "seagrass", "the palette keeps the plant's key");
    const m = meshChunk(chunk, none, TABLES_WATER);
    const ys = Array.from(m.trans.positions).filter((_, k) => k % 3 === 1);
    assert.equal(ys.includes(62), false, "the seagrass cell is a water surface like the rest");
    assert.ok(Math.abs(Math.max(...ys) - (62 - 1 / 9)) < 1e-6);
    // Its column is drawn: the pool has as many surface quads as it has columns of water.
    const surface = Math.max(...ys);
    const tops = Array.from({ length: m.trans.positions.length / 12 }, (_, q) =>
      [1, 4, 7, 10].every((k) => m.trans.positions[q * 12 + k] === surface),
    ).filter(Boolean).length;
    assert.equal(tops, 8 * 16, "every column of the pool has a surface, the plant's included");
  });

  it("draws the surface a little below the block's top and keeps the water under it full", () => {
    const m = meshChunk(pool(), none, TABLES_WATER);
    const ys = Array.from(m.trans.positions).filter((_, k) => k % 3 === 1);
    assert.ok(ys.length > 0, "the pool is meshed");
    assert.equal(ys.includes(62), false, "no water vertex reaches the block's top");
    assert.ok(ys.includes(61), "the water below the surface keeps its full height");
    assert.ok(Math.abs(Math.max(...ys) - (62 - 1 / 9)) < 1e-6, `surface at ${Math.max(...ys)}`);
    // The stone under the pool is untouched: its top sits at 60.
    const stone = Array.from(m.opaque.positions).filter((_, k) => k % 3 === 1);
    assert.ok(stone.includes(60), "the pool's floor is where it was");
  });
});

describe("meshChunk with random looks", () => {
  /** The top face of the grass block at (x, 64, z): its quad index in the opaque part. */
  const topAt = (m: ReturnType<typeof meshChunk>, x: number, z: number) => {
    const o = m.opaque;
    for (let q = 0; q < o.positions.length / 12; q++) {
      const ys = [1, 4, 7, 10].map((k) => o.positions[q * 12 + k]);
      const xs = [0, 3, 6, 9].map((k) => o.positions[q * 12 + k]);
      const zs = [2, 5, 8, 11].map((k) => o.positions[q * 12 + k]);
      if (ys.every((y) => y === 65) && Math.min(...xs) === x && Math.min(...zs) === z) return q;
    }
    return -1;
  };
  it("turns each grass top the way the game does at that position", () => {
    // The stone's four looks: plain, mirrored (tile 4), and both turned half round.
    const grass = { faces: [7, 8, 9, 9, 9, 9], tint: [1, 0, 0, 0, 0, 0] };
    const tables: BlockTables = {
      ...TABLES,
      faces: {
        grass_block: {
          ...grass,
          random: [
            grass,
            { ...grass, rot: [1, 3, 0, 0, 0, 0] },
            { ...grass, rot: [2, 2, 0, 0, 0, 0] },
            { ...grass, rot: [3, 1, 0, 0, 0, 0] },
          ],
        },
        stone: { faces: [3, 3, 3, 3, 3, 3], random: [{ faces: [3, 3, 3, 3, 3, 3] }, { faces: [4, 4, 4, 4, 4, 4] }] },
      },
    };
    const m = meshChunk(flat(0, 0), none, tables);
    // Mth.getSeed + java.util.Random, run in a JDK, for (x, 64, 3), x = 0..15, four variants.
    const game = [1, 1, 1, 0, 0, 1, 2, 3, 0, 0, 3, 0, 0, 0, 3, 0];
    // The turn shows in the uv of the quad's first corner: (0,0) plain, then each quarter turn moves it.
    const cornerOf = [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ];
    const seen = new Set<number>();
    for (let x = 0; x < 16; x++) {
      const q = topAt(m, x, 3);
      assert.ok(q >= 0, `top at ${x}`);
      const uv = [m.opaque.tileUv[q * 8], m.opaque.tileUv[q * 8 + 1]].map((v) => (v ? 1 : 0));
      const turn = cornerOf.findIndex(([u, v]) => u === uv[0] && v === uv[1]);
      assert.equal(turn, game[x], `turn at x=${x}`);
      seen.add(turn);
    }
    assert.ok(seen.size > 1, "a row of grass does not repeat one look");
    assert.equal(m.opaque.tileLayer[topAt(m, 0, 3) * 4], 7, "every look of the grass shares its top tile");
  });
});

describe("meshChunk with textures", () => {
  it("puts each face's tile on its vertices and tints only the faces the table says", () => {
    const tables: BlockTables = {
      ...TABLES,
      faces: {
        grass_block: { faces: [7, 8, 9, 9, 9, 9], tint: [1, 0, 0, 0, 0, 0] },
        stone: { faces: [3, 3, 3, 3, 3, 3] },
      },
    };
    const m = meshChunk(flat(0, 0), none, {
      ...tables,
      biomes: { plains: { grass: [0, 255, 0], foliage: [255, 255, 255], water: [255, 255, 255] } },
    });
    const o = m.opaque;
    // The grass top at y = 65 over (5, 5): tile 7, tinted green; a grass side: tile 9, untinted white.
    const topQuad = (() => {
      for (let q = 0; q < o.positions.length / 12; q++) {
        const ys = [1, 4, 7, 10].map((k) => o.positions[q * 12 + k]);
        const xs = [0, 3, 6, 9].map((k) => o.positions[q * 12 + k]);
        if (ys.every((y) => y === 65) && xs.every((x) => x >= 5 && x <= 6)) return q;
      }
      return -1;
    })();
    assert.ok(topQuad >= 0);
    assert.equal(o.tileLayer[topQuad * 4], 7);
    const top = Array.from(o.colors.subarray(topQuad * 16, topQuad * 16 + 3));
    assert.deepEqual(top, [0, 255, 0], "the top is the tint alone: the tile brings the green blades");
    // Every top vertex has u,v at the tile's corners (0 or 255), and all four corners are covered.
    const uvs = new Set<string>();
    for (let k = 0; k < 4; k++) uvs.add(`${o.tileUv[topQuad * 8 + k * 2]},${o.tileUv[topQuad * 8 + k * 2 + 1]}`);
    assert.deepEqual([...uvs].sort(), ["0,0", "0,255", "255,0", "255,255"]);
    const wall = quad(m, (xs, ys, zs) => xs.every((x) => x === 10) && within(ys, 64, 65) && within(zs, 10, 11));
    assert.ok(wall, "a grass wall face around the pool");
  });

  it("keeps the flat colour for blocks the table does not know", () => {
    const m = meshChunk(flat(0, 0), none, { ...TABLES, faces: { stone: { faces: [3, 3, 3, 3, 3, 3] } } });
    const top = quad(m, (xs, ys, zs) => ys.every((y) => y === 65) && within(xs, 5, 6) && within(zs, 5, 6));
    assert.ok(top);
    assert.deepEqual(top.slice(0, 3), [127, 178, 56], "grass without a tile keeps its colour");
    assert.equal(m.opaque.tileLayer[0] >= 0, true);
  });
});

describe("leaves", () => {
  /** A 2×1×1 pair of leaf blocks in the air above the flat chunk. */
  const pair = () =>
    decodeChunk(
      encodePayload({
        cx: 0,
        cz: 0,
        yMin: 56,
        yMax: 72,
        names: ["air", "oak_leaves"],
        palette: [
          [0, 0, 0, 0],
          [64, 128, 64, 2],
        ],
        block: (x, y, z) => (y === 70 && z === 5 && (x === 5 || x === 6) ? 1 : 0),
      }),
    );
  const tables = (mode: "fast" | "fancy"): BlockTables => ({
    blocks: { oak_leaves: { rgb: [144, 144, 144], alpha: 0.85, tint: "foliage" } },
    biomes: { plains: { grass: [255, 255, 255], foliage: [0, 255, 0], water: [255, 255, 255] } },
    faces: { oak_leaves: { faces: [5, 5, 5, 5, 5, 5], tint: [1, 1, 1, 1, 1, 1], solid: [6, 6, 6, 6, 6, 6] } },
    leaves: mode,
  });

  it("fast: solid tiles, opaque, and no faces between two leaf blocks", () => {
    const m = meshChunk(pair(), none, tables("fast"));
    assert.equal(m.trans.indices.length, 0, "not translucent any more");
    assert.equal(m.opaque.indices.length / 6, 10, "two cubes share a face: 12 − 2");
    assert.equal(m.opaque.tileLayer[0], 6, "the solid tile");
  });

  it("fancy: cut-out tiles, and the faces between the two leaf blocks stay", () => {
    const m = meshChunk(pair(), none, tables("fancy"));
    assert.equal(m.trans.indices.length, 0);
    assert.equal(m.opaque.indices.length / 6, 12, "every face of both cubes");
    assert.equal(m.opaque.tileLayer[0], 5, "the cut-out tile");
  });

  it("without textures leaves stay translucent as before", () => {
    const t = tables("fancy");
    const m = meshChunk(pair(), none, { ...t, faces: undefined });
    assert.equal(m.opaque.indices.length, 0);
    assert.equal(m.trans.indices.length / 6, 10);
  });
});

describe("light", () => {
  /** A flat stone floor at y = 60 under daylight, a torch's light centred on (5, 61, 5), a dark corner at x ≥ 12. */
  const lit = () =>
    decodeChunk(
      encodePayload({
        cx: 0,
        cz: 0,
        yMin: 59,
        yMax: 62,
        names: ["air", "stone"],
        palette: [
          [0, 0, 0, 0, 0],
          [112, 112, 112, 0, 0],
        ],
        block: (_x, y) => (y <= 60 ? 1 : 0),
        // The torch's light spreads a level per block, as the server's does.
        light: (x, y, z) => [x >= 12 ? 0 : 15, Math.max(0, 14 - Math.abs(x - 5) - Math.abs(y - 61) - Math.abs(z - 5))],
      }),
    );
  const tables: BlockTables = { blocks: { stone: { rgb: [112, 112, 112] } }, biomes: {} };
  /** The light bytes of the top face of the floor block at (x, z): sky, block per corner. */
  const lightOf = (m: ReturnType<typeof meshChunk>, x: number, z: number) => {
    const o = m.opaque;
    for (let q = 0; q < o.positions.length / 12; q++) {
      const xs = [0, 3, 6, 9].map((k) => o.positions[q * 12 + k]);
      const ys = [1, 4, 7, 10].map((k) => o.positions[q * 12 + k]);
      const zs = [2, 5, 8, 11].map((k) => o.positions[q * 12 + k]);
      if (ys.every((y) => y === 61) && Math.min(...xs) === x && Math.min(...zs) === z) {
        return Array.from(o.light.subarray(q * 8, q * 8 + 8));
      }
    }
    return null;
  };

  it("lights a top face with the cell above it: daylight, a torch, or the dark", () => {
    const m = meshChunk(lit(), none, tables);
    const day = lightOf(m, 0, 14);
    assert.ok(day);
    assert.deepEqual(
      day.filter((_, k) => k % 2 === 0),
      [255, 255, 255, 255],
      "sky 15 at every corner",
    );
    assert.ok(
      day.filter((_, k) => k % 2 === 1).every((v) => v <= 17),
      "at most a trace of the far torch",
    );
    const torch = lightOf(m, 5, 5);
    assert.ok(torch);
    assert.ok(Math.max(...torch.filter((_, k) => k % 2 === 1)) >= 200, "block light 14 reaches the corners");
    const dark = lightOf(m, 13, 8);
    assert.ok(dark);
    assert.deepEqual(
      dark.filter((_, k) => k % 2 === 0),
      [0, 0, 0, 0],
      "no sky light in the dark corner",
    );
  });

  it("averages the corners between lit and dark cells, and takes daylight without light data", () => {
    const m = meshChunk(lit(), none, tables);
    const edge = lightOf(m, 11, 8);
    assert.ok(edge);
    const skies = edge.filter((_, k) => k % 2 === 0);
    assert.ok(
      skies.some((v) => v > 0 && v < 255),
      "a corner shared with the dark side is in between",
    );
    const old = meshChunk(flat(0, 0), none, TABLES);
    assert.equal(old.opaque.light[0], 255, "a chunk without light is drawn in daylight");
  });
});

describe("turned blocks", () => {
  /** One log at (5, 60, 5), lying along x. */
  const log = () =>
    decodeChunk(
      encodePayload({
        cx: 0,
        cz: 0,
        yMin: 59,
        yMax: 61,
        names: ["air", "oak_log"],
        palette: [
          [0, 0, 0, 0, 0],
          [143, 106, 62, 0, 1],
        ],
        block: (x, y, z) => (x === 5 && y === 60 && z === 5 ? 1 : 0),
      }),
    );
  const tables: BlockTables = {
    blocks: { oak_log: { rgb: [143, 106, 62] } },
    biomes: {},
    faces: {
      oak_log: {
        faces: [1, 1, 2, 2, 2, 2],
        variants: { x: { faces: [2, 2, 2, 2, 1, 1], rot: [1, 1, 3, 1, 0, 0] } },
      },
    },
  };
  const faceAt = (m: ReturnType<typeof meshChunk>, pick: (xs: number[], ys: number[], zs: number[]) => boolean) => {
    const o = m.opaque;
    for (let q = 0; q < o.positions.length / 12; q++) {
      const xs = [0, 3, 6, 9].map((k) => o.positions[q * 12 + k]);
      const ys = [1, 4, 7, 10].map((k) => o.positions[q * 12 + k]);
      const zs = [2, 5, 8, 11].map((k) => o.positions[q * 12 + k]);
      if (pick(xs, ys, zs)) return { layer: o.tileLayer[q * 4], uv: Array.from(o.tileUv.subarray(q * 8, q * 8 + 8)) };
    }
    return null;
  };

  it("uses the orientation's faces: the log's ends on ±x", () => {
    const m = meshChunk(log(), none, tables);
    const east = faceAt(m, (xs) => xs.every((x) => x === 6));
    const top = faceAt(m, (_xs, ys) => ys.every((y) => y === 61));
    assert.equal(east?.layer, 1, "an end");
    assert.equal(top?.layer, 2, "bark on top");
  });

  it("turns a face's texture by the variant's quarter turns", () => {
    const m = meshChunk(log(), none, tables);
    const top = faceAt(m, (_xs, ys) => ys.every((y) => y === 61));
    // Unturned, the top's corners read (0,0),(0,255),(255,0),(255,255) in some order; one quarter turn
    // keeps the set but no corner keeps both coordinates unless it was a fixed point of the turn.
    const corners = [0, 2, 4, 6].map((k) => `${top?.uv[k]},${top?.uv[k + 1]}`).sort();
    assert.deepEqual(corners, ["0,0", "0,255", "255,0", "255,255"], "still the four tile corners");
    const plain = meshChunk(log(), none, { ...tables, faces: { oak_log: { faces: [1, 1, 2, 2, 2, 2] } } });
    const plainTop = faceAt(plain, (_xs, ys) => ys.every((y) => y === 61));
    assert.notDeepEqual(top?.uv, plainTop?.uv, "the turned top reads its tile differently");
  });
});
