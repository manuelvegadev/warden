// Mesher worker: owns the decoded chunks of the current world so it can cull faces against
// neighbours, and posts geometry back with transferred buffers. One instance per viewer.
import blocks from "./blocks.json";
import { type ChunkData, chunkKey, decodeChunk, gunzip, parseChunkKey } from "./format";
import { type BlockTables, type FaceTable, forgetResolved, type LeavesMode, type MeshData, meshChunk } from "./mesher";
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
  | { type: "clear" }
  /** The block textures arrived, changed or were switched off (null): every loaded chunk is meshed again. */
  | { type: "textures"; faces: FaceTable | null }
  /** The leaves setting changed: likewise. */
  | { type: "leaves"; mode: LeavesMode };

export interface ChunkMesh {
  world: string;
  cx: number;
  cz: number;
  hash: string;
  mesh: MeshData;
  /** Daytime sky colour of the chunk's most common biome, for the scene's background and fog. */
  sky: RGB | null;
}

export type WorkerResponse =
  /** Meshed chunks, handed over together so the scene swaps them in one go after a setting changed. */
  { type: "meshes"; items: ChunkMesh[] } | { type: "error"; message: string };

const chunks = new Map<string, { data: ChunkData; hash: string }>();
let world = "";
const tables: BlockTables = { ...(blocks as BlockTables) };

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

/** The daytime sky of the biome that covers most of the chunk's columns. */
function skyOf(data: ChunkData): RGB | null {
  const counts = new Uint16Array(data.biomeNames.length || 1);
  for (let i = 0; i < 256; i++) counts[data.biomes[i]]++;
  let best = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i] > counts[best]) best = i;
  const sky = tables.biomes[data.biomeNames[best]]?.sky;
  return sky ? [sky[0], sky[1], sky[2]] : null;
}

function build(cx: number, cz: number): ChunkMesh | null {
  const chunk = chunks.get(chunkKey(cx, cz));
  if (!chunk) return null;
  const mesh = meshChunk(chunk.data, (dx, dz) => chunks.get(chunkKey(cx + dx, cz + dz))?.data, tables);
  return { world, cx, cz, hash: chunk.hash, mesh, sky: skyOf(chunk.data) };
}

/** Every buffer of a mesh, so the whole thing moves to the main thread rather than being copied. */
const buffersOf = (item: ChunkMesh) =>
  [item.mesh.opaque, item.mesh.trans].flatMap((p) => Object.values(p).map((a) => a.buffer));

function emit(items: ChunkMesh[]) {
  post({ type: "meshes", items }, items.flatMap(buffersOf));
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
  const meshed: ChunkMesh[] = [];
  for (const key of todo) {
    const item = build(...parseChunkKey(key));
    if (item) meshed.push(item);
  }
  emit(meshed);
}

/**
 * The tables changed: every loaded chunk is meshed again and handed over in one message, so the
 * view changes at once rather than chunk by chunk. Changes arriving together (the textures and the
 * leaves setting at start) share one pass.
 */
let remeshTimer: ReturnType<typeof setTimeout> | undefined;
function remesh() {
  if (remeshTimer !== undefined) return;
  remeshTimer = setTimeout(() => {
    remeshTimer = undefined;
    forgetResolved();
    const items: ChunkMesh[] = [];
    for (const key of chunks.keys()) {
      const item = build(...parseChunkKey(key));
      if (item) items.push(item);
    }
    emit(items);
  }, 0);
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
    case "textures":
      tables.faces = msg.faces ?? undefined;
      remesh();
      break;
    case "leaves":
      tables.leaves = msg.mode;
      remesh();
      break;
  }
};
