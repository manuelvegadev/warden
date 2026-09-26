// A region file's header (Anvil `.mca`, and the older `.mcr`): which of its 32×32 chunks are
// stored, how big each is, and when each was last saved. The first 8 KiB say all of it, so the
// file manager reads those with a Range request instead of the whole file (ADR-020).

/** The bytes to read: 1024 locations, then 1024 timestamps, four bytes each. */
export const REGION_HEADER_BYTES = 8192;
const SECTOR = 4096;

export interface RegionChunk {
  /** Position inside the region, 0–31. */
  x: number;
  z: number;
  present: boolean;
  /** Bytes it takes in the file (whole sectors). */
  bytes: number;
  /** When it was last saved, in ms since the epoch; 0 when the file does not say. */
  savedAt: number;
}

/** The 1024 chunks of a region, row by row (index = x + z × 32). */
export function parseRegionHeader(header: Uint8Array): RegionChunk[] {
  if (header.length < REGION_HEADER_BYTES) throw new Error("A region file starts with an 8 KiB header");
  const view = new DataView(header.buffer, header.byteOffset, REGION_HEADER_BYTES);
  const chunks: RegionChunk[] = [];
  for (let i = 0; i < 1024; i++) {
    const location = view.getUint32(i * 4);
    const offset = location >>> 8;
    const sectors = location & 0xff;
    const saved = view.getUint32(SECTOR + i * 4);
    chunks.push({
      x: i % 32,
      z: Math.floor(i / 32),
      present: offset >= 2 && sectors > 0,
      bytes: sectors * SECTOR,
      savedAt: saved * 1000,
    });
  }
  return chunks;
}

/** The region's coordinates from its name, r.<x>.<z>.mca; null for another name. */
export function regionOf(path: string): { x: number; z: number } | null {
  const m = /(?:^|\/)r\.(-?\d+)\.(-?\d+)\.mc[ar]$/.exec(path);
  return m ? { x: Number(m[1]), z: Number(m[2]) } : null;
}
