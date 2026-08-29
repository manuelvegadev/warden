// Cliente del navegador. Todo pasa por el BFF /api/wardend (ADR-008): sin tokens en JS ni CORS.

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

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/wardend${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers as Record<string, string>) },
  });
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

/** URL del WebSocket de wardend. El JWT se envía como primer mensaje (ver useWardendSocket), nunca en la URL. */
export function wardendWsUrl(): string {
  const base = process.env.NEXT_PUBLIC_WARDEND_WS_URL ?? "ws://localhost:8080";
  return `${base.replace(/\/$/, "")}/api/v1/ws`;
}
