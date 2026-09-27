"use client";

import { Card, CardContent } from "@warden/ui/components/card";
import { MetricsSettings as MetricsSettingsPopover } from "@/components/dashboard/metrics-settings";
import { HostTiles, WardendTiles } from "@/components/dashboard/system-tiles";
import { Console } from "@/components/instance/console";
import { useInstance } from "@/components/instance/instance-context";
import { PlayersOnlineCard, ServerFactsCard, StatusCard } from "@/components/instance/instance-facts";
import { LiveView } from "@/components/instance/live-view";
import { MetricsPanel } from "@/components/instance/metrics-chart";
import { BackupsSummaryCard, RecentActivity } from "@/components/instance/overview";
import { ResourceCards } from "@/components/instance/resource-cards";
import { CopyButton } from "@/components/instance/section-card";
import { useServerAddress } from "@/components/wardend-config";
import { hasPlugins, hasTps } from "@/lib/api";
import type { DashboardModule } from "@/lib/dashboard-layout";
import type { MetricsSettings } from "@/lib/dashboard-modules";

/** A module that has nothing to show but a line of text, still a card like the modules around it. */
function Note({ children }: { children: React.ReactNode }) {
  return (
    <Card size="sm">
      <CardContent className="text-sm text-muted-foreground">{children}</CardContent>
    </Card>
  );
}

/** One module's content, for the instance whose Overview this is. */
export function ModuleBody({
  module,
  onSettings,
}: {
  module: DashboardModule;
  onSettings: (settings: Record<string, unknown>) => void;
}) {
  if (module.unavailable) return <Note>Module unavailable in this version of Beacon.</Note>;
  switch (module.kind) {
    case "wardend":
      return <WardendTiles />;
    case "host":
      return <HostTiles />;
    case "console":
      return <Console mode="fill" />;
    case "metrics": {
      const s = module.settings as MetricsSettings;
      return <MetricsPanel charts={s.charts} range={s.range} onRange={(range) => onSettings({ ...s, range })} />;
    }
    case "liveview":
      return <LiveViewModule />;
    case "resources":
      return <ResourcesModule />;
    case "status":
      return <StatusModule />;
    case "players":
      return <PlayersModule />;
    case "facts":
      return <FactsModule />;
    case "activity":
      return <RecentActivity fill />;
    case "backups":
      return <BackupsSummaryCard />;
    default:
      return <Note>Module unavailable in this version of Beacon.</Note>;
  }
}

/** The Metrics module's settings gear for its edit bar (ADR-026): which charts it draws. */
export function ModuleSettings({
  module,
  onSettings,
}: {
  module: DashboardModule;
  onSettings: (settings: Record<string, unknown>) => void;
}) {
  const { manifest } = useInstance();
  return (
    <MetricsSettingsPopover
      settings={module.settings as MetricsSettings}
      tpsAvailable={hasTps(manifest.software)}
      onSettings={onSettings}
    />
  );
}

function LiveViewModule() {
  const { manifest } = useInstance();
  if (!hasPlugins(manifest.software)) {
    return <Note>The live view needs a server that loads plugins.</Note>;
  }
  return <LiveView mode="fill" />;
}

function ResourcesModule() {
  const { manifest, status, metrics, history } = useInstance();
  return (
    <ResourceCards
      metrics={metrics}
      history={history}
      state={status.state}
      tps={status.tps}
      showTps={hasTps(manifest.software)}
      memoryMb={manifest.memoryMb}
    />
  );
}

function StatusModule() {
  const { manifest, status } = useInstance();
  const address = useServerAddress(manifest.port);
  return (
    <StatusCard
      status={status}
      address={<CopyButton value={address} label={address} showLabel className="-mr-2 h-6 font-mono text-xs" />}
    />
  );
}

function PlayersModule() {
  const { status } = useInstance();
  return <PlayersOnlineCard status={status} />;
}

function FactsModule() {
  const { manifest, metrics } = useInstance();
  return <ServerFactsCard manifest={manifest} metrics={metrics} />;
}
