// Browser-side client. Everything goes through the BFF /api/wardend (ADR-008): no tokens in JS, no CORS.

export type InstanceState = "stopped" | "starting" | "running" | "stopping" | "crashed" | "installing";

export interface InstanceStatus {
  state: InstanceState;
  pid?: number;
  startedAt?: string;
  players: string[];
}

export interface InstanceSummary {
  id: string;
  name: string;
  software: string;
  mcVersion: string;
  build: number;
  status: InstanceStatus;
  port: number;
  memoryMb: number;
  autostart: boolean;
}

export interface Manifest {
  id: string;
  name: string;
  software: string;
  mcVersion: string;
  build: number;
  jar: string;
  memoryMb: number;
  jvmFlagsPreset: "aikar" | "basic" | "custom";
  jvmFlags?: string[];
  javaRuntime?: string;
  javaPath?: string;
  port: number;
  rconPort: number;
  autostart: boolean;
  restartPolicy: "never" | "on-crash" | "always";
  stopTimeoutSeconds: number;
  createdAt: string;
}

export interface MetricSample {
  ts: string;
  cpu: number;
  memRss: number;
  memMax: number;
  diskUsed: number;
  players: number;
}

export interface InstanceDetail {
  manifest: Manifest;
  status: InstanceStatus;
  metrics: MetricSample | null;
}

export interface ConsoleLine {
  ts: string;
  level: "INFO" | "WARN" | "ERROR" | "FATAL" | "DEBUG" | "STDIN" | "SYSTEM";
  text: string;
}

export interface LogFile {
  name: string;
  size: number;
  modTime: string;
}

export interface Task {
  id: string;
  type: string;
  instanceId?: string;
  status: "pending" | "running" | "done" | "failed";
  progress: number;
  message: string;
  error?: string;
}

export interface Build {
  id: number;
  channel: string;
  time: string;
  name: string;
  size: number;
  sha256: string;
  changes: string[];
}

export interface JavaRuntime {
  id: string;
  vendor: "temurin" | "system";
  major: number;
  version: string;
  path: string;
  managed: boolean;
  size?: number;
  installedAt?: string;
}

export interface JavaRelease {
  major: number;
  lts: boolean;
}

export interface CreateInstanceInput {
  id: string;
  name: string;
  software: string;
  mcVersion: string;
  build?: number;
  memoryMb: number;
  jvmFlagsPreset: "aikar" | "basic";
  javaRuntime?: string; // "auto" | runtime id
  port: number;
  autostart: boolean;
  restartPolicy: "never" | "on-crash" | "always";
  acceptEula: boolean;
  properties?: Record<string, string>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
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

const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const instances = {
  list: () => api<InstanceSummary[]>("/instances"),
  get: (id: string) => api<InstanceDetail>(`/instances/${id}`),
  create: (input: CreateInstanceInput) => post<{ instance: InstanceSummary; task: Task }>("/instances", input),
  install: (id: string, acceptEula: boolean) =>
    post<{ task: Task }>(`/instances/${id}/install`, { AcceptEULA: acceptEula }),
  remove: (id: string) => api<void>(`/instances/${id}`, { method: "DELETE" }),
  start: (id: string) => post<void>(`/instances/${id}/start`),
  stop: (id: string) => post<void>(`/instances/${id}/stop`),
  restart: (id: string) => post<void>(`/instances/${id}/restart`),
  kill: (id: string) => post<void>(`/instances/${id}/kill`),
  command: (id: string, command: string) => post<void>(`/instances/${id}/command`, { command }),
  console: (id: string, lines = 500) => api<ConsoleLine[]>(`/instances/${id}/console?lines=${lines}`),
  metrics: (id: string, range = "1h") => api<MetricSample[]>(`/instances/${id}/metrics?range=${range}`),
  acceptEula: (id: string) => post<void>(`/instances/${id}/eula`, { accept: true }),
  logs: (id: string) => api<LogFile[]>(`/instances/${id}/logs`),
  logTail: (id: string, file: string, tail: number) =>
    api<{ file: string; lines: string[] }>(`/instances/${id}/logs/${encodeURIComponent(file)}?tail=${tail}`),
  logDownloadUrl: (id: string, file: string) =>
    `/api/wardend/instances/${id}/logs/${encodeURIComponent(file)}?download=1`,
};

export const catalog = {
  versions: (provider = "paper") =>
    api<{ versions: string[]; latest: string }>(`/catalog/servers/${provider}/versions`),
  builds: (provider: string, mc: string) =>
    api<Build[]>(`/catalog/servers/${provider}/versions/${mc}/builds?channel=STABLE`),
};

export const java = {
  list: () => api<{ installed: JavaRuntime[]; available?: JavaRelease[]; availableError?: string }>("/java"),
  required: (mc: string) =>
    api<{ mcVersion: string; requiredMajor: number; runtime?: JavaRuntime }>(
      `/java/required?mc=${encodeURIComponent(mc)}`,
    ),
  install: (major: number) => post<{ task: Task }>("/java", { major }),
  remove: (id: string) => api<void>(`/java/${id}`, { method: "DELETE" }),
};

export const tasks = {
  get: (id: string) => api<Task>(`/tasks/${id}`),
};

/** wardend WebSocket URL. The JWT is sent as the first message (see useWardendSocket), never in the URL. */
export function wardendWsUrl(): string {
  const base = process.env.NEXT_PUBLIC_WARDEND_WS_URL ?? "ws://localhost:8080";
  return `${base.replace(/\/$/, "")}/api/v1/ws`;
}

export const formatBytes = (n: number) => {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i >= 2 ? 1 : 0)} ${u[i]}`;
};
