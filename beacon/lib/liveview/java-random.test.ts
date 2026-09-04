import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JavaRandom, positionSeed, variantAt } from "./java-random";

describe("JavaRandom", () => {
  it("matches java.util.Random for the star seed", () => {
    // Values from `new java.util.Random(10842L)` on JDK 21.
    const r = new JavaRandom(10842);
    const floats = [0.12987703, 0.037620723, 0.8834354, 0.9509856, 0.33311552, 0.7191588];
    for (const f of floats) assert.ok(Math.abs(r.nextFloat() - f) < 1e-7);
    assert.ok(Math.abs(r.nextDouble() - 0.6494954973733805) < 1e-15);
  });
});

describe("the game's position seed", () => {
  // Reference values from java.util.Random and Mth.getSeed, run in a JDK.
  const cases: [number, number, number, bigint, number, number][] = [
    [0, 0, 0, BigInt(0), 0, 8],
    [1, 0, 0, BigInt("133076631897947"), 1, 9],
    [0, 0, 1, BigInt("-20769809646864"), 3, 3],
    [5, 60, 7, BigInt("111281189787778"), 0, 4],
    [-5, 70, 12, BigInt("-18661031759246"), 3, 15],
    [123456, -60, -98765, BigInt("-8413147030986"), 0, 0],
    [2147483647, 319, -2147483648, BigInt("12517264342920"), 2, 14],
  ];
  it("seeds a position as Mth.getSeed does, with Java's overflow", () => {
    for (const [x, y, z, seed] of cases) assert.equal(positionSeed(x, y, z), seed, `${x},${y},${z}`);
  });
  it("draws the variant the game draws, out of four and out of sixteen", () => {
    for (const [x, y, z, , of4, of16] of cases) {
      assert.equal(variantAt(x, y, z, 4), of4, `${x},${y},${z} of 4`);
      assert.equal(variantAt(x, y, z, 16), of16, `${x},${y},${z} of 16`);
    }
    assert.equal(new JavaRandom(0).nextLong(), BigInt("-4962768465676381896"));
  });
});
