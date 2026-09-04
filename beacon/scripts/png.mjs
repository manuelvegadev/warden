// PNG, enough of the format for Minecraft's textures: reading 8-bit RGB/RGBA/gray and palettes of
// any depth (no interlacing), and writing RGBA. Shared by the asset scripts; no dependencies.
import { readFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

/** Decodes a PNG file into `{ w, h, data }`, RGBA bytes row by row from the top. */
export function png(path) {
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
        // A tRNS chunk on truecolor names one colour as fully transparent.
        const r = sample(x * 3);
        const g = sample(x * 3 + 1);
        const bl = sample(x * 3 + 2);
        const keyed = trns && r === trns.readUInt16BE(0) && g === trns.readUInt16BE(2) && bl === trns.readUInt16BE(4);
        out.set([r, g, bl, keyed ? 0 : 255], o);
      } else if (type === 0) {
        // Greyscale likewise: the grass block's side overlay is drawn this way.
        const raw = sample(x);
        const g = depth < 8 ? Math.round((raw * 255) / ((1 << depth) - 1)) : raw;
        out.set([g, g, g, trns && raw === trns.readUInt16BE(0) ? 0 : 255], o);
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

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(kind, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(kind, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encodes RGBA bytes (rows from the top) as an 8-bit RGBA PNG. */
export function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
