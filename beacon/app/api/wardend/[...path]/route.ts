import { NextRequest, NextResponse } from "next/server";
import { wardendFetch } from "@/lib/wardend";

// BFF proxy: /api/wardend/<path> → wardend /api/v1/<path>. The browser never receives the JWT.
async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = `/${path.join("/")}${req.nextUrl.search}`;
  let upstream: Response;
  try {
    upstream = await wardendFetch(target, {
      method: req.method,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
      headers: { "Content-Type": req.headers.get("content-type") ?? "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "upstream error";
    const status = msg === "unauthenticated" ? 401 : 502;
    return NextResponse.json({ error: { code: status === 401 ? "unauthenticated" : "wardend_unreachable", message: msg } }, { status });
  }
  const headers: Record<string, string> = { "Content-Type": upstream.headers.get("content-type") ?? "application/json" };
  const disposition = upstream.headers.get("content-disposition");
  if (disposition) headers["Content-Disposition"] = disposition;
  return new NextResponse(upstream.body, { status: upstream.status, headers });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
