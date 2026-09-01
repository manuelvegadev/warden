import "server-only";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { InstanceDetail, InstanceSummary } from "@/lib/api";
import { auth } from "@/lib/auth";

// Server-to-server client for wardend (BFF, ADR-008/009): user JWT + panel key.
export const WARDEND_URL = (process.env.WARDEND_URL ?? "http://localhost:8080").replace(/\/$/, "");

/** WebSocket URL the browser connects to; read per request so one image serves every deployment. */
export const publicWsUrl = () =>
  (process.env.WARDEND_PUBLIC_WS_URL ?? process.env.NEXT_PUBLIC_WARDEND_WS_URL ?? "ws://localhost:8080").replace(
    /\/$/,
    "",
  );

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

/** The instances the caller may see. A daemon outage returns an empty list rather than a broken page. */
export async function loadInstances(): Promise<InstanceSummary[]> {
  return wardendFetch("/instances")
    .then((r) => (r.ok ? (r.json() as Promise<InstanceSummary[]>) : []))
    .catch(() => []);
}

/** Instance detail for a page or layout: 404s the route when the instance does not exist. */
export async function loadInstanceDetail(id: string): Promise<InstanceDetail> {
  const res = await wardendFetch(`/instances/${id}`);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`wardend returned ${res.status}`);
  return res.json() as Promise<InstanceDetail>;
}
