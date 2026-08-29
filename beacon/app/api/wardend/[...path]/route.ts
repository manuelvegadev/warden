import { NextRequest, NextResponse } from "next/server";
import { wardendFetch } from "@/lib/wardend";

// Proxy BFF: /api/wardend/<ruta> → wardend /api/v1/<ruta>. El navegador nunca recibe el JWT.
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
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
