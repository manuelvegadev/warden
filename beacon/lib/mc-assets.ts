import { resolve } from "node:path";

/**
 * Where scripts/mc-assets.mjs put the game art: `MC_ASSETS_DIR`, or data/mc-assets under the
 * panel (the same data/ the SQLite database lives in; /data in the container). Server side only.
 */
export function mcAssetsDir(): string {
  return resolve(process.env.MC_ASSETS_DIR || resolve(process.cwd(), "data", "mc-assets"));
}
