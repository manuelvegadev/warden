import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { safeNext } from "@/lib/http";

// Development only: GET /api/dev/login?email=&password=&next= signs in on the server and lands on
// `next`, so a link or a QR code opens the panel on a phone without typing — and without depending
// on the client bundle having loaded (the dev server serves chunks on demand). A production build
// answers 404: credentials in a URL end up in logs and history.

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV !== "development") return new NextResponse(null, { status: 404 });
  const email = req.nextUrl.searchParams.get("email") ?? "";
  const password = req.nextUrl.searchParams.get("password") ?? "";
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  let signed: Response;
  try {
    signed = await auth.api.signInEmail({ body: { email, password }, headers: req.headers, asResponse: true });
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : "sign-in failed", { status: 401 });
  }
  if (!signed.ok) return new NextResponse(await signed.text(), { status: signed.status });
  // The session cookies travel on the redirect; the browser lands on `next` signed in.
  // The origin the browser used (a LAN address, say), not the one the server is configured with.
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const res = NextResponse.redirect(new URL(next, `${req.nextUrl.protocol}//${host}`), 303);
  for (const cookie of signed.headers.getSetCookie()) res.headers.append("set-cookie", cookie);
  return res;
}
