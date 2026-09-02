import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeChunk } from "./format";
import { encodePayload, FLAT_PALETTE, flatBlock } from "./format.test";
import { meshChunk } from "./mesher";

const flat = (cx: number, cz: number) =>
  decodeChunk(encodePayload({ cx, cz, yMin: 56, yMax: 70, palette: FLAT_PALETTE, block: flatBlock }));

const none = () => undefined;

describe("meshChunk", () => {
  it("emits one top face per column plus the sides of an isolated chunk", () => {
    const m = meshChunk(flat(0, 0), none);
    // Opaque: 252 grass tops + 4 pool floors (stone under water) + 4 sides × 16 columns × 9 rows (56..64)
    // + the 8 grass walls around the pool, which water does not hide.
    const opaqueQuads = m.indices.length / 6;
    assert.equal(opaqueQuads, 256 + 4 * 16 * 9 + 8);
    assert.equal(m.positions.length, opaqueQuads * 12);
    assert.equal(m.colors.length, opaqueQuads * 12);
    // Water: 4 tops; the pool is enclosed by grass on every side, so no side faces.
    assert.equal(m.waterIndices.length / 6, 4);
  });

  it("winds every face counter-clockwise seen from outside", () => {
    const m = meshChunk(flat(0, 0), none);
    // Outward normal of each quad's first triangle, compared with the face direction its position implies.
    let checked = 0;
    for (let q = 0; q < m.positions.length / 12; q++) {
      const v = (k: number) => [
        m.positions[q * 12 + k * 3],
        m.positions[q * 12 + k * 3 + 1],
        m.positions[q * 12 + k * 3 + 2],
      ];
      const i0 = m.indices[q * 6];
      const i1 = m.indices[q * 6 + 1];
      const i2 = m.indices[q * 6 + 2];
      const a = v(i0 - q * 4);
      const b = v(i1 - q * 4);
      const c = v(i2 - q * 4);
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
    const m = meshChunk(flat(0, 0), (dx, dz) => (dx === 1 && dz === 0 ? east : undefined));
    // One side (16 columns × 9 rows) is now hidden.
    assert.equal(m.indices.length / 6, 256 + 3 * 16 * 9 + 8);
  });

  it("shades tops brighter than sides and darkens occluded corners", () => {
    const m = meshChunk(flat(0, 0), none);
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
    const reds = [0, 3, 6, 9].map((k) => floor[k]);
    assert.equal(Math.min(...reds), Math.round(112 * 0.5));
    assert.equal(Math.max(...reds), 112);
    // The grass wall of the pool, facing the water at x = 10: darker than an open side face.
    const wall = quad(m, (xs, ys, zs) => xs.every((x) => x === 10) && within(ys, 64, 65) && within(zs, 10, 11));
    assert.ok(wall);
    assert.ok(wall[0] < Math.round(127 * 0.72), `wall ${wall}`);
  });
});

/** Colours (12 numbers) of the first quad whose corner coordinates satisfy `pred`. */
function quadColors(
  m: ReturnType<typeof meshChunk>,
  pred: (xs: number[], ys: number[], zs: number[]) => boolean,
): number[] | null {
  for (let q = 0; q < m.positions.length / 12; q++) {
    const xs = [0, 3, 6, 9].map((k) => m.positions[q * 12 + k]);
    const ys = [1, 4, 7, 10].map((k) => m.positions[q * 12 + k]);
    const zs = [2, 5, 8, 11].map((k) => m.positions[q * 12 + k]);
    if (pred(xs, ys, zs)) return Array.from(m.colors.subarray(q * 12, q * 12 + 12));
  }
  return null;
}

/** Colour of the first vertex of that quad. */
const quad = (m: ReturnType<typeof meshChunk>, pred: (xs: number[], ys: number[], zs: number[]) => boolean) =>
  quadColors(m, pred)?.slice(0, 3) ?? null;

const within = (vs: number[], lo: number, hi: number) => Math.min(...vs) === lo && Math.max(...vs) === hi;
