import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRegionHeader, REGION_HEADER_BYTES, regionOf } from "./region.ts";

function header(entries: { i: number; offset: number; sectors: number; saved: number }[]) {
  const bytes = new Uint8Array(REGION_HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  for (const e of entries) {
    view.setUint32(e.i * 4, (e.offset << 8) | e.sectors);
    view.setUint32(4096 + e.i * 4, e.saved);
  }
  return bytes;
}

test("a stored chunk has a location past the header, its size and when it was saved", () => {
  const chunks = parseRegionHeader(header([{ i: 33, offset: 2, sectors: 3, saved: 1_758_800_000 }]));
  assert.equal(chunks.length, 1024);
  assert.deepEqual(chunks[33], { x: 1, z: 1, present: true, bytes: 3 * 4096, savedAt: 1_758_800_000_000 });
  assert.equal(chunks[0].present, false);
});

test("a location pointing into the header is not a chunk", () => {
  assert.equal(parseRegionHeader(header([{ i: 5, offset: 1, sectors: 1, saved: 0 }]))[5].present, false);
});

test("a file shorter than the header is refused", () => {
  assert.throws(() => parseRegionHeader(new Uint8Array(100)));
});

test("the region's place comes from its name", () => {
  assert.deepEqual(regionOf("world/region/r.-2.5.mca"), { x: -2, z: 5 });
  assert.deepEqual(regionOf("r.0.0.mcr"), { x: 0, z: 0 });
  assert.equal(regionOf("world/region/backup.mca"), null);
});
