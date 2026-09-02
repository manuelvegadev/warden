"use client";

import { Badge } from "@warden/ui/components/badge";
import { Button } from "@warden/ui/components/button";
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator } from "@warden/ui/components/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@warden/ui/components/table";
import { badgeTone } from "@warden/ui/lib/badge-tone";
import { ArrowUpCircle, Power, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PluginDetailsDialog, PluginNameButton, type PluginRef } from "@/components/instance/plugin-details-dialog";
import { PluginIcon } from "@/components/instance/plugin-icon";
import { PluginSourceBadge } from "@/components/instance/plugin-source-badge";
import { InstallPluginsDialog } from "@/components/instance/plugins-install-dialog";
import { RowActions } from "@/components/instance/row-actions";
import { SectionCard } from "@/components/instance/section-card";
import { useAction } from "@/hooks/use-action";
import { useFileDrag } from "@/hooks/use-file-drag";
import { formatBytes, type PluginFile, type PluginUpdate, plugins, type Task } from "@/lib/api";
import { formatDate, mono } from "@/lib/utils";

const isPluginUpload = (f: File) => /\.(jar|zip)$/i.test(f.name);

const installedOn = (iso?: string) => (iso && !iso.startsWith("0001") ? formatDate(iso) : "—");

/** Installed plugins table with per-row actions, upload, and the catalog installer. */
export function PluginsTab({
  id,
  mcVersion,
  canManage,
  task,
}: {
  id: string;
  mcVersion: string;
  canManage: boolean;
  task: Task | null;
}) {
  const [installed, setInstalled] = useState<PluginFile[] | null>(null);
  const [updates, setUpdates] = useState<Map<string, PluginUpdate>>(new Map());
  const [selected, setSelected] = useState<PluginRef | null>(null);
  const [removing, setRemoving] = useState<PluginFile | null>(null);
  const closeDetails = useCallback(() => setSelected(null), []);
  const fileInput = useRef<HTMLInputElement>(null);

  /** Reloads the table; `checkUpdates` also asks the catalog (slower), so only after installs. */
  const refresh = useCallback(
    (checkUpdates = false) => {
      plugins
        .installed(id)
        .then(setInstalled)
        .catch((e) => toast.error(e.message));
      if (checkUpdates) {
        plugins
          .updates(id)
          .then((u) => setUpdates(new Map(u.map((x) => [x.fileName, x]))))
          .catch(() => {}); // best effort: the table is useful without update badges
      }
    },
    [id],
  );
  useEffect(() => {
    refresh(true);
  }, [refresh]);
  // The daemon broadcasts task progress over the socket; refresh the table when an install finishes.
  useEffect(() => {
    if (task?.type === "plugin.install" && task.status === "done") refresh(true);
  }, [task, refresh]);

  const installedKeys = useMemo(
    () => new Set(installed?.flatMap((p) => (p.source?.projectId ? [`${p.source.source}:${p.source.projectId}`] : []))),
    [installed],
  );

  const act = useAction(refresh);

  /** Uploads every .jar / .zip in the list (others are reported and skipped), then reloads once. */
  async function upload(files: Iterable<File> | null | undefined) {
    if (!files) return;
    for (const file of files) {
      if (!isPluginUpload(file)) {
        toast.error(`${file.name}: only .jar plugins or .zip bundles can be uploaded`);
        continue;
      }
      await act(async () => {
        const { plugins: added } = await plugins.upload(id, file);
        const names = added.map((p) => p.fileName).join(", ");
        return `Uploaded ${names} — restart the server to load ${added.length === 1 ? "it" : "them"}`;
      }, false);
    }
    refresh();
    if (fileInput.current) fileInput.current.value = "";
  }
  const dragging = useFileDrag(canManage, upload);

  return (
    <SectionCard
      title="Plugins"
      subtitle="Jars in server/plugins. Changes here apply on the next server start."
      action={
        canManage && (
          <div className="flex gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".jar,.zip"
              multiple
              className="hidden"
              onChange={(e) => upload(e.target.files)}
            />
            <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
              <Upload className="size-4" /> Upload
            </Button>
            <InstallPluginsDialog instanceId={id} mcVersion={mcVersion} installed={installedKeys} />
          </div>
        )
      }
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
              <TableHead>Installed</TableHead>
              {canManage && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {installed.map((p) => {
              const label = p.meta?.name ?? p.source?.name ?? p.fileName.replace(/\.jar$/, "");
              const version = p.meta?.version ?? p.source?.version;
              const ref = p.source?.projectId ? { source: p.source.source, id: p.source.projectId } : null;
              const update = updates.get(p.fileName);
              return (
                <TableRow key={p.fileName} className={p.enabled ? "" : "text-muted-foreground"}>
                  <TableCell className="w-14 pr-0 pl-5">
                    <PluginIcon src={p.iconUrl && plugins.proxied(p.iconUrl)} className="size-8" />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      {ref ? <PluginNameButton onClick={() => setSelected(ref)}>{label}</PluginNameButton> : label}
                      {!p.enabled && <Badge variant="outline">disabled</Badge>}
                      {p.managed && (
                        <Badge
                          variant="outline"
                          title="Installed and kept up to date by Warden; the live view needs it"
                        >
                          required
                        </Badge>
                      )}
                    </div>
                    <div className={`${mono} text-xs text-muted-foreground`}>{p.fileName}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className={mono}>{version ?? "—"}</span>
                      {update && (
                        <Badge variant="outline" className={badgeTone.emerald} title={`${update.version} is available`}>
                          <ArrowUpCircle className="size-3" /> {update.version}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <PluginSourceBadge source={p.source?.source ?? "manual"} />
                  </TableCell>
                  <TableCell className={`${mono} text-right`}>{formatBytes(p.size)}</TableCell>
                  <TableCell className="text-muted-foreground" title={p.source?.installedAt}>
                    {installedOn(p.source?.installedAt)}
                  </TableCell>
                  {canManage && (
                    <TableCell className="pr-3">
                      {!p.managed && (
                        <RowActions label={`Actions for ${label}`}>
                          <DropdownMenuGroup>
                            {update && (
                              <DropdownMenuItem
                                onClick={() =>
                                  act(async () => {
                                    await plugins.update(id, p.fileName);
                                    return `Updating ${label} to ${update.version}…`;
                                  }, false)
                                }
                              >
                                <ArrowUpCircle className="size-4" /> Update to {update.version}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() =>
                                act(async () => {
                                  const { enabled } = await plugins.toggle(id, p.fileName);
                                  return `${enabled ? "Enabled" : "Disabled"} ${label}`;
                                })
                              }
                            >
                              <Power className="size-4" /> {p.enabled ? "Disable" : "Enable"}
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                            <DropdownMenuItem variant="destructive" onClick={() => setRemoving(p)}>
                              <Trash2 className="size-4" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </RowActions>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-primary px-12 py-10 text-center">
            <Upload className="size-8 text-primary" aria-hidden />
            <p className="text-lg font-semibold">Drop to upload</p>
            <p className="text-sm text-muted-foreground">.jar plugins or .zip bundles containing plugin jars</p>
          </div>
        </div>
      )}
      <PluginDetailsDialog selected={selected} onClose={closeDetails} />
      <ConfirmDialog
        open={removing !== null}
        title={`Delete ${removing?.meta?.name ?? removing?.fileName}?`}
        description={
          <>
            Removes <span className={mono}>{removing?.fileName}</span> from server/plugins. The plugin's own data folder
            is kept. Takes effect on the next server start.
          </>
        }
        confirmLabel="Delete"
        destructive
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const p = removing;
          setRemoving(null);
          if (p) act(() => plugins.remove(id, p.fileName).then(() => `Deleted ${p.fileName}`));
        }}
      />
    </SectionCard>
  );
}
