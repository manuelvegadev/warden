"use client";

import { Button } from "@warden/ui/components/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@warden/ui/components/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@warden/ui/components/table";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { formatBytes, instances, type LogFile } from "@/lib/api";

const TAILS = [100, 500, 2000, 5000];

export function Logs({ id }: { id: string }) {
  const [files, setFiles] = useState<LogFile[]>([]);
  const [file, setFile] = useState("latest.log");
  const [tail, setTail] = useState(500);
  const [lines, setLines] = useState<string[] | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    instances
      .logs(id)
      .then(setFiles)
      .catch((e) => toast.error(e.message));
  }, [id]);

  // `reload` is a manual refresh trigger, not read inside the effect.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload forces a re-fetch
  useEffect(() => {
    let stale = false;
    instances
      .logTail(id, file, tail)
      .then((r) => {
        if (!stale) setLines(r.lines);
      })
      .catch((e) => {
        if (stale) return;
        setLines([]);
        toast.error(e.message);
      });
    return () => {
      stale = true;
    };
  }, [id, file, tail, reload]);
  const load = useCallback(() => {
    setLines(null);
    setReload((n) => n + 1);
  }, []);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={file} onValueChange={(v) => v && setFile(v)}>
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(files.length ? files : [{ name: "latest.log", size: 0, modTime: "" }]).map((f) => (
              <SelectItem key={f.name} value={f.name}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(tail)} onValueChange={(v) => v && setTail(Number(v))}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TAILS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                Last {n} lines
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={load}>
          Refresh
        </Button>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<a href={instances.logDownloadUrl(id, file)} download />}
        >
          Download full file
        </Button>
      </div>

      <pre className="h-[420px] overflow-auto rounded-md border bg-[#0a0a0a] p-3 text-xs leading-[1.1] text-zinc-200 font-[family-name:var(--font-console)]">
        {lines === null ? "Loading…" : lines.length === 0 ? "(empty)" : lines.join("\n")}
      </pre>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>File</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Modified</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {files.map((f) => (
            <TableRow key={f.name}>
              <TableCell className="font-mono text-xs">{f.name}</TableCell>
              <TableCell>{formatBytes(f.size)}</TableCell>
              <TableCell className="text-muted-foreground">{new Date(f.modTime).toLocaleString()}</TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  nativeButton={false}
                  render={<a href={instances.logDownloadUrl(id, f.name)} download />}
                >
                  Download
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
