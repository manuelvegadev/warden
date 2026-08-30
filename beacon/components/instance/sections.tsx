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
import { type InstanceState, useConsoleLines } from "@/components/instance/instance-context";
import { LaunchCommandCard } from "@/components/instance/launch-command-card";
import { MetricsChart } from "@/components/instance/metrics-chart";
import { PlayersTab } from "@/components/instance/players-tab";
import { PluginsTab } from "@/components/instance/plugins-tab";
import { PropertiesEditor } from "@/components/instance/properties-editor";
import { SettingsForm } from "@/components/instance/settings-form";
import { UpgradeCard } from "@/components/instance/upgrade-card";
import { hasPlugins, isStopped } from "@/lib/api";

export interface Section {
  slug: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  render: (s: InstanceState) => React.ReactNode;
  /** Sections that only make sense for some server software (e.g. Plugins). */
  hidden?: (software: string) => boolean;
}

function ConsoleSection({ s }: { s: InstanceState }) {
  const lines = useConsoleLines();
  return (
    <Console
      instanceId={s.manifest.id}
      lines={lines}
      onCommand={s.sendCommand}
      disabled={s.status.state !== "running" && s.status.state !== "starting"}
    />
  );
}

/** Single source of truth for instance sections: sidebar items, breadcrumb labels and the [section] route. */
export const SECTIONS: Section[] = [
  { slug: "console", label: "Console", icon: Terminal, render: (s) => <ConsoleSection s={s} /> },
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
    render: (s) => <PlayersTab id={s.manifest.id} online={s.status.players} isAdmin={s.isAdmin} />,
  },
  {
    slug: "properties",
    label: "Properties",
    icon: SlidersHorizontal,
    render: (s) => <PropertiesEditor id={s.manifest.id} running={s.status.state === "running"} />,
  },
  {
    slug: "files",
    label: "Files",
    icon: FileCode2,
    render: (s) => <FilesEditor id={s.manifest.id} running={s.status.state === "running"} isAdmin={s.isAdmin} />,
  },
  {
    slug: "access",
    label: "Access",
    icon: Shield,
    render: (s) => <AccessLists id={s.manifest.id} isAdmin={s.isAdmin} />,
  },
  {
    slug: "plugins",
    label: "Plugins",
    icon: Puzzle,
    hidden: (software) => !hasPlugins(software),
    render: (s) => <PluginsTab id={s.manifest.id} mcVersion={s.manifest.mcVersion} isAdmin={s.isAdmin} task={s.task} />,
  },
  {
    slug: "backups",
    label: "Backups",
    icon: Archive,
    render: (s) => <BackupsTab manifest={s.manifest} state={s.status.state} isAdmin={s.isAdmin} task={s.task} />,
  },
  {
    slug: "settings",
    label: "Settings",
    icon: Settings,
    render: (s) => (
      <div className="grid grid-cols-1 gap-8">
        <UpgradeCard manifest={s.manifest} state={s.status.state} isAdmin={s.isAdmin} task={s.task} />
        <LaunchCommandCard manifest={s.manifest} />
        <SettingsForm manifest={s.manifest} running={!isStopped(s.status.state)} />
      </div>
    ),
  },
];

export const sectionsFor = (software: string) => SECTIONS.filter((s) => !s.hidden?.(software));
export const sectionBySlug = (slug: string) => SECTIONS.find((s) => s.slug === slug);
