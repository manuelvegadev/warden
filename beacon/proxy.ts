import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

// Optimistic check (cookie only): no cookie → straight to /login without rendering. The reverse
// (cookie → skip /login) is decided by the login page with the real session, because a stale
// cookie from another Beacon instance would otherwise bounce between / and /login forever.
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!getSessionCookie(req) && !pathname.startsWith("/login")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Public: the auth API, Next assets and any file path (favicons, PWA manifest, service worker, icons).
  // Page routes never contain a dot (instance ids are [a-z0-9-]).
  matcher: ["/((?!api/auth|_next/static|_next/image|.*..*).*)"],
};
