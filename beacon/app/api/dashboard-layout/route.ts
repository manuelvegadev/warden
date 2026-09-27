import { type NextRequest, NextResponse } from "next/server";
import { defaultLayout, MAX_LAYOUT_BYTES } from "@/lib/dashboard-layout";
import { deleteLayout, getLayout, parseLayoutBody, saveLayout } from "@/lib/dashboard-layout-store";
import { getDb } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { getSession } from "@/lib/session";

// The signed-in user's Overview dashboard layout (ADR-026), the same on every instance. Each user
// reads and writes their own row; no instance role is involved.

const unauthorized = () => jsonError(401, "unauthorized", "Sign in first");

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();
  const layout = getLayout(getDb(), session.user.id);
  return NextResponse.json(layout ? { layout, isDefault: false } : { layout: defaultLayout(), isDefault: true });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();
  // The header is checked before the body is read at all: a large upload should not be buffered into
  // memory just to be refused. It can be absent, or lie, so `parseLayoutBody`'s own byte count (on
  // the body actually received) still runs below and is the one that is trusted.
  const contentLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_LAYOUT_BYTES) {
    return jsonError(413, "too_large", `A layout is at most ${MAX_LAYOUT_BYTES / 1024} KB`);
  }
  const parsed = parseLayoutBody(await req.text());
  if ("status" in parsed)
    return jsonError(parsed.status, parsed.status === 413 ? "too_large" : "bad_request", parsed.message);
  saveLayout(getDb(), session.user.id, parsed.layout);
  return NextResponse.json({ layout: parsed.layout });
}

export async function DELETE() {
  const session = await getSession();
  if (!session) return unauthorized();
  deleteLayout(getDb(), session.user.id);
  return NextResponse.json({ layout: defaultLayout(), isDefault: true });
}
