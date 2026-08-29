// Cliente tipado de la API del daemon (docs/api.md). El navegador habla directamente con mcd (ADR-007).

export const MCD_URL = process.env.NEXT_PUBLIC_MCD_URL ?? "http://localhost:8080";

export type InstanceState = "stopped" | "starting" | "running" | "stopping" | "crashed" | "installing";

export interface InstanceSummary {
  id: string;
  name: string;
  software: string;
  mcVersion: string;
  build: number;
  state: InstanceState;
  port: number;
  autostart: boolean;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function token(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem("mcd_token");
  } catch {
    return null;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init.headers as Record<string, string>) };
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(`${MCD_URL}/api/v1${path}`, { ...init, headers, cache: "no-store" });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = body?.error ?? {};
    throw new ApiError(res.status, e.code ?? "unknown", e.message ?? res.statusText);
  }
  return body as T;
}

export const instances = {
  list: () => api<InstanceSummary[]>("/instances"),
  get: (id: string) => api<{ manifest: unknown; state: InstanceState }>(`/instances/${id}`),
  start: (id: string) => api<void>(`/instances/${id}/start`, { method: "POST" }),
  stop: (id: string) => api<void>(`/instances/${id}/stop`, { method: "POST" }),
  command: (id: string, command: string) =>
    api<void>(`/instances/${id}/command`, { method: "POST", body: JSON.stringify({ command }) }),
};

export function wsUrl(): string {
  const u = new URL(MCD_URL);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/api/v1/ws";
  const t = token();
  if (t) u.searchParams.set("token", t);
  return u.toString();
}
