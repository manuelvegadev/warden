// Browser-side client. Everything goes through the BFF /api/wardend (ADR-008): no tokens in JS, no CORS.

export type InstanceState = "stopped" | "starting" | "running" | "stopping" | "crashed" | "installing";

export interface InstanceStatus {
  state: InstanceState;
  pid?: number;
  startedAt?: string;
  players: string[];
  tps?: [number, number, number];
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
  netRx: number; // bytes/s, host interfaces
  netTx: number;
  tps?: [number, number, number];
}

export interface Player {
  name: string;
  firstSeen: string;
  lastSeen: string;
  playTimeSeconds: number;
  online: boolean;
}

export interface PlayerSession {
  name: string;
  joinedAt: string;
  leftAt?: string;
}

export interface ServerEvent {
  ts: string;
  kind: string;
  player?: string;
  text: string;
}

export interface ServerProperty {
  key: string;
  type: "bool" | "int" | "string" | "enum";
  default: string;
  enum?: string[];
  min?: number;
  max?: number;
  group: string;
  description: string;
  requiresRestart: boolean;
  managed?: boolean;
  common?: boolean;
  value: string;
  known: boolean;
}

export interface WhitelistEntry {
  uuid: string;
  name: string;
}

export interface OpEntry {
  uuid: string;
  name: string;
  level: number;
  bypassesPlayerLimit: boolean;
}

export interface BanEntry {
  uuid?: string;
  ip?: string;
  name?: string;
  created: string;
  source: string;
  expires: string;
  reason: string;
}

export interface UpdateInstanceInput {
  name?: string;
  memoryMb?: number;
  jvmFlagsPreset?: "aikar" | "basic" | "custom";
  jvmFlags?: string[];
  javaRuntime?: string;
  javaPath?: string;
  autostart?: boolean;
  restartPolicy?: "never" | "on-crash" | "always";
  stopTimeoutSeconds?: number;
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

type ApiInit = RequestInit & { text?: boolean };

/** Calls the BFF. JSON in/out by default; `text: true` returns the body as a string. Errors map to ApiError. */
export async function api<T>(path: string, { text, ...init }: ApiInit = {}): Promise<T> {
  const res = await fetch(`/api/wardend${path}`, {
    ...init,
    headers: { "Content-Type": text ? "text/plain" : "application/json", ...(init.headers as Record<string, string>) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const e = body?.error ?? {};
    throw new ApiError(res.status, e.code ?? "unknown", e.message ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (text ? await res.text() : await res.json()) as T;
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
  update: (id: string, input: UpdateInstanceInput) =>
    api<InstanceSummary>(`/instances/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  players: (id: string) => api<Player[]>(`/instances/${id}/players`),
  sessions: (id: string, name: string) =>
    api<PlayerSession[]>(`/instances/${id}/players/${encodeURIComponent(name)}/sessions`),
  events: (id: string, kinds: string[], limit = 100) =>
    api<ServerEvent[]>(`/instances/${id}/events?kind=${kinds.join(",")}&limit=${limit}`),
  properties: (id: string) => api<ServerProperty[]>(`/instances/${id}/properties`),
  updateProperties: (id: string, updates: Record<string, string>) =>
    api<{ restartRequired: boolean }>(`/instances/${id}/properties`, { method: "PUT", body: JSON.stringify(updates) }),
  propertiesRaw: (id: string) => api<string>(`/instances/${id}/properties/raw`, { text: true }),
  updatePropertiesRaw: (id: string, text: string) =>
    api<{ restartRequired: boolean }>(`/instances/${id}/properties/raw`, {
      method: "PUT",
      body: text,
      headers: { "Content-Type": "text/plain" },
    }),
  whitelist: (id: string) => api<WhitelistEntry[]>(`/instances/${id}/whitelist`),
  whitelistAdd: (id: string, name: string) => post<void>(`/instances/${id}/whitelist/${encodeURIComponent(name)}`),
  whitelistRemove: (id: string, name: string) =>
    api<void>(`/instances/${id}/whitelist/${encodeURIComponent(name)}`, { method: "DELETE" }),
  ops: (id: string) => api<OpEntry[]>(`/instances/${id}/ops`),
  opAdd: (id: string, name: string, level: number) =>
    post<void>(`/instances/${id}/ops/${encodeURIComponent(name)}`, { level }),
  opRemove: (id: string, name: string) =>
    api<void>(`/instances/${id}/ops/${encodeURIComponent(name)}`, { method: "DELETE" }),
  bans: (id: string) => api<{ players: BanEntry[]; ips: BanEntry[] }>(`/instances/${id}/bans`),
  ban: (id: string, target: string, reason?: string) => post<void>(`/instances/${id}/bans`, { target, reason }),
  pardon: (id: string, target: string) =>
    api<void>(`/instances/${id}/bans/${encodeURIComponent(target)}`, { method: "DELETE" }),
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

/** "paper 26.2" — used wherever an instance's software/version pair is shown. */
export const softwareLabel = (x: { software: string; mcVersion: string }) => `${x.software} ${x.mcVersion}`;
