import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boxFaceRects, buildBuffers, type Geometry, parseGeometries, toModelRotation } from "./geometry";
import { parseJsonc } from "./jsonc";

/** Steve's head: an 8-cube at the top-left of the skin. */
const HEAD: Geometry = {
  id: "geometry.test",
  textureWidth: 64,
  textureHeight: 64,
  bones: [
    { name: "root", pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [] },
    {
      name: "head",
      parent: "root",
      pivot: [0, 24, 0],
      rotation: [0, 0, 0],
      cubes: [{ origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0], inflate: 0, mirror: false }],
    },
  ],
};

const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

describe("bedrock geometry", () => {
  it("unwraps a box the way the skin is painted", () => {
    const r = boxFaceRects([0, 0], [8, 8, 8], false);
    assert.deepEqual(r.up, [8, 0, 16, 8]);
    assert.deepEqual(r.down, [16, 8, 24, 0]);
    assert.deepEqual(r.west, [0, 8, 8, 16]);
    assert.deepEqual(r.north, [8, 8, 16, 16]);
    assert.deepEqual(r.east, [16, 8, 24, 16]);
    assert.deepEqual(r.south, [24, 8, 32, 16]);
    const m = boxFaceRects([0, 0], [8, 8, 8], true);
    assert.deepEqual(m.north, [16, 8, 8, 16], "mirrored: read right to left");
    assert.deepEqual(m.west, [24, 8, 16, 16], "mirrored: the sides swap");
  });

  it("winds every face outward once x is mirrored", () => {
    const b = buildBuffers(HEAD);
    assert.equal(b.indices.length, 36);
    assert.equal(b.positions.length, 24 * 3);
    const centre = [0, 28, 0];
    for (let f = 0; f < 6; f++) {
      const v = (i: number) => Array.from(b.positions.subarray(i * 3, i * 3 + 3));
      const [p0, p1, p2] = [v(b.indices[f * 6]), v(b.indices[f * 6 + 1]), v(b.indices[f * 6 + 2])];
      const n = cross([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]]);
      const mid = [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2, (p0[2] + p2[2]) / 2];
      const out = [mid[0] - centre[0], mid[1] - centre[1], mid[2] - centre[2]];
      assert.ok(n[0] * out[0] + n[1] * out[1] + n[2] * out[2] > 0, `face ${f} faces outward`);
      for (let k = 0; k < 4; k++) assert.equal(b.boneIndex[f * 4 + k], 1);
    }
  });

  it("puts the face texture on the front, upright", () => {
    const b = buildBuffers(HEAD);
    // The north face is the first: its top-left vertex reads the skin at (8, 8), the top of the face.
    assert.deepEqual(Array.from(b.uvs.subarray(0, 2)), [8 / 64, 1 - 8 / 64]);
    const p = Array.from(b.positions.subarray(0, 3));
    assert.equal(p[2], -4, "the front is at −z");
    assert.equal(p[1], 32, "the top row is at the top of the head");
  });

  it("reads both file formats", () => {
    const modern = parseGeometries({
      format_version: "1.21.0",
      "minecraft:geometry": [{ description: { identifier: "geometry.a", texture_width: 32 }, bones: [{ name: "b" }] }],
    });
    assert.equal(modern.get("geometry.a")?.textureWidth, 32);
    const legacy = parseGeometries({
      format_version: "1.8.0",
      "geometry.base": { texturewidth: 64, bones: [{ name: "body", cubes: [] }, { name: "arm" }] },
      "geometry.child:geometry.base": { bones: [{ name: "arm", pivot: [1, 2, 3] }] },
    });
    const child = legacy.get("geometry.child");
    assert.equal(child?.textureWidth, 64, "inherited");
    assert.deepEqual(
      child?.bones.map((b) => b.name),
      ["body", "arm"],
    );
    assert.deepEqual(child?.bones[1].pivot, [1, 2, 3], "the child's bone wins");
  });

  it("flips x and y rotations into the mirrored space", () => {
    const r = toModelRotation([90, 90, 90]);
    assert.ok(r[0] < 0 && r[1] < 0 && r[2] > 0);
  });
});

describe("jsonc", () => {
  it("drops comments and trailing commas but not strings", () => {
    const v = parseJsonc<{ a: string; b: number[]; c: string }>(
      '{ // line\n "a": "http://x/y", /* block */ "b": [1, 2,], "c": "// not a comment", }',
    );
    assert.deepEqual(v, { a: "http://x/y", b: [1, 2], c: "// not a comment" });
  });
});
