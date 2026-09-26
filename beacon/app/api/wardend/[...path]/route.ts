import { type NextRequest, NextResponse } from "next/server";
import { wardendFetch } from "@/lib/wardend";

const FORWARDED_REQUEST = ["range", "if-range", "if-none-match", "if-modified-since"];
const FORWARDED_RESPONSE = [
  "content-disposition",
  "cache-control",
  "etag",
  "last-modified",
  "content-range",
  "accept-ranges",
  "content-length",
];

// BFF proxy: /api/wardend/<path> → wardend /api/v1/<path>. The browser never receives the JWT.
async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = `/${path.join("/")}${req.nextUrl.search}`;
  let upstream: Response;
  try {
    // Stream the body through untouched so multipart uploads (plugin jars) survive the hop.
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const headers: Record<string, string> = { "Content-Type": req.headers.get("content-type") ?? "application/json" };
    // Ranges and revalidation reach the daemon (http.ServeContent answers them): the tail of a
    // big log, Safari's <audio>, a region file's header, a 304 for an unchanged file.
    for (const h of FORWARDED_REQUEST) {
      const v = req.headers.get(h);
      if (v) headers[h] = v;
    }
    upstream = await wardendFetch(target, {
      method: req.method,
      body: hasBody ? req.body : undefined,
      headers,
      // A request the browser gives up on (a search a newer keystroke replaced) is dropped at the
      // daemon too, which cancels its calls to Hangar and Modrinth.
      signal: req.signal,
      // @ts-expect-error -- required by undici for streaming request bodies; not in the DOM lib types
      duplex: "half",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "upstream error";
    const status = msg === "unauthenticated" ? 401 : 502;
    return NextResponse.json(
      { error: { code: status === 401 ? "unauthenticated" : "wardend_unreachable", message: msg } },
      { status },
    );
  }
  const headers: Record<string, string> = {
    "Content-Type": upstream.headers.get("content-type") ?? "application/json",
  };
  for (const h of FORWARDED_RESPONSE) {
    const v = upstream.headers.get(h);
    if (v) headers[h] = v;
  }
  return new NextResponse(upstream.body, { status: upstream.status, headers });
}

export { proxy as GET, proxy as HEAD, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
