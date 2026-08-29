"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PluginDetailsDialog, PluginNameButton, type PluginRef } from "@/components/instance/plugin-details-dialog";
import { PluginIcon } from "@/components/instance/plugin-icon";
import { PluginSourceBadge } from "@/components/instance/plugin-source-badge";
import { InstallPluginsDialog } from "@/components/instance/plugins-install-dialog";
import { SectionCard } from "@/components/instance/section-card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBytes, type PluginFile, plugins, type Task } from "@/lib/api";
import { mono } from "@/lib/utils";

const installedOn = (iso?: string) =>
  iso && !iso.startsWith("0001")
    ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "—";

/** Installed plugins table plus the "Install plugins" dialog (search Hangar/Modrinth, queue, install). */
export function PluginsTab({
  id,
  mcVersion,
  isAdmin,
  task,
}: {
  id: string;
  mcVersion: string;
  isAdmin: boolean;
  task: Task | null;
}) {
  const [installed, setInstalled] = useState<PluginFile[] | null>(null);
  const [selected, setSelected] = useState<PluginRef | null>(null);
  const closeDetails = useCallback(() => setSelected(null), []);

  const refresh = useCallback(() => {
    plugins
      .installed(id)
      .then(setInstalled)
      .catch((e) => toast.error(e.message));
  }, [id]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  // The daemon broadcasts task progress over the socket; refresh the table when an install finishes.
  useEffect(() => {
    if (task?.type === "plugin.install" && task.status === "done") refresh();
  }, [task, refresh]);

  const installedKeys = useMemo(
    () => new Set(installed?.flatMap((p) => (p.source?.projectId ? [`${p.source.source}:${p.source.projectId}`] : []))),
    [installed],
  );

  return (
    <SectionCard
      title="Plugins"
      subtitle="Jars in server/plugins. The server loads them on the next start."
      action={isAdmin && <InstallPluginsDialog instanceId={id} mcVersion={mcVersion} installed={installedKeys} />}
    >
      {installed === null && <p className="px-5 py-3 text-sm text-muted-foreground">Loading…</p>}
      {installed?.length === 0 && <p className="px-5 py-3 text-sm text-muted-foreground">No plugins installed yet.</p>}
      {installed && installed.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14" />
              <TableHead>Plugin</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Size</TableHead>
              <TableHead className="pr-5">Installed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {installed.map((p) => {
              const label = p.source?.name ?? p.fileName.replace(/\.jar$/, "");
              const ref = p.source?.projectId ? { source: p.source.source, id: p.source.projectId } : null;
              return (
                <TableRow key={p.fileName}>
                  <TableCell className="w-14 pr-0 pl-5">
                    <PluginIcon src={p.iconUrl && plugins.proxied(p.iconUrl)} className="size-8" />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      {ref ? <PluginNameButton onClick={() => setSelected(ref)}>{label}</PluginNameButton> : label}
                      {!p.enabled && <Badge variant="outline">disabled</Badge>}
                    </div>
                    <div className={`${mono} text-xs text-muted-foreground`}>{p.fileName}</div>
                  </TableCell>
                  <TableCell className={mono}>{p.source?.version ?? "—"}</TableCell>
                  <TableCell>
                    {p.source ? (
                      <PluginSourceBadge source={p.source.source} />
                    ) : (
                      <span className="text-muted-foreground">manual</span>
                    )}
                  </TableCell>
                  <TableCell className={`${mono} text-right`}>{formatBytes(p.size)}</TableCell>
                  <TableCell className="pr-5 text-muted-foreground" title={p.source?.installedAt}>
                    {installedOn(p.source?.installedAt)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <PluginDetailsDialog selected={selected} onClose={closeDetails} />
    </SectionCard>
  );
}
