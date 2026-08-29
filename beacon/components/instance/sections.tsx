"use client";

import { Activity, Settings, Shield, SlidersHorizontal, Terminal, Users } from "lucide-react";
import { AccessLists } from "@/components/instance/access-lists";
import { Console } from "@/components/instance/console";
import { type InstanceState, useConsoleLines } from "@/components/instance/instance-context";
import { MetricsChart } from "@/components/instance/metrics-chart";
import { PlayersTab } from "@/components/instance/players-tab";
import { PropertiesEditor } from "@/components/instance/properties-editor";
import { SettingsForm } from "@/components/instance/settings-form";

export interface Section {
  slug: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  render: (s: InstanceState) => React.ReactNode;
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
    render: (s) => <PlayersTab id={s.manifest.id} online={s.status.players} />,
  },
  {
    slug: "properties",
    label: "Properties",
    icon: SlidersHorizontal,
    render: (s) => <PropertiesEditor id={s.manifest.id} running={s.status.state === "running"} />,
  },
  {
    slug: "access",
    label: "Access",
    icon: Shield,
    render: (s) => <AccessLists id={s.manifest.id} isAdmin={s.isAdmin} />,
  },
  {
    slug: "settings",
    label: "Settings",
    icon: Settings,
    render: (s) => (
      <SettingsForm manifest={s.manifest} running={s.status.state !== "stopped" && s.status.state !== "crashed"} />
    ),
  },
];

export const sectionBySlug = (slug: string) => SECTIONS.find((s) => s.slug === slug);
