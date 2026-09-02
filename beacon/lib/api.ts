import type { badgeTone } from "@warden/ui/lib/badge-tone";
import { formatDate } from "@/lib/utils";

// Browser-side client. Everything goes through the BFF /api/wardend (ADR-008): no tokens in JS, no CORS.

export type InstanceState = "stopped" | "starting" | "running" | "stopping" | "crashed" | "installing";
/** No server process exists: file-replacing operations (install, upgrade) are allowed. */
export const isStopped = (s: InstanceState) => s === "stopped" || s === "crashed";

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
  /** Completed server upgrades, newest last. */
  upgrades?: UpgradeRecord[];
  backups: BackupSettings;
  /** Live world view (ADR-018); absent until it was enabled once. */
  liveView?: { enabled: boolean };
}

/** One player's last reported position, from the Warden Agent (ADR-018). */
export interface PlayerPos {
  uuid: string;
  name: string;
  world: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  sneaking: boolean;
  sprinting: boolean;
  gamemode: string;
  vanished: boolean;
}

export interface LiveViewWorld {
  name: string;
  dimension: string;
  viewDistance: number;
  minY: number;
  maxY: number;
  /** Chunks wardend holds for this world. */
  chunks: number;
}

export interface LiveViewInfo {
  enabled: boolean;
  /** Paper-family software only: the agent is a Bukkit plugin. */
  supported: boolean;
  agent: { connected: boolean; version?: string; server?: string };
  worlds: LiveViewWorld[];
  players: PlayerPos[];
  /** Millis of the last positions message. */
  t?: number;
}

export interface BackupSettings {
  enabled: boolean;
  everyHours: number;
  keep: number;
  maxTotalMb: number;
  scope: "full" | "worlds";
}

export interface BackupInfo {
  name: string;
  trigger: "manual" | "schedule" | "pre-upgrade" | "pre-restore" | "unknown";
  scope: string;
  size: number;
  sha256?: string;
  paths?: string[];
  mcVersion?: string;
  build?: number;
  createdAt: string;
}

export interface UpgradeRecord {
  fromVersion: string;
  fromBuild: number;
  toVersion: string;
  toBuild: number;
  backup: string;
  at: string;
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

export interface Counter {
  id: string;
  count: number;
}

export type TopCategory = "mined" | "killed" | "killed_by" | "crafted" | "used" | "broken" | "picked_up";

export interface PlayerStats {
  dataVersion: number;
  playTimeSeconds: number;
  deaths: number;
  playerKills: number;
  mobKills: number;
  damageDealt: number;
  damageTaken: number;
  jumps: number;
  distanceMeters: number;
  blocksMined: number;
  itemsCrafted: number;
  top: Record<TopCategory, Counter[]>;
}

export interface Advancement {
  id: string;
  done: boolean;
  at?: string;
}

/** Transient console actions; op/ban use the list endpoints so they also work while stopped. */
export type PlayerActionKind = "message" | "kick";

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

export interface PluginHit {
  source: "hangar" | "modrinth";
  /** Repository link, when the project publishes one. */
  sourceUrl?: string;
  /** Project README in Markdown; only present on the details endpoint. */
  body?: string;
  id: string;
  name: string;
  author: string;
  description: string;
  iconUrl?: string;
  downloads: number;
  categories: string[];
  url: string;
}

export interface PluginVersion {
  id: string;
  name: string;
  channel: string;
  mcVersions: string[];
  fileName: string;
  size: number;
  hash: { algo: string; value: string };
  url: string;
  dependencies: { name: string; required: boolean }[] | null;
  publishedAt: string;
}

export interface InstalledPluginRecord {
  fileName: string;
  source: string;
  projectId?: string;
  name?: string;
  versionId?: string;
  version?: string;
  installedAt: string;
}

export interface PluginMeta {
  name: string;
  version: string;
  description?: string;
  authors?: string[];
  apiVersion?: string;
}

export interface PluginFile {
  fileName: string;
  enabled: boolean;
  size: number;
  /** Parsed from plugin.yml / paper-plugin.yml inside the jar. */
  meta?: PluginMeta;
  /** wardend API path of the icon fetched at install time (served through the BFF). */
  iconUrl?: string;
  source?: InstalledPluginRecord;
}

/** A newer compatible catalog release for an installed jar. */
export interface PluginUpdate {
  fileName: string;
  version: string;
  versionId: string;
}

export interface LaunchCommand {
  java: string;
  javaError?: string;
  args: string[];
  cwd: string;
  /** java + args quoted for a POSIX shell, ready to paste. */
  shell: string;
}

export interface UpgradeTarget {
  mcVersion: string;
  build: number;
  channel?: string;
  time?: string;
  changes?: string[];
}

export interface UpgradeCheck {
  current: UpgradeTarget;
  /** Newer build of the same Minecraft version. */
  latestBuild?: UpgradeTarget;
  /** Newest Minecraft version that has a build. */
  latestVersion?: UpgradeTarget;
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
  backups?: BackupSettings;
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

export type TaskType =
  | "install"
  | "import"
  | "daemon.update"
  | "upgrade"
  | "backup"
  | "restore"
  | "plugin.install"
  | "java.install";

export const TASK_LABELS: Record<TaskType, string> = {
  install: "Server install",
  import: "Server import",
  "daemon.update": "wardend update",
  upgrade: "Server upgrade",
  backup: "Backup",
  restore: "Restore",
  "plugin.install": "Plugin install",
  "java.install": "Java install",
};
export const taskLabel = (type: string) => TASK_LABELS[type as TaskType] ?? type;

export interface Task {
  id: string;
  type: TaskType;
  instanceId?: string;
  status: "pending" | "running" | "done" | "failed";
  progress: number;
  message: string;
  error?: string;
}

export interface VersionList {
  versions: string[];
  latest: string;
}

export interface Build {
  id: number;
  channel: string;
  time: string;
  name: string;
  size: number;
  hash: { algo: string; value: string };
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

/** Form fields of `instances.import`; software/mcVersion only matter when the archive has no server jar. */
export interface ImportInstanceInput {
  id: string;
  name: string;
  memoryMb: number;
  port: number;
  jvmFlagsPreset: "aikar" | "basic";
  javaRuntime?: string;
  acceptEula: boolean;
  software?: string;
  mcVersion?: string;
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

type ApiInit = RequestInit & {
  text?: boolean;
  /** The response is bytes (an ArrayBuffer), not JSON. */
  binary?: boolean;
  /** Absolute Beacon path; skips the /api/wardend prefix. */
  own?: boolean;
};

/**
 * Calls the BFF. JSON in/out by default; `text: true` returns the body as a string, `binary: true` as
 * an ArrayBuffer. Errors map to ApiError.
 */
export async function api<T>(path: string, { text, binary, own, ...init }: ApiInit = {}): Promise<T> {
  // FormData bodies set their own multipart Content-Type (with boundary); never override it.
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", text ? "text/plain" : "application/json");
  }
  const res = await fetch(own ? path : `/api/wardend${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const e = body?.error ?? {};
    throw new ApiError(res.status, e.code ?? "unknown", e.message ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  if (binary) return (await res.arrayBuffer()) as T;
  return (text ? await res.text() : await res.json()) as T;
}

const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const instances = {
  list: () => api<InstanceSummary[]>("/instances"),
  /** Live world view (ADR-018). */
  map: (id: string) => api<LiveViewInfo>(`/instances/${id}/map`),
  setLiveView: (id: string, enabled: boolean) =>
    api<{ enabled: boolean; restartRequired: boolean }>(`/instances/${id}/map`, {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),
  /** Stored chunks among `keys`, as the binary batch `lib/liveview/format.ts` parses. */
  mapChunks: (id: string, world: string, keys: [number, number][]) =>
    api<ArrayBuffer>(`/instances/${id}/map/${encodeURIComponent(world)}/chunks`, {
      method: "POST",
      body: JSON.stringify({ chunks: keys }),
      binary: true,
    }),
  get: (id: string) => api<InstanceDetail>(`/instances/${id}`),
  create: (input: CreateInstanceInput) => post<{ instance: InstanceSummary; task: Task }>("/instances", input),
  /**
   * Creates an instance from an uploaded server directory archive. XHR rather than fetch so the
   * upload progress (bytes sent) can be shown; the daemon answers 202 with the import task.
   */
  import: (input: ImportInstanceInput, file: File, onProgress?: (sent: number, total: number) => void) =>
    new Promise<{ instance: InstanceSummary; task: Task }>((resolve, reject) => {
      const body = new FormData();
      // Text fields go first: the daemon needs them before it starts streaming the file to disk.
      for (const [k, v] of Object.entries(input)) if (v !== undefined && v !== "") body.append(k, String(v));
      body.append("file", file, file.name);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/wardend/instances/import");
      xhr.upload.onprogress = (e) => onProgress?.(e.loaded, e.lengthComputable ? e.total : file.size);
      xhr.onerror = () => reject(new ApiError(0, "network", "Upload failed"));
      xhr.onload = () => {
        let json: { instance?: InstanceSummary; task?: Task; error?: { code: string; message: string } } = {};
        try {
          json = JSON.parse(xhr.responseText);
        } catch {
          /* non-JSON error page */
        }
        if (xhr.status >= 200 && xhr.status < 300 && json.instance && json.task) {
          resolve({ instance: json.instance, task: json.task });
        } else {
          reject(new ApiError(xhr.status, json.error?.code ?? "unknown", json.error?.message ?? xhr.statusText));
        }
      };
      xhr.send(body);
    }),
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
  playerStats: (id: string, name: string) =>
    api<PlayerStats>(`/instances/${id}/players/${encodeURIComponent(name)}/stats`),
  playerAdvancements: (id: string, name: string) =>
    api<Advancement[]>(`/instances/${id}/players/${encodeURIComponent(name)}/advancements`),
  playerAction: (id: string, name: string, action: PlayerActionKind, text?: string) =>
    post<void>(`/instances/${id}/players/${encodeURIComponent(name)}/action`, { action, text }),
  properties: (id: string) => api<ServerProperty[]>(`/instances/${id}/properties`),
  updateProperties: (id: string, updates: Record<string, string>) =>
    api<{ restartRequired: boolean }>(`/instances/${id}/properties`, { method: "PUT", body: JSON.stringify(updates) }),
  /** server-icon.png. The URL is served by the BFF, so an <img> can point straight at it. */
  serverIconUrl: (id: string) => `/api/wardend/instances/${id}/icon`,
  setServerIcon: (id: string, png: Blob) =>
    api<{ restartRequired: boolean }>(`/instances/${id}/icon`, {
      method: "PUT",
      body: png,
      headers: { "Content-Type": "image/png" },
    }),
  removeServerIcon: (id: string) => api<{ restartRequired: boolean }>(`/instances/${id}/icon`, { method: "DELETE" }),
  launchCommand: (id: string) => api<LaunchCommand>(`/instances/${id}/command`),
  upgradeCheck: (id: string) => api<UpgradeCheck>(`/instances/${id}/upgrade`),
  upgrade: (id: string, target: { mcVersion?: string; build?: number }) =>
    post<{ task: Task }>(`/instances/${id}/upgrade`, target),
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

export interface ConfigFile {
  /** Slash-separated path relative to the server directory. */
  path: string;
  group: string;
  size: number;
  modifiedAt: string;
}

/** Allowlisted configuration files (Paper/Bukkit YAML, per-world configs, plugin data folders). */
const fileContent = (instanceId: string, path: string) =>
  `/instances/${instanceId}/files/content?path=${encodeURIComponent(path)}`;

export const backups = {
  list: (instanceId: string) => api<BackupInfo[]>(`/instances/${instanceId}/backups`),
  create: (instanceId: string) => post<{ task: Task }>(`/instances/${instanceId}/backups`),
  restore: (instanceId: string, name: string) =>
    post<{ task: Task }>(`/instances/${instanceId}/backups/${encodeURIComponent(name)}/restore`),
  remove: (instanceId: string, name: string) =>
    api<void>(`/instances/${instanceId}/backups/${encodeURIComponent(name)}`, { method: "DELETE" }),
  downloadUrl: (instanceId: string, name: string) =>
    `/api/wardend/instances/${instanceId}/backups/${encodeURIComponent(name)}/download`,
};

export const files = {
  list: (instanceId: string) => api<ConfigFile[]>(`/instances/${instanceId}/files`),
  read: (instanceId: string, path: string) => api<string>(fileContent(instanceId, path), { text: true }),
  write: (instanceId: string, path: string, content: string) =>
    api<{ restartRequired: boolean }>(fileContent(instanceId, path), {
      method: "PUT",
      body: content,
      headers: { "Content-Type": "text/plain" },
    }),
};

export const plugins = {
  search: (q: string, mc: string, source: string) =>
    api<{ hits: PluginHit[]; total: number }>(
      `/catalog/plugins/search?q=${encodeURIComponent(q)}&mc=${encodeURIComponent(mc)}&source=${source}`,
    ),
  get: (source: string, id: string) => api<PluginHit>(`/catalog/plugins/${source}/${encodeURIComponent(id)}`),
  versions: (source: string, id: string, mc: string) =>
    api<PluginVersion[]>(`/catalog/plugins/${source}/${encodeURIComponent(id)}/versions?mc=${encodeURIComponent(mc)}`),
  installed: (instanceId: string) => api<PluginFile[]>(`/instances/${instanceId}/plugins`),
  /** Newer releases for catalog-installed plugins; slower (asks the catalog), so fetched separately. */
  updates: (instanceId: string) => api<PluginUpdate[]>(`/instances/${instanceId}/plugins/updates`),
  toggle: (instanceId: string, fileName: string) =>
    post<{ enabled: boolean }>(`/instances/${instanceId}/plugins/${encodeURIComponent(fileName)}/toggle`),
  update: (instanceId: string, fileName: string) =>
    post<{ task: Task }>(`/instances/${instanceId}/plugins/${encodeURIComponent(fileName)}/update`),
  remove: (instanceId: string, fileName: string) =>
    api<void>(`/instances/${instanceId}/plugins/${encodeURIComponent(fileName)}`, { method: "DELETE" }),
  /** Uploads a plugin jar, or a zip bundle whose plugin jars get extracted. */
  upload: (instanceId: string, file: File) => {
    const body = new FormData();
    body.append("file", file, file.name);
    return api<{ plugins: PluginFile[] }>(`/instances/${instanceId}/plugins/upload`, { method: "POST", body });
  },
  /** Maps a wardend API path (as returned in `iconUrl`) to the BFF proxy. */
  proxied: (apiPath: string) => apiPath.replace(/^\/api\/v1/, "/api/wardend"),
  install: (instanceId: string, source: string, projectId: string, versionId: string) =>
    post<{ task: Task }>(`/instances/${instanceId}/plugins`, { source, projectId, versionId }),
};

/** Player skin images served by wardend (Mojang lookup, cached on the daemon). */
export const skins = {
  face: (name: string) => `/api/wardend/players/${encodeURIComponent(name)}/skin?face=64`,
  full: (name: string) => `/api/wardend/players/${encodeURIComponent(name)}/skin`,
};

export const catalog = {
  versions: (provider = DEFAULT_SOFTWARE) => api<VersionList>(`/catalog/servers/${provider}/versions`),
  builds: (provider: string, mc: string) =>
    api<Build[]>(`/catalog/servers/${provider}/versions/${mc}/builds?channel=STABLE`),
};

export interface SystemInfo {
  hostname: string;
  os: string; // "linux/amd64"
  platform?: string; // "ubuntu 26.04"
  kernel?: string;
  cpuCores: number;
  cpuPercent?: number;
  load?: [number, number, number];
  memTotal?: number;
  memUsed?: number;
  hostUptime?: number; // seconds
  disk?: { path: string; total: number; used: number };
  daemonVersion: string;
  goVersion: string;
  startedAt: string;
}

/** GET /system/update: newest GitHub release vs the running daemon. */
export interface UpdateInfo {
  current: string;
  latest?: string;
  publishedAt?: string;
  url?: string;
  available: boolean;
  canApply: boolean;
  error?: string;
}

export const system = {
  get: () => api<SystemInfo>("/system"),
  update: () => api<UpdateInfo>("/system/update"),
  /** Stages the newest release; the daemon's root helper installs it and restarts wardend. */
  applyUpdate: () => post<{ task: Task }>("/system/update"),
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
  /** Tasks of one instance, newest first (the WebSocket only streams tasks started after subscribing). */
  ofInstance: (instanceId: string) => api<Task[]>(`/tasks?instance=${encodeURIComponent(instanceId)}`),
};

/** 1234 → "1K", 2_800_000 → "2.8M". */
export const compactNum = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);

export const formatBytes = (n: number) => {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i >= 2 ? 1 : 0)} ${u[i]}`;
};

/**
 * Presentation facts per server software (ids match wardend's providers). `plugins` = loads
 * Bukkit/Paper plugins (Plugins tab); `builds` = false when a version has a single build;
 * `buildOf` names a build in pickers.
 */
export interface Software {
  label: string;
  description: string;
  /** Badge tone that identifies the software across the panel. */
  tone: keyof typeof badgeTone;
  plugins: boolean;
  builds: boolean;
  buildLabel: string;
  buildOf: (b: Build) => string;
}
const numberedBuild = (b: Build) => `#${b.id} · ${b.channel.toLowerCase()} · ${formatDate(b.time)}`;
export const SOFTWARE: Record<string, Software> = {
  paper: {
    label: "Paper",
    tone: "blue",
    description: "High-performance Spigot fork with plugin support. Downloaded from PaperMC, verified with SHA-256.",
    plugins: true,
    builds: true,
    buildLabel: "Build",
    buildOf: numberedBuild,
  },
  purpur: {
    label: "Purpur",
    tone: "violet",
    description:
      "Paper fork with extra gameplay options; runs Paper plugins. Downloaded from PurpurMC, verified with MD5.",
    plugins: true,
    builds: true,
    buildLabel: "Build",
    buildOf: numberedBuild,
  },
  fabric: {
    label: "Fabric",
    tone: "amber",
    description:
      "Lightweight modding platform. Loads Fabric mods (drop them into mods/), not Bukkit plugins. Fabric publishes no checksums.",
    plugins: false,
    builds: true,
    buildLabel: "Loader",
    buildOf: (b) => `${b.changes[0]} · ${b.channel.toLowerCase()}`, // the loader version lives in changes[0]
  },
  vanilla: {
    label: "Vanilla",
    tone: "lime",
    description: "Mojang's unmodified server. No plugins or mods. Downloaded from Mojang, verified with SHA-1.",
    plugins: false,
    builds: false,
    buildLabel: "Build",
    buildOf: numberedBuild,
  },
};
export const DEFAULT_SOFTWARE = "paper";
export const SOFTWARE_LABELS = Object.fromEntries(Object.entries(SOFTWARE).map(([id, s]) => [id, s.label]));
export const softwareName = (software: string) => SOFTWARE[software]?.label ?? software;
export const hasPlugins = (software: string) => SOFTWARE[software]?.plugins ?? true;
export const hasBuilds = (software: string) => SOFTWARE[software]?.builds ?? true;

/** "Paper 26.2" — used wherever an instance's software/version pair is shown. */
export const softwareLabel = (x: { software: string; mcVersion: string }) =>
  `${softwareName(x.software)} ${x.mcVersion}`;
