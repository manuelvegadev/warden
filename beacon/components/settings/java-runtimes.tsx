"use client";

import { Badge } from "@warden/ui/components/badge";
import { Button } from "@warden/ui/components/button";
import { Progress } from "@warden/ui/components/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@warden/ui/components/table";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useWardendSocket, type WsMessage } from "@/hooks/use-wardend-socket";
import { formatBytes, type JavaRelease, type JavaRuntime, java, type Task } from "@/lib/api";

export function JavaRuntimes() {
  const [installed, setInstalled] = useState<JavaRuntime[] | null>(null);
  const [available, setAvailable] = useState<JavaRelease[]>([]);
  const [tasks, setTasks] = useState<Record<string, Task>>({});

  const refresh = useCallback(() => {
    java
      .list()
      .then((r) => {
        setInstalled(r.installed);
        setAvailable(r.available ?? []);
        if (r.availableError) toast.error(`Adoptium unreachable: ${r.availableError}`);
      })
      .catch((e) => toast.error(e.message));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const onMessage = useCallback(
    (msg: WsMessage) => {
      if (msg.type !== "task.progress") return;
      const t = msg.data as Task;
      if (t.type !== "java.install") return;
      setTasks((prev) => ({ ...prev, [t.id]: t }));
      if (t.status === "done") {
        toast.success(t.message);
        refresh();
      }
      if (t.status === "failed") toast.error(t.error ?? "Install failed");
    },
    [refresh],
  );
  useWardendSocket([], onMessage);

  async function install(major: number) {
    try {
      const { task } = await java.install(major);
      setTasks((prev) => ({ ...prev, [task.id]: task }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Install failed");
    }
  }
  const [removing, setRemoving] = useState<string | null>(null);

  async function remove(id: string) {
    try {
      await java.remove(id);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Remove failed");
    }
  }

  const installedMajors = new Set(installed?.filter((r) => r.managed).map((r) => r.major));
  const running = Object.values(tasks).filter((t) => t.status === "running" || t.status === "pending");

  return (
    <div className="mt-6 grid grid-cols-1 gap-8">
      {running.map((t) => (
        <div key={t.id} className="grid gap-2 rounded-md border p-4 text-sm">
          <span>{t.message || "Starting…"}</span>
          <Progress value={t.progress} />
        </div>
      ))}

      <section>
        <h2 className="mb-3 text-lg font-medium">Installed</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Runtime</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Path</TableHead>
              <TableHead>Size</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {installed?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  No Java runtime found. Install one below.
                </TableCell>
              </TableRow>
            )}
            {installed?.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">
                  {r.id}{" "}
                  {r.managed ? <Badge variant="secondary">managed</Badge> : <Badge variant="outline">system</Badge>}
                </TableCell>
                <TableCell>{r.version}</TableCell>
                <TableCell className="max-w-[360px] truncate font-mono text-xs text-muted-foreground" title={r.path}>
                  {r.path}
                </TableCell>
                <TableCell>{r.size ? formatBytes(r.size) : "—"}</TableCell>
                <TableCell className="text-right">
                  {r.managed && (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRemoving(r.id)}>
                      Remove
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-medium">Available from Adoptium</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Minecraft 26.1+ needs Java 25, 1.20.5–1.21.x needs Java 21, 1.17–1.20.4 needs Java 17. LTS releases are
          recommended.
        </p>
        <div className="flex flex-wrap gap-2">
          {available.map((rel) => (
            <Button
              key={rel.major}
              variant={rel.lts ? "default" : "outline"}
              size="sm"
              disabled={installedMajors.has(rel.major) || running.length > 0}
              onClick={() => install(rel.major)}
            >
              Temurin {rel.major}
              {rel.lts ? " LTS" : ""}
              {installedMajors.has(rel.major) ? " ✓" : ""}
            </Button>
          ))}
        </div>
      </section>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing}?`}
        description="Any instance pinned to this runtime will fail to start until another one is selected for it.
          Instances set to pick a runtime automatically are unaffected."
        confirmLabel="Remove runtime"
        destructive
        onConfirm={() => removing && void remove(removing)}
      />
    </div>
  );
}
