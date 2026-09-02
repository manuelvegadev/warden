import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JavaRandom } from "./java-random";

describe("JavaRandom", () => {
  it("matches java.util.Random for the star seed", () => {
    // Values from `new java.util.Random(10842L)` on JDK 21.
    const r = new JavaRandom(10842);
    const floats = [0.12987703, 0.037620723, 0.8834354, 0.9509856, 0.33311552, 0.7191588];
    for (const f of floats) assert.ok(Math.abs(r.nextFloat() - f) < 1e-7);
    assert.ok(Math.abs(r.nextDouble() - 0.6494954973733805) < 1e-15);
  });
});
