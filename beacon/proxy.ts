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
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)).*)"],
};
