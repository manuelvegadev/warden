import { NextResponse } from "next/server";

/** The `{error:{code,message}}` envelope every Beacon route answers with; `api()` decodes it into an ApiError. */
export const jsonError = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

export const forbidden = (message: string) => jsonError(403, "forbidden", message);
export const badRequest = (message: string) => jsonError(400, "bad_request", message);
