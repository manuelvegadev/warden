"use client";

import {
  Activity,
  Archive,
  Box,
  FileCode2,
  FolderTree,
  LayoutDashboard,
  Mountain,
  Puzzle,
  Settings,
  Shield,
  SlidersHorizontal,
  Terminal,
  Users,
} from "lucide-react";
import dynamic from "next/dynamic";
import { AccessLists } from "@/components/instance/access-lists";
import { BackupsTab } from "@/components/instance/backups-tab";
import { Console } from "@/components/instance/console";
import { DeleteInstanceCard } from "@/components/instance/controls";
import { DistantView } from "@/components/instance/distant-view/distant-view";
import { FilesEditor } from "@/components/instance/files-editor";
import type { InstanceState } from "@/components/instance/instance-context";
import { LaunchCommandCard } from "@/components/instance/launch-command-card";
import { LiveView } from "@/components/instance/live-view";
import { MetricsView } from "@/components/instance/metrics-chart";
import { Overview } from "@/components/instance/overview";
import { PlayersTab } from "@/components/instance/players-tab";
import { PluginsTab } from "@/components/instance/plugins-tab";
import { PropertiesEditor } from "@/components/instance/properties-editor";
import { SettingsForm } from "@/components/instance/settings-form";
import { UpgradeCard } from "@/components/instance/upgrade-card";
import { can, type InstanceAction, type InstanceRole } from "@/lib/access";
import { hasPlugins, isStopped } from "@/lib/api";

// The file manager brings its icon table and the editor modes: loaded with its section, not the shell.
const FileManager = dynamic(() => import("@/components/instance/files/file-manager").then((m) => m.FileManager), {
  ssr: false,
});

/**
 * Sidebar groups, in the order they are shown: what you watch while it runs, what you edit, and
 * people. There is deliberately no "World" group — backups are the only world-scoped section, and
 * server.properties and the config files read as server configuration to anyone who has edited them.
 */
export const SECTION_GROUPS = ["Server", "Configuration", "Players"] as const;
export type SectionGroup = (typeof SECTION_GROUPS)[number];

export interface Section {
  slug: string;
  /** Which sidebar group the section belongs to. */
  group: SectionGroup;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  render: (s: InstanceState) => React.ReactNode;
  /** Sections that only make sense for some server software (e.g. Plugins). */
  hidden?: (software: string) => boolean;
  /**
   * What the viewer must be allowed to do for this section to be reachable at all. Omitted means
   * `viewer` is enough. Sections whose *reads* wardend restricts (server.properties and the config
   * files carry rcon.password) must name it here, or the tab would open onto a 403 (ADR-017 §3).
   */
  needs?: InstanceAction;
  /**
   * How tall the section is (ADR-021): a viewer is as tall as the view at every width; a fill
   * section from `lg` up, stacking at its own heights below; any other section as tall as its content.
   */
  layout?: "viewer" | "fill";
  /** A form or a page of text, held to a readable width; everything else takes the page's. */
  narrow?: boolean;
}

/** Single source of truth for instance sections: sidebar items, breadcrumb labels and the [section] route. */
export const SECTIONS: Section[] = [
  // The landing page: the instance at a glance (ADR-021).
  { slug: "overview", group: "Server", label: "Overview", icon: LayoutDashboard, render: () => <Overview /> },
  // The console is worth every line of height the screen has.
  {
    slug: "console",
    group: "Server",
    label: "Console",
    icon: Terminal,
    layout: "fill",
    render: () => <Console fill />,
  },
  {
    slug: "metrics",
    group: "Server",
    label: "Metrics",
    icon: Activity,
    // The charts want the width and the height.
    layout: "viewer",
    render: () => <MetricsView fill />,
  },
  {
    slug: "map",
    group: "Server",
    label: "Live view",
    icon: Box,
    // The viewer wants the whole page; the tiles and the facts are one click away.
    layout: "viewer",
    render: () => <LiveView />,
  },
  {
    slug: "players",
    group: "Players",
    label: "Players",
    icon: Users,
    render: (s) => <PlayersTab id={s.manifest.id} online={s.status.players} canManage={s.canManage} />,
  },
  {
    slug: "properties",
    group: "Configuration",
    label: "Properties",
    narrow: true,
    icon: SlidersHorizontal,
    needs: "config.write",
    render: (s) => (
      <PropertiesEditor
        id={s.manifest.id}
        name={s.manifest.name}
        mcVersion={s.manifest.mcVersion}
        memoryMb={s.manifest.memoryMb}
        running={s.status.state === "running"}
      />
    ),
  },
  {
    slug: "files",
    group: "Configuration",
    label: "Files",
    icon: FolderTree,
    needs: "files",
    // Finder-style columns want the width and the height of the page (ADR-020).
    layout: "viewer",
    render: (s) => <FileManager id={s.manifest.id} running={s.status.state === "running"} canManage={s.canManage} />,
  },
  {
    slug: "config",
    group: "Configuration",
    label: "Config files",
    icon: FileCode2,
    needs: "config.write",
    layout: "fill",
    render: (s) => <FilesEditor id={s.manifest.id} running={s.status.state === "running"} canManage={s.canManage} />,
  },
  {
    slug: "access",
    group: "Players",
    label: "Access",
    narrow: true,
    icon: Shield,
    render: (s) => <AccessLists id={s.manifest.id} canManage={s.canManage} />,
  },
  {
    slug: "plugins",
    group: "Configuration",
    label: "Plugins",
    icon: Puzzle,
    hidden: (software) => !hasPlugins(software),
    render: (s) => (
      <PluginsTab id={s.manifest.id} mcVersion={s.manifest.mcVersion} canManage={s.canManage} task={s.task} />
    ),
  },
  {
    slug: "distant-view",
    group: "Configuration",
    label: "Distant view",
    narrow: true,
    icon: Mountain,
    // LOD plugins are plugins: only software that loads them (ADR-025).
    hidden: (software) => !hasPlugins(software),
    render: () => <DistantView />,
  },
  {
    slug: "backups",
    group: "Server",
    label: "Backups",
    narrow: true,
    icon: Archive,
    render: (s) => <BackupsTab manifest={s.manifest} state={s.status.state} canManage={s.canManage} task={s.task} />,
  },
  {
    slug: "settings",
    group: "Configuration",
    label: "Settings",
    narrow: true,
    icon: Settings,
    needs: "settings.write",
    render: (s) => (
      <div className="grid grid-cols-1 gap-8">
        <UpgradeCard manifest={s.manifest} state={s.status.state} canManage={s.canManage} task={s.task} />
        <LaunchCommandCard manifest={s.manifest} />
        <SettingsForm manifest={s.manifest} running={!isStopped(s.status.state)} />
        {s.canManage && <DeleteInstanceCard id={s.manifest.id} name={s.manifest.name} />}
      </div>
    ),
  },
];

/** The sections this software supports and this role may open. */
export const sectionsFor = (software: string, role: InstanceRole | undefined) =>
  SECTIONS.filter((s) => !s.hidden?.(software) && allows(s, role));

/** The same sections bucketed for the sidebar. A group with nothing left in it is dropped. */
export function sectionGroupsFor(software: string, role: InstanceRole | undefined) {
  const available = sectionsFor(software, role);
  return SECTION_GROUPS.map((group) => ({ group, sections: available.filter((s) => s.group === group) })).filter(
    (g) => g.sections.length > 0,
  );
}

export const sectionBySlug = (slug: string) => SECTIONS.find((s) => s.slug === slug);

/** Whether a role may open a section at all. The daemon enforces it too; this keeps the nav honest. */
export const allows = (section: Section, role: InstanceRole | undefined) =>
  section.needs === undefined ? role !== undefined : can(role, section.needs);
