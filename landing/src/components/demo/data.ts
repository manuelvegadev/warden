import type { BadgeTone as Tone } from "@warden/ui/lib/badge-tone";
import {
  Activity,
  Archive,
  FileCode2,
  type LucideIcon,
  Puzzle,
  Settings,
  Shield,
  SlidersHorizontal,
  Terminal,
  Users,
} from "lucide-react";

/** Dummy data for the hero demo. Nothing here talks to a daemon. */

export type { BadgeTone as Tone } from "@warden/ui/lib/badge-tone";
export { badgeTone as tone } from "@warden/ui/lib/badge-tone";

export interface DemoInstance {
  name: string;
  software: "Paper" | "Purpur" | "Fabric";
  tone: Tone;
  version: string;
  build: string;
  port: number;
  memoryMb: number;
  size: string;
}

export const INSTANCES: DemoInstance[] = [
  {
    name: "survival-main",
    software: "Paper",
    tone: "blue",
    version: "1.21.8",
    build: "#112",
    port: 25565,
    memoryMb: 8192,
    size: "4.7 GB",
  },
  {
    name: "creative-build",
    software: "Purpur",
    tone: "violet",
    version: "1.21.8",
    build: "#2405",
    port: 25566,
    memoryMb: 4096,
    size: "1.9 GB",
  },
  {
    name: "fabric-test",
    software: "Fabric",
    tone: "amber",
    version: "1.21.8",
    build: "loader 0.17.2",
    port: 25567,
    memoryMb: 2048,
    size: "612 MB",
  },
];

/** `joins` names the player a line brings online (drives the Players cards). */
export type LogLine = { text: string; color: string; id?: number; joins?: string };

export const LOG_COLOR = { info: "#d4d4d4", warn: "#f59e0b", stdin: "#22d3ee", daemon: "#c084fc" } as const;

export const LOG: LogLine[] = [
  { text: "[12:04:01 INFO]: Starting minecraft server version 1.21.8", color: LOG_COLOR.info },
  { text: "[12:04:03 INFO]: This server is running Paper version 1.21.8-112", color: LOG_COLOR.info },
  { text: '[12:04:05 INFO]: Preparing level "world"', color: LOG_COLOR.info },
  { text: '[12:04:09 INFO]: Done (6.812s)! For help, type "help"', color: LOG_COLOR.info },
  { text: "[12:06:41 WARN]: Can't keep up! Is the server overloaded? Running 2314ms behind", color: LOG_COLOR.warn },
  { text: "[12:07:12 INFO]: Steve joined the game", color: LOG_COLOR.info, joins: "Steve" },
  { text: "[12:07:40 INFO]: Alex joined the game", color: LOG_COLOR.info, joins: "Alex" },
  { text: "[12:09:02 INFO]: jeb_ joined the game", color: LOG_COLOR.info, joins: "jeb_" },
];

export type SectionId =
  | "console"
  | "metrics"
  | "players"
  | "properties"
  | "files"
  | "access"
  | "plugins"
  | "backups"
  | "settings";

export const SECTIONS: { id: SectionId; label: string; icon: LucideIcon }[] = [
  { id: "console", label: "Console", icon: Terminal },
  { id: "metrics", label: "Metrics", icon: Activity },
  { id: "players", label: "Players", icon: Users },
  { id: "properties", label: "Properties", icon: SlidersHorizontal },
  { id: "files", label: "Files", icon: FileCode2 },
  { id: "access", label: "Access", icon: Shield },
  { id: "plugins", label: "Plugins", icon: Puzzle },
  { id: "backups", label: "Backups", icon: Archive },
  { id: "settings", label: "Settings", icon: Settings },
];

export const FILES: Record<string, string> = {
  "server.properties":
    "max-players=40\nview-distance=10\ndifficulty=hard\nwhite-list=true\npvp=true\nmotd=A Warden server",
  "bukkit.yml": "settings:\n  allow-end: true\n  warn-on-overload: true\nspawn-limits:\n  monsters: 70\n  animals: 10",
  "spigot.yml":
    "settings:\n  bungeecord: false\n  restart-on-crash: false   # wardend handles this\nworld-settings:\n  default:\n    merge-radius:\n      item: 2.5",
  "config/paper-global.yml":
    "chunk-loading-advanced:\n  auto-config-send-distance: true\ntimings:\n  enabled: false\nunsupported-settings:\n  allow-piston-duplication: false",
  "plugins/LuckPerms/config.yml": "server: global\nstorage-method: h2\nsync-minutes: -1",
};

export type PluginStatus = "installed" | "queued" | "available";
export interface DemoPlugin {
  name: string;
  version: string;
  source: "Hangar" | "Modrinth";
  status: PluginStatus;
}

export const PLUGINS: DemoPlugin[] = [
  { name: "LuckPerms", version: "5.5.0", source: "Hangar", status: "installed" },
  { name: "Chunky", version: "1.4.28", source: "Modrinth", status: "installed" },
  { name: "EssentialsX", version: "2.21.1", source: "Hangar", status: "installed" },
  { name: "ViaVersion", version: "5.4.2", source: "Hangar", status: "available" },
  { name: "spark", version: "1.10.140", source: "Modrinth", status: "available" },
];

export const PLUGIN_STATUS: Record<PluginStatus, { tone: Tone | ""; action: string }> = {
  installed: { tone: "emerald", action: "Uninstall" },
  queued: { tone: "amber", action: "Remove" },
  available: { tone: "muted", action: "Add to queue" },
};

export type BackupKind = "scheduled" | "pre-upgrade" | "manual";
export const BACKUP_KIND: Record<BackupKind, Tone | ""> = { scheduled: "", "pre-upgrade": "amber", manual: "sky" };
export interface DemoBackup {
  name: string;
  size: string;
  kind: BackupKind;
}

export const BACKUPS: DemoBackup[] = [
  { name: "2026-08-29T03-00.tar.zst", size: "1.9 GB", kind: "scheduled" },
  { name: "2026-08-28T03-00.tar.zst", size: "1.9 GB", kind: "scheduled" },
  { name: "2026-08-27T18-12.tar.zst", size: "1.8 GB", kind: "pre-upgrade" },
];

export interface DemoProperty {
  label: string;
  key: string;
  on: boolean;
}

export const PROPERTIES: DemoProperty[] = [
  { label: "Whitelist", key: "white-list", on: true },
  { label: "PvP", key: "pvp", on: true },
  { label: "Command blocks", key: "enable-command-block", on: false },
  { label: "Flight", key: "allow-flight", on: false },
];

export const PLAYERS = [
  { name: "Steve", time: "61h 20m", sessions: 87 },
  { name: "Alex", time: "12h 05m", sessions: 21 },
  { name: "jeb_", time: "3h 44m", sessions: 6 },
  { name: "Herobrine", time: "0h 12m", sessions: 1 },
] as const;
