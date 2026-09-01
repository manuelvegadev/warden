"use client";

import {
  Activity,
  Archive,
  FileCode2,
  Puzzle,
  Settings,
  Shield,
  SlidersHorizontal,
  Terminal,
  Users,
} from "lucide-react";
import { AccessLists } from "@/components/instance/access-lists";
import { BackupsTab } from "@/components/instance/backups-tab";
import { Console } from "@/components/instance/console";
import { FilesEditor } from "@/components/instance/files-editor";
import type { InstanceState } from "@/components/instance/instance-context";
import { LaunchCommandCard } from "@/components/instance/launch-command-card";
import { MetricsChart } from "@/components/instance/metrics-chart";
import { PlayersTab } from "@/components/instance/players-tab";
import { PluginsTab } from "@/components/instance/plugins-tab";
import { PropertiesEditor } from "@/components/instance/properties-editor";
import { SettingsForm } from "@/components/instance/settings-form";
import { UpgradeCard } from "@/components/instance/upgrade-card";
import { can, type InstanceAction, type InstanceRole } from "@/lib/access";
import { hasPlugins, isStopped } from "@/lib/api";

export interface Section {
  slug: string;
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
}

/** Single source of truth for instance sections: sidebar items, breadcrumb labels and the [section] route. */
export const SECTIONS: Section[] = [
  { slug: "console", label: "Console", icon: Terminal, render: () => <Console /> },
  {
    slug: "metrics",
    label: "Metrics",
    icon: Activity,
    render: (s) => <MetricsChart data={s.history} memoryMb={s.manifest.memoryMb} />,
  },
  {
    slug: "players",
    label: "Players",
    icon: Users,
    render: (s) => <PlayersTab id={s.manifest.id} online={s.status.players} canManage={s.canManage} />,
  },
  {
    slug: "properties",
    label: "Properties",
    icon: SlidersHorizontal,
    needs: "config.write",
    render: (s) => <PropertiesEditor id={s.manifest.id} running={s.status.state === "running"} />,
  },
  {
    slug: "files",
    label: "Files",
    icon: FileCode2,
    needs: "config.write",
    render: (s) => <FilesEditor id={s.manifest.id} running={s.status.state === "running"} canManage={s.canManage} />,
  },
  {
    slug: "access",
    label: "Access",
    icon: Shield,
    render: (s) => <AccessLists id={s.manifest.id} canManage={s.canManage} />,
  },
  {
    slug: "plugins",
    label: "Plugins",
    icon: Puzzle,
    hidden: (software) => !hasPlugins(software),
    render: (s) => (
      <PluginsTab id={s.manifest.id} mcVersion={s.manifest.mcVersion} canManage={s.canManage} task={s.task} />
    ),
  },
  {
    slug: "backups",
    label: "Backups",
    icon: Archive,
    render: (s) => <BackupsTab manifest={s.manifest} state={s.status.state} canManage={s.canManage} task={s.task} />,
  },
  {
    slug: "settings",
    label: "Settings",
    icon: Settings,
    needs: "settings.write",
    render: (s) => (
      <div className="grid grid-cols-1 gap-8">
        <UpgradeCard manifest={s.manifest} state={s.status.state} canManage={s.canManage} task={s.task} />
        <LaunchCommandCard manifest={s.manifest} />
        <SettingsForm manifest={s.manifest} running={!isStopped(s.status.state)} />
      </div>
    ),
  },
];

/** The sections this software supports and this role may open. */
export const sectionsFor = (software: string, role: InstanceRole | undefined) =>
  SECTIONS.filter((s) => !s.hidden?.(software) && allows(s, role));

export const sectionBySlug = (slug: string) => SECTIONS.find((s) => s.slug === slug);

/** Whether a role may open a section at all. The daemon enforces it too; this keeps the nav honest. */
export const allows = (section: Section, role: InstanceRole | undefined) =>
  section.needs === undefined ? role !== undefined : can(role, section.needs);
