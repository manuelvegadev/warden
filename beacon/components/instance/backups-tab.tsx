"use client";

import { Badge } from "@warden/ui/components/badge";
import { Button } from "@warden/ui/components/button";
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator } from "@warden/ui/components/dropdown-menu";
import { Input } from "@warden/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@warden/ui/components/select";
import { Switch } from "@warden/ui/components/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@warden/ui/components/table";
import { badgeTone } from "@warden/ui/lib/badge-tone";
import { Archive, Download, RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RowActions } from "@/components/instance/row-actions";
import { SaveBar, SectionCard, SettingRow } from "@/components/instance/section-card";
import { useAction } from "@/hooks/use-action";
import { useDraft } from "@/hooks/use-draft";
import {
  type BackupInfo,
  type BackupSettings,
  backups,
  formatBytes,
  type InstanceState,
  instances,
  isStopped,
  type Manifest,
  type Task,
} from "@/lib/api";
import { formatDateTime, mono } from "@/lib/utils";

const TRIGGER_TONE: Record<BackupInfo["trigger"], string> = {
  manual: badgeTone.blue,
  schedule: badgeTone.emerald,
  "pre-upgrade": badgeTone.amber,
  "pre-restore": badgeTone.amber,
  unknown: badgeTone.muted,
};
const CONFIRM = {
  restore: {
    title: "Restore this backup?",
    body: (name: string) =>
      `Replaces the current worlds, plugins and configs with ${name}. A pre-restore backup is taken first so this can be undone.`,
    cta: "Restore",
  },
  delete: {
    title: "Delete this backup?",
    body: (name: string) => `${name} will be removed permanently.`,
    cta: "Delete",
  },
};
const EVERY = { "1": "Every hour", "6": "Every 6 hours", "12": "Every 12 hours", "24": "Daily", "168": "Weekly" };
const SCOPES = { full: "Full (worlds, plugins, configs)", worlds: "Worlds only" };

/** Backups: archive list with restore/download/delete, and the per-instance schedule. */
export function BackupsTab({
  manifest,
  state,
  isAdmin,
  task,
}: {
  manifest: Manifest;
  state: InstanceState;
  isAdmin: boolean;
  task: Task | null;
}) {
  const id = manifest.id;
  const [list, setList] = useState<BackupInfo[] | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "restore" | "delete"; backup: BackupInfo } | null>(null);
  const stopped = isStopped(state);
  const ownTask = task?.type === "backup" || task?.type === "restore";
  const busy = ownTask && (task.status === "running" || task.status === "pending");

  const refresh = useCallback(() => {
    backups
      .list(id)
      .then(setList)
      .catch((e) => toast.error(e.message));
  }, [id]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (ownTask && task.status === "done") refresh();
  }, [ownTask, task, refresh]);
  const act = useAction(refresh);

  return (
    <div className="grid gap-8">
      <SectionCard
        title="Backups"
        subtitle="tar.zst archives in the instance's backups folder. With the server running, worlds are flushed and auto-save paused while archiving."
        action={
          isAdmin && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => act(() => backups.create(id).then(() => "Backup started…"), false)}
            >
              <Archive className="size-4" /> Back up now
            </Button>
          )
        }
      >
        {list === null && <p className="px-5 py-3 text-sm text-muted-foreground">Loading…</p>}
        {list?.length === 0 && <p className="px-5 py-3 text-sm text-muted-foreground">No backups yet.</p>}
        {list && list.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Created</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Server</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((b) => (
                <TableRow key={b.name}>
                  <TableCell className="pl-5">
                    <div>{formatDateTime(b.createdAt)}</div>
                    <div className={`${mono} text-xs text-muted-foreground`}>{b.name}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={TRIGGER_TONE[b.trigger]}>
                      {b.trigger}
                    </Badge>
                  </TableCell>
                  <TableCell className="capitalize">{b.scope}</TableCell>
                  <TableCell className={mono}>{b.mcVersion ? `${b.mcVersion} #${b.build}` : "—"}</TableCell>
                  <TableCell className={`${mono} text-right`}>{formatBytes(b.size)}</TableCell>
                  <TableCell className="pr-3">
                    <RowActions label={`Actions for ${b.name}`}>
                      <DropdownMenuGroup>
                        <DropdownMenuItem render={<a href={backups.downloadUrl(id, b.name)} download />}>
                          <Download className="size-4" /> Download
                        </DropdownMenuItem>
                        {isAdmin && (
                          <DropdownMenuItem
                            disabled={!stopped || busy}
                            onClick={() => setConfirm({ kind: "restore", backup: b })}
                          >
                            <RotateCcw className="size-4" /> Restore{!stopped && " (stop the server)"}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuGroup>
                      {isAdmin && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setConfirm({ kind: "delete", backup: b })}
                            >
                              <Trash2 className="size-4" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </>
                      )}
                    </RowActions>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      {isAdmin && <ScheduleCard manifest={manifest} />}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? CONFIRM[confirm.kind].title : ""}
        description={confirm ? CONFIRM[confirm.kind].body(confirm.backup.name) : ""}
        confirmLabel={confirm ? CONFIRM[confirm.kind].cta : ""}
        destructive={confirm?.kind === "delete"}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (!c) return;
          if (c.kind === "restore") act(() => backups.restore(id, c.backup.name).then(() => "Restore started…"), false);
          else act(() => backups.remove(id, c.backup.name).then(() => `Deleted ${c.backup.name}`));
        }}
      />
    </div>
  );
}

/** Schedule and retention, same chrome as Settings. Saved through PATCH /instances/{id}. */
function ScheduleCard({ manifest }: { manifest: Manifest }) {
  const router = useRouter();
  const { draft, set, changed, dirty, reset, isDirty } = useDraft(manifest.backups);
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    try {
      await instances.update(manifest.id, { backups: draft });
      toast.success("Schedule saved");
      reset();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setPending(false);
    }
  }

  const row = (key: keyof BackupSettings, label: string, description: string, control: React.ReactNode) => (
    <SettingRow key={key} id={`backup-${key}`} label={label} description={description} dirty={isDirty(key)}>
      {control}
    </SettingRow>
  );

  return (
    <div className="grid gap-3">
      <SectionCard
        title="Schedule"
        subtitle="Automatic backups run inside wardend; pre-upgrade and pre-restore archives never rotate."
      >
        {row(
          "enabled",
          "Automatic backups",
          "Run on the interval below while wardend is up.",
          <div className="flex h-9 items-center justify-end">
            <Switch id="backup-enabled" checked={draft.enabled} onCheckedChange={(c) => set("enabled", c)} />
          </div>,
        )}
        {row(
          "everyHours",
          "Interval",
          "Measured from the previous scheduled backup.",
          <Select
            items={EVERY}
            value={String(draft.everyHours)}
            onValueChange={(v) => v && set("everyHours", Number(v))}
          >
            <SelectTrigger id="backup-everyHours" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(EVERY).map(([v, label]) => (
                <SelectItem key={v} value={v}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>,
        )}
        {row(
          "scope",
          "Scope",
          "Full also keeps plugins, their data and every config file.",
          <Select
            items={SCOPES}
            value={draft.scope}
            onValueChange={(v) => v && set("scope", v as BackupSettings["scope"])}
          >
            <SelectTrigger id="backup-scope" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SCOPES).map(([v, label]) => (
                <SelectItem key={v} value={v}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>,
        )}
        {row(
          "keep",
          "Keep",
          "Newest scheduled and manual backups to retain. 0 = unlimited.",
          <Input
            id="backup-keep"
            type="number"
            min={0}
            value={draft.keep}
            onChange={(e) => set("keep", Number(e.target.value))}
            className={mono}
          />,
        )}
        {row(
          "maxTotalMb",
          "Max total size (MB)",
          "Oldest rotating backups are removed past this. 0 = unlimited.",
          <Input
            id="backup-maxTotalMb"
            type="number"
            min={0}
            step={512}
            value={draft.maxTotalMb}
            onChange={(e) => set("maxTotalMb", Number(e.target.value))}
            className={mono}
          />,
        )}
      </SectionCard>
      <SaveBar dirty={dirty} pending={pending} count={changed.length} onDiscard={reset} onSave={save} />
    </div>
  );
}
