import { NextResponse } from "next/server";

/** The `{error:{code,message}}` envelope every Beacon route answers with; `api()` decodes it into an ApiError. */
export const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

export const forbidden = (message: string) => jsonError(403, "forbidden", message);
export const badRequest = (message: string) => jsonError(400, "bad_request", message);

/** Only same-origin relative paths are valid post-login targets (no open redirect). */
export const safeNext = (v: string | null | undefined) => (v?.startsWith("/") && !v.startsWith("//") ? v : "/");
