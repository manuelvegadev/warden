"use client";

import { Button } from "@warden/ui/components/button";
import { Archive } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ACTIVITY_KINDS, ActivityFeed } from "@/components/instance/activity-feed";
import { useInstance } from "@/components/instance/instance-context";
import { PlayersOnlineCard, ServerFactsCard, StatusCard } from "@/components/instance/instance-facts";
import { ResourceCards } from "@/components/instance/resource-cards";
import { CopyButton, SectionCard } from "@/components/instance/section-card";
import { useServerAddress } from "@/components/wardend-config";
import { type BackupInfo, backups, formatBytes, hasTps, instances, type ServerEvent } from "@/lib/api";
import { instanceHref } from "@/lib/instance-routes";
import { formatWhen } from "@/lib/utils";

/**
 * The instance's landing page (ADR-021): the resources over the last hour, its state and who is on,
 * what it runs, the latest activity and where backups stand. Every other section is a tool and has
 * the page to itself; this is the one that reads like a dashboard.
 */
export function Overview() {
  const { manifest, status, metrics, history, canManage, task } = useInstance();
  const address = useServerAddress(manifest.port);
  const id = manifest.id;

  const [events, setEvents] = useState<ServerEvent[]>([]);
  const onlineKey = status.players.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: onlineKey re-reads the feed on join/leave
  useEffect(() => {
    instances
      .events(id, ACTIVITY_KINDS, 12)
      .then(setEvents)
      .catch(() => {});
  }, [id, onlineKey]);

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <span className="text-xs text-muted-foreground">Last hour</span>
        <ResourceCards
          metrics={metrics}
          history={history}
          state={status.state}
          tps={status.tps}
          showTps={hasTps(manifest.software)}
          memoryMb={manifest.memoryMb}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <StatusCard
          status={status}
          address={<CopyButton value={address} label={address} showLabel className="-mr-2 h-6 font-mono text-xs" />}
        />
        <PlayersOnlineCard status={status} />
        <ServerFactsCard manifest={manifest} metrics={metrics} />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <SectionCard
          title="Recent activity"
          subtitle="Joins, leaves, chat, advancements and voice sessions from Beacon."
          action={<SeeAll href={instanceHref(id, "players")}>Players</SeeAll>}
        >
          <ActivityFeed events={events} />
        </SectionCard>
        <BackupsSummary
          id={id}
          canManage={canManage}
          busy={task?.type === "backup" && (task.status === "pending" || task.status === "running")}
        />
      </div>
    </div>
  );
}

/** The newest backup, when the schedule runs next, and the button to make one now. */
function BackupsSummary({ id, canManage, busy }: { id: string; canManage: boolean; busy: boolean }) {
  const { manifest } = useInstance();
  const [list, setList] = useState<BackupInfo[] | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a finished backup task re-reads the list
  useEffect(() => {
    backups
      .list(id)
      .then(setList)
      .catch(() => setList([]));
  }, [id, busy]);

  const latest = list?.reduce<BackupInfo | null>((a, b) => (!a || b.createdAt > a.createdAt ? b : a), null) ?? null;
  const settings = manifest.backups;
  // The scheduler counts from the previous scheduled backup (docs/api.md, backups).
  const lastScheduled = list
    ?.filter((b) => b.trigger === "schedule")
    .map((b) => b.createdAt)
    .sort()
    .at(-1);
  const next =
    settings?.enabled && settings.everyHours > 0
      ? lastScheduled
        ? new Date(new Date(lastScheduled).getTime() + settings.everyHours * 3_600_000)
        : null
      : undefined;

  return (
    <SectionCard
      title="Backups"
      subtitle="Archives of the world and configuration."
      action={<SeeAll href={instanceHref(id, "backups")}>Backups</SeeAll>}
    >
      <div className="grid gap-2 px-5 py-3 text-sm">
        <Row label="Latest">
          {list === null ? "…" : latest ? `${formatWhen(latest.createdAt)} · ${formatBytes(latest.size)}` : "None yet"}
        </Row>
        <Row label="Next scheduled">
          {next === undefined ? "Schedule off" : next === null ? "On the next check" : formatWhen(next.getTime())}
        </Row>
        {canManage && (
          <Button
            variant="outline"
            size="sm"
            className="mt-1 w-fit"
            disabled={busy}
            onClick={() =>
              backups
                .create(id)
                .then(() => toast.success("Backup started…"))
                .catch((e: Error) => toast.error(e.message))
            }
          >
            <Archive /> {busy ? "Backing up…" : "Back up now"}
          </Button>
        )}
      </div>
    </SectionCard>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{children}</span>
    </div>
  );
}

function SeeAll({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-xs text-primary underline-offset-4 hover:underline">
      {children} →
    </Link>
  );
}
