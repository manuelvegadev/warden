import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { NextResponse } from "next/server";
import { mcAssetsDir } from "@/lib/mc-assets";
import { getSession } from "@/lib/session";

/** What the live view fetches from the tree; anything else is not served. */
const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".json": "application/json",
  ".mcmeta": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * The game art fetched by scripts/mc-assets.mjs (ADR-018): /liveview/mc/<path> is
 * `$MC_ASSETS_DIR/<path>`, for signed-in users, cached for a day. Not a static route on purpose:
 * the tree is Mojang's and lives outside the image and the repository.
 */
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  if (!(await getSession())) return new NextResponse(null, { status: 401 });
  const { path } = await ctx.params;
  const root = mcAssetsDir();
  const file = resolve(root, ...path);
  const type = TYPES[extname(file)];
  if (!type || !file.startsWith(root + sep)) return new NextResponse(null, { status: 404 });
  try {
    // Derived files change when the art is fetched again: the viewer revalidates, and a match is a 304.
    const info = await stat(file);
    const etag = `"${info.size}-${Math.round(info.mtimeMs)}"`;
    const headers = { ETag: etag, "Cache-Control": "private, max-age=86400" };
    if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
    const body = await readFile(file);
    return new NextResponse(body, { headers: { ...headers, "Content-Type": type } });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
