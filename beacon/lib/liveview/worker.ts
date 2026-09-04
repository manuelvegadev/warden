// Mesher worker: owns the decoded chunks of the current world so it can cull faces against
// neighbours, and posts geometry back with transferred buffers. One instance per viewer.
import tables from "./blocks.json";
import { type ChunkData, chunkKey, decodeChunk, gunzip, parseChunkKey } from "./format";
import { type BlockTables, type MeshData, meshChunk } from "./mesher";
import type { RGB } from "./sky";

export type WorkerRequest =
  /** One transferred buffer holding every blob; each record is a view into it. */
  | {
      type: "load";
      world: string;
      buffer: ArrayBuffer;
      records: { cx: number; cz: number; hash: string; offset: number; length: number }[];
    }
  | { type: "unload"; world: string; keys: [number, number][] }
  | { type: "clear" };

export type WorkerResponse =
  | {
      type: "mesh";
      world: string;
      cx: number;
      cz: number;
      hash: string;
      mesh: MeshData;
      /** Daytime sky colour of the chunk's most common biome, for the scene's background and fog. */
      sky: RGB | null;
    }
  | { type: "error"; message: string };

const chunks = new Map<string, { data: ChunkData; hash: string }>();
let world = "";

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

/** The daytime sky of the biome that covers most of the chunk's columns. */
function skyOf(data: ChunkData): RGB | null {
  const counts = new Uint16Array(data.biomeNames.length || 1);
  for (let i = 0; i < 256; i++) counts[data.biomes[i]]++;
  let best = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i] > counts[best]) best = i;
  const sky = (tables as BlockTables).biomes[data.biomeNames[best]]?.sky;
  return sky ? [sky[0], sky[1], sky[2]] : null;
}

function emit(cx: number, cz: number) {
  const chunk = chunks.get(chunkKey(cx, cz));
  if (!chunk) return;
  const mesh = meshChunk(chunk.data, (dx, dz) => chunks.get(chunkKey(cx + dx, cz + dz))?.data, tables as BlockTables);
  post(
    { type: "mesh", world, cx, cz, hash: chunk.hash, mesh, sky: skyOf(chunk.data) },
    [mesh.opaque, mesh.trans].flatMap((p) => [
      p.positions.buffer,
      p.colors.buffer,
      p.mapShade.buffer,
      p.indices.buffer,
    ]),
  );
}

async function load(msg: Extract<WorkerRequest, { type: "load" }>) {
  if (msg.world !== world) {
    chunks.clear();
    world = msg.world;
  }
  // The blobs are independent: inflate them concurrently rather than one await at a time.
  const decoded = await Promise.all(
    msg.records.map(async (r) => {
      try {
        const data = decodeChunk(await gunzip(new Uint8Array(msg.buffer, r.offset, r.length)));
        return { r, data };
      } catch (e) {
        post({ type: "error", message: `chunk ${r.cx},${r.cz}: ${e instanceof Error ? e.message : String(e)}` });
        return null;
      }
    }),
  );
  // Mesh what arrived, then the loaded neighbours whose border faces it can now cull.
  const todo = new Set<string>();
  for (const d of decoded) {
    if (!d) continue;
    const { cx, cz } = d.r;
    chunks.set(chunkKey(cx, cz), { data: d.data, hash: d.r.hash });
    todo.add(chunkKey(cx, cz));
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      if (chunks.has(chunkKey(cx + dx, cz + dz))) todo.add(chunkKey(cx + dx, cz + dz));
    }
  }
  for (const key of todo) emit(...parseChunkKey(key));
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  switch (msg.type) {
    case "load":
      void load(msg);
      break;
    case "unload":
      if (msg.world === world) for (const [cx, cz] of msg.keys) chunks.delete(chunkKey(cx, cz));
      break;
    case "clear":
      chunks.clear();
      world = "";
      break;
  }
};
