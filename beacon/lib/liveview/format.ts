// The chunk format the Warden Agent produces and wardend serves (ADR-018 "WCK1"). Pure functions:
// they run in the mesher worker and in node tests alike.

// Palette flags: server-side facts the viewer cannot derive from a block name. They are hints for
// blocks missing from the colour table (mods, newer versions); known blocks take everything from it.
export const FLAG_GRASS = 1;
export const FLAG_FOLIAGE = 2;
export const FLAG_WATER = 4;
/** Solid but not a full cube (slabs, stairs, fences). Boxed for now. */
export const FLAG_PARTIAL = 16;

const MAGIC = 0x324b4357; // "WCK2"

export interface PaletteEntry {
  /** Block key ("grass_block"), what the texture colour table is looked up by. */
  name: string;
  /** The game's map colour: the fallback when the table does not know the block. */
  rgb: [number, number, number];
  flags: number;
}

export interface ChunkData {
  cx: number;
  cz: number;
  /** Lowest row sent (inclusive). Rows below are ground that was cut away. */
  yMin: number;
  /** Highest row sent (inclusive). Rows above are air. */
  yMax: number;
  height: number;
  /** One entry per palette index; entry 0 is air. */
  entries: PaletteEntry[];
  biomeNames: string[];
  /** One biome index per column, `z * 16 + x`. */
  biomes: Uint8Array;
  /** One palette index per block, `(x * 16 + z) * height + (y - yMin)`. */
  blocks: Uint8Array;
}

/** Decodes an uncompressed payload. Throws on a bad magic or a truncated buffer. */
export function decodeChunk(payload: Uint8Array): ChunkData {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  if (payload.byteLength < 20 || view.getUint32(0, true) !== MAGIC) throw new Error("not a WCK2 chunk");
  const cx = view.getInt32(4, true);
  const cz = view.getInt32(8, true);
  const yMin = view.getInt16(12, true);
  const yMax = view.getInt16(14, true);
  const paletteLen = view.getUint16(16, true);
  const biomeLen = payload[18];
  let p = 20;
  const dec = new TextDecoder();
  // A u8-length UTF-8 string, the wire's one string primitive.
  const str = () => {
    if (p >= payload.byteLength) throw new Error("truncated chunk");
    const n = payload[p++];
    if (p + n > payload.byteLength) throw new Error("truncated chunk");
    const out = dec.decode(payload.subarray(p, p + n));
    p += n;
    return out;
  };
  const entries: PaletteEntry[] = [];
  for (let i = 0; i < paletteLen; i++) {
    if (p + 4 > payload.byteLength) throw new Error("truncated chunk");
    const rgb: [number, number, number] = [payload[p], payload[p + 1], payload[p + 2]];
    const flags = payload[p + 3];
    p += 4;
    entries.push({ name: str(), rgb, flags });
  }
  const biomeNames: string[] = [];
  for (let i = 0; i < biomeLen; i++) biomeNames.push(str());
  const biomes = payload.subarray(p, p + 256);
  p += 256;
  const height = yMax - yMin + 1;
  const blocks = payload.subarray(p, p + 256 * height);
  if (blocks.byteLength !== 256 * height) throw new Error("truncated chunk");
  return { cx, cz, yMin, yMax, height, entries, biomeNames, biomes, blocks };
}

export interface ChunkRecord {
  cx: number;
  cz: number;
  /** 16 hex digits, the same value `world.chunks` messages carry. */
  hash: string;
  /** gzip payload as served: a view into the batch buffer at `offset`. */
  blob: Uint8Array;
  offset: number;
  length: number;
}

/** Splits a `POST …/chunks` response: `i32 cx · i32 cz · u64 hash · u32 len · blob` records. */
export function parseBatch(buf: ArrayBuffer): ChunkRecord[] {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const out: ChunkRecord[] = [];
  let p = 0;
  while (p + 20 <= buf.byteLength) {
    const cx = view.getInt32(p, true);
    const cz = view.getInt32(p + 4, true);
    const hash = view
      .getBigUint64(p + 8, true)
      .toString(16)
      .padStart(16, "0");
    const len = view.getUint32(p + 16, true);
    p += 20;
    if (p + len > buf.byteLength) break;
    out.push({ cx, cz, hash, blob: bytes.subarray(p, p + len), offset: p, length: len });
    p += len;
  }
  return out;
}

export const chunkKey = (cx: number, cz: number) => `${cx},${cz}`;
export const parseChunkKey = (key: string): [number, number] => {
  const i = key.indexOf(",");
  return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
};

/** Inflates a gzip blob with the browser's native decompressor. */
export async function gunzip(blob: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([blob as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
