"use client";

import { Button } from "@warden/ui/components/button";
import { Archive } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ACTIVITY_KINDS, ActivityFeed } from "@/components/instance/activity-feed";
import { useInstance } from "@/components/instance/instance-context";
import { SectionCard } from "@/components/instance/section-card";
import { type BackupInfo, backups, formatBytes, instances, type ServerEvent } from "@/lib/api";
import { instanceHref } from "@/lib/instance-routes";
import { formatWhen } from "@/lib/utils";

/**
 * The "Recent activity" block of the Overview: joins, leaves, chat, advancements and voice sessions.
 * With `fill` it takes the height its dashboard column leaves it, showing as many as fit.
 */
export function RecentActivity({ fill }: { fill?: boolean }) {
  const { manifest, status } = useInstance();
  const id = manifest.id;

  const [events, setEvents] = useState<ServerEvent[]>([]);
  const onlineKey = status.players.join(",");
  // Enough to fill a tall dashboard column; the card cuts what does not fit.
  const limit = fill ? 40 : 12;
  // biome-ignore lint/correctness/useExhaustiveDependencies: onlineKey re-reads the feed on join/leave
  useEffect(() => {
    instances
      .events(id, ACTIVITY_KINDS, limit)
      .then(setEvents)
      .catch(() => {});
  }, [id, onlineKey, limit]);

  return (
    <SectionCard
      title="Recent activity"
      subtitle="Joins, leaves, chat, advancements and voice sessions from Beacon."
      action={<SeeAll href={instanceHref(id, "players")}>Players</SeeAll>}
      fill={fill}
    >
      <ActivityFeed events={events} />
    </SectionCard>
  );
}

/** The Overview's backups block: the newest backup, when the schedule runs next, and a "back up now" button. */
export function BackupsSummaryCard() {
  const { manifest, canManage, task } = useInstance();
  return (
    <BackupsSummary
      id={manifest.id}
      canManage={canManage}
      busy={task?.type === "backup" && (task.status === "pending" || task.status === "running")}
    />
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
