"use client";

import { ArrowRight, ArrowUpCircle, History, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SectionCard } from "@/components/instance/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type InstanceState,
  instances,
  isStopped,
  type Manifest,
  softwareLabel,
  type Task,
  type UpgradeCheck,
  type UpgradeTarget,
} from "@/lib/api";
import { badgeTone, formatDate, formatDateTime, mono } from "@/lib/utils";

/**
 * Server software card: current Paper build, newer build / newer Minecraft version from the
 * catalog, and the upgrade action (stopped server only; the daemon backs up jar, configs and worlds first).
 */
export function UpgradeCard({
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
  const router = useRouter();
  const [check, setCheck] = useState<UpgradeCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirm, setConfirm] = useState<UpgradeTarget | null>(null);
  const stopped = isStopped(state);
  const upgrading = task?.type === "upgrade" && (task.status === "running" || task.status === "pending");

  const runCheck = useCallback(() => {
    setChecking(true);
    instances
      .upgradeCheck(manifest.id)
      .then(setCheck)
      .catch((e) => toast.error(e.message))
      .finally(() => setChecking(false));
  }, [manifest.id]);
  useEffect(() => {
    runCheck();
  }, [runCheck]);
  // The manifest (version/build) comes from the server component tree: refresh it once the task ends.
  useEffect(() => {
    if (task?.type === "upgrade" && task.status === "done") {
      router.refresh();
      runCheck();
    }
  }, [task, router, runCheck]);

  async function upgrade(target: UpgradeTarget) {
    setConfirm(null);
    try {
      await instances.upgrade(manifest.id, { mcVersion: target.mcVersion, build: target.build });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upgrade failed to start");
    }
  }

  const hasTarget = !!(check?.latestBuild || check?.latestVersion);
  const upToDate = check !== null && !hasTarget;

  return (
    <SectionCard
      title="Server software"
      subtitle="Paper builds from the official catalog. Upgrading backs up the jar, configs and worlds first."
      action={
        <Button size="sm" variant="ghost" onClick={runCheck} disabled={checking} aria-label="Check for updates">
          <RefreshCw className={`size-4 ${checking ? "animate-spin" : ""}`} /> Check
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
        <span className="text-muted-foreground">Installed</span>
        <span className={mono}>
          {softwareLabel(manifest)} #{manifest.build}
        </span>
        {upToDate && (
          <Badge variant="outline" className={badgeTone.emerald}>
            Up to date
          </Badge>
        )}
      </div>
      {check?.latestBuild && (
        <TargetRow
          label={`Build #${check.latestBuild.build} for ${check.latestBuild.mcVersion}`}
          target={check.latestBuild}
          isAdmin={isAdmin}
          disabled={!stopped || upgrading}
          onUpgrade={setConfirm}
        />
      )}
      {check?.latestVersion && (
        <TargetRow
          label={`Minecraft ${check.latestVersion.mcVersion} · build #${check.latestVersion.build}`}
          target={check.latestVersion}
          isAdmin={isAdmin}
          disabled={!stopped || upgrading}
          onUpgrade={setConfirm}
        />
      )}
      {hasTarget && !stopped && <p className="px-5 py-2 text-xs text-muted-foreground">Stop the server to upgrade.</p>}
      {manifest.upgrades && manifest.upgrades.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer items-center gap-2 px-5 py-2.5 text-sm text-muted-foreground hover:text-foreground">
            <History className="size-4" aria-hidden />
            Upgrade history ({manifest.upgrades.length})
          </summary>
          <ul className="divide-y border-t">
            {[...manifest.upgrades].reverse().map((u) => (
              <li key={u.at} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 text-sm">
                <span className={mono}>
                  {u.fromVersion} #{u.fromBuild}
                </span>
                <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
                <span className={mono}>
                  {u.toVersion} #{u.toBuild}
                </span>
                <span className="text-xs text-muted-foreground">{formatDateTime(u.at)}</span>
                <span
                  className={`${mono} ml-auto text-xs text-muted-foreground`}
                  title="Backup taken before the upgrade"
                >
                  {u.backup}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={`Upgrade to ${confirm?.mcVersion} build #${confirm?.build}?`}
        description={`wardend first archives the current configs, plugins and every world to the instance's backups folder, then swaps the jar. Plugins may need updates for a new Minecraft version${
          confirm && confirm.mcVersion !== manifest.mcVersion
            ? " — and Paper migrates world data on first start; that cannot be undone except from the backup."
            : "."
        }`}
        confirmLabel="Upgrade"
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && upgrade(confirm)}
      />
    </SectionCard>
  );
}

function TargetRow({
  label,
  target,
  isAdmin,
  disabled,
  onUpgrade,
}: {
  label: string;
  target: UpgradeTarget;
  isAdmin: boolean;
  disabled: boolean;
  onUpgrade: (target: UpgradeTarget) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-3 text-sm">
      <ArrowUpCircle className="size-4 shrink-0 text-emerald-500" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{label}</span>
          {target.channel && <Badge variant="outline">{target.channel}</Badge>}
          {target.time && <span className="text-xs text-muted-foreground">{formatDate(target.time)}</span>}
        </div>
        {target.changes && target.changes.length > 0 && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{target.changes.join(" · ")}</p>
        )}
      </div>
      {isAdmin && (
        <Button size="sm" disabled={disabled} onClick={() => onUpgrade(target)}>
          Upgrade
        </Button>
      )}
    </div>
  );
}
