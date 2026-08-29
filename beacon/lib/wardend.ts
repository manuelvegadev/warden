import "server-only";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

// Server-to-server client for wardend (BFF, ADR-008/009): user JWT + panel key.
export const WARDEND_URL = (process.env.WARDEND_URL ?? "http://localhost:8080").replace(/\/$/, "");

export async function wardendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const h = await headers();
  const { token } = await auth.api.getToken({ headers: h });
  if (!token) throw new Error("unauthenticated");
  const reqHeaders = new Headers(init.headers);
  reqHeaders.set("Authorization", `Bearer ${token}`);
  if (process.env.WARDEND_PANEL_KEY) reqHeaders.set("X-Panel-Key", process.env.WARDEND_PANEL_KEY);
  if (!reqHeaders.has("Content-Type") && init.body) reqHeaders.set("Content-Type", "application/json");
  return fetch(`${WARDEND_URL}/api/v1${path}`, { ...init, headers: reqHeaders, cache: "no-store" });
}
