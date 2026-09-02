import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import { decodeChunk, FLAG_GRASS, FLAG_WATER, gunzip, parseBatch } from "./format";

/** Builds a payload the way the agent's ChunkEncoder.serialize does. */
export function encodePayload(opts: {
  cx: number;
  cz: number;
  yMin: number;
  yMax: number;
  palette: number[][]; // [r,g,b,flags], entry 0 = air
  biomes?: string[];
  block: (x: number, y: number, z: number) => number;
}): Uint8Array {
  const height = opts.yMax - opts.yMin + 1;
  const biomes = opts.biomes ?? ["plains"];
  const enc = new TextEncoder();
  const biomeBytes = biomes.map((b) => enc.encode(b));
  const size = 20 + opts.palette.length * 4 + biomeBytes.reduce((n, b) => n + 1 + b.length, 0) + 256 + 256 * height;
  const buf = new Uint8Array(size);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 0x314b4357, true);
  view.setInt32(4, opts.cx, true);
  view.setInt32(8, opts.cz, true);
  view.setInt16(12, opts.yMin, true);
  view.setInt16(14, opts.yMax, true);
  view.setUint16(16, opts.palette.length, true);
  buf[18] = biomes.length;
  let p = 20;
  for (const e of opts.palette) {
    buf.set(e, p);
    p += 4;
  }
  for (const b of biomeBytes) {
    buf[p++] = b.length;
    buf.set(b, p);
    p += b.length;
  }
  p += 256; // biome index 0 everywhere
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      for (let y = opts.yMin; y <= opts.yMax; y++) {
        buf[p + (x * 16 + z) * height + (y - opts.yMin)] = opts.block(x, y, z);
      }
    }
  }
  return buf;
}

export const FLAT_PALETTE = [
  [0, 0, 0, 0],
  [112, 112, 112, 0], // stone
  [127, 178, 56, FLAG_GRASS], // grass
  [64, 64, 255, FLAG_WATER], // water
];

/** Stone up to 63, grass at 64, a 2×2 water pool at (10..11, 10..11) replacing the grass. */
export const flatBlock = (x: number, y: number, z: number) => {
  if (y < 64) return 1;
  if (y === 64) return x >= 10 && x <= 11 && z >= 10 && z <= 11 ? 3 : 2;
  return 0;
};

describe("decodeChunk", () => {
  it("reads the header, palette, biomes and blocks", () => {
    const payload = encodePayload({ cx: 3, cz: -2, yMin: 56, yMax: 70, palette: FLAT_PALETTE, block: flatBlock });
    const c = decodeChunk(payload);
    assert.equal(c.cx, 3);
    assert.equal(c.cz, -2);
    assert.equal(c.yMin, 56);
    assert.equal(c.yMax, 70);
    assert.equal(c.height, 15);
    assert.equal(c.paletteLen, 4);
    assert.deepEqual(Array.from(c.palette.subarray(8, 12)), [127, 178, 56, FLAG_GRASS]);
    assert.deepEqual(c.biomeNames, ["plains"]);
    assert.equal(c.blocks.length, 256 * 15);
    // Column (10,10): grass replaced by water at 64, stone below, air above.
    const col = (10 * 16 + 10) * 15;
    assert.equal(c.blocks[col + (64 - 56)], 3);
    assert.equal(c.blocks[col + (63 - 56)], 1);
    assert.equal(c.blocks[col + (65 - 56)], 0);
  });

  it("rejects other data", () => {
    assert.throws(() => decodeChunk(new Uint8Array(40)));
    const payload = encodePayload({ cx: 0, cz: 0, yMin: 0, yMax: 1, palette: FLAT_PALETTE, block: () => 0 });
    assert.throws(() => decodeChunk(payload.subarray(0, payload.length - 10)));
  });
});

describe("parseBatch", () => {
  it("splits records and renders the hash as 16 hex digits", async () => {
    const payload = encodePayload({ cx: 1, cz: 2, yMin: 60, yMax: 64, palette: FLAT_PALETTE, block: flatBlock });
    const gz = gzipSync(payload);
    const rec = new Uint8Array(20 + gz.length);
    const v = new DataView(rec.buffer);
    v.setInt32(0, 1, true);
    v.setInt32(4, -2, true);
    v.setBigUint64(8, BigInt("0x0123456789abcdef"), true);
    v.setUint32(16, gz.length, true);
    rec.set(gz, 20);
    const two = new Uint8Array(rec.length * 2);
    two.set(rec, 0);
    two.set(rec, rec.length);
    const records = parseBatch(two.buffer);
    assert.equal(records.length, 2);
    assert.equal(records[1].cx, 1);
    assert.equal(records[1].cz, -2);
    assert.equal(records[1].hash, "0123456789abcdef");
    const inflated = await gunzip(records[0].blob);
    assert.deepEqual(decodeChunk(inflated).cx, 1);
    // A truncated tail is dropped, not thrown.
    assert.equal(parseBatch(two.buffer.slice(0, rec.length + 5)).length, 1);
  });
});
