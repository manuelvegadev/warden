// The game art Beacon serves at /liveview/mc (fetched by scripts/mc-assets.mjs), read from the browser.
import { type Geometry, parseGeometries } from "./geometry";
import { parseJsonc } from "./jsonc";

const MC_ASSETS = "/liveview/mc";

const geometryFiles = new Map<string, Promise<Map<string, Geometry>>>();

/** Every geometry of a Bedrock model file (`bedrock/models/…`), fetched once. */
export function loadGeometryFile(path: string): Promise<Map<string, Geometry>> {
  let p = geometryFiles.get(path);
  if (!p) {
    p = fetch(`${MC_ASSETS}/${path}`, { cache: "no-cache" })
      .then((res) => {
        if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => parseGeometries(parseJsonc(text)));
    p.catch(() => geometryFiles.delete(path)); // a failed fetch is tried again next time
    geometryFiles.set(path, p);
  }
  return p;
}

/** One geometry by identifier, or an error naming what is missing. */
export async function loadGeometry(path: string, id: string): Promise<Geometry> {
  const geo = (await loadGeometryFile(path)).get(id);
  if (!geo) throw new Error(`${path} has no ${id}`);
  return geo;
}
