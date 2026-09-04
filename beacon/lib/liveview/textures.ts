// The block textures the terrain is drawn with: the strip scripts/mc-atlas.mjs built from the
// fetched game art, uploaded as a texture array (one 16×16 layer per block face, so tiles never
// bleed into each other at any mip level), and the table saying which layer each block's faces use.
import { DataArrayTexture, LinearMipmapLinearFilter, NearestFilter, RGBAFormat } from "three";
import type { FaceTable } from "./mesher";

const ATLAS = "/liveview/mc/derived/blocks";

export interface BlockTextures {
  texture: DataArrayTexture;
  faces: FaceTable;
}

/** A one-layer white array, what the terrain samples until the real tiles arrive (or when they never do). */
export function whiteTiles(): DataArrayTexture {
  const t = new DataArrayTexture(new Uint8Array(4).fill(255), 1, 1, 1);
  t.format = RGBAFormat;
  t.needsUpdate = true;
  return t;
}

/** Fetches the strip and the table; null when the art has not been fetched on the server. */
export async function loadBlockTextures(): Promise<BlockTextures | null> {
  // Revalidated every time (a 304 when unchanged): the strip is rebuilt whenever the art is fetched again.
  const [meta, image] = await Promise.all([
    fetch(`${ATLAS}.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)),
    fetch(`${ATLAS}.png`, { cache: "no-cache" }).then((r) => (r.ok ? r.blob() : null)),
  ]);
  if (!meta || !image) return null;
  const { tile, tiles, blocks } = meta as { tile: number; tiles: number; blocks: FaceTable };
  const bitmap = await createImageBitmap(image, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const canvas = new OffscreenCanvas(tile, tile * tiles);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = new Uint8Array(ctx.getImageData(0, 0, tile, tile * tiles).data.buffer);
  const texture = new DataArrayTexture(data, tile, tile, tiles);
  texture.format = RGBAFormat;
  texture.magFilter = NearestFilter; // the game's pixels, up close
  texture.minFilter = LinearMipmapLinearFilter; // and no shimmer far away
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return { texture, faces: blocks };
}
