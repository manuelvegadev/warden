"use client";

import { Button } from "@warden/ui/components/button";
import { Input } from "@warden/ui/components/input";
import { cn } from "@warden/ui/lib/utils";
import { FileText, Search } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { languageFor } from "@/components/instance/code-editor";
import { SaveBar } from "@/components/instance/section-card";
import { useTextDraft } from "@/hooks/use-text-draft";
import { type ConfigFile, files, formatBytes } from "@/lib/api";
import { mono } from "@/lib/utils";

// CodeMirror is heavy; load it with the section, not with the app shell.
const CodeEditor = dynamic(() => import("./code-editor").then((m) => m.CodeEditor), {
  ssr: false,
  loading: () => <p className="py-4 text-sm text-muted-foreground">Loading editor…</p>,
});

const GROUP_ORDER = ["Server", "Paper", "Worlds", "Plugins"];

/** Confined config editor: the daemon lists allowlisted files; this shows them grouped next to an editor. */
export function FilesEditor({ id, running, canManage }: { id: string; running: boolean; canManage: boolean }) {
  const [list, setList] = useState<ConfigFile[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    files
      .list(id)
      .then(setList)
      .catch((e) => toast.error(e.message));
  }, [id]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byGroup = new Map<string, ConfigFile[]>();
    for (const f of list ?? []) {
      if (q && !f.path.toLowerCase().includes(q)) continue;
      const items = byGroup.get(f.group) ?? [];
      if (items.length === 0) byGroup.set(f.group, items);
      items.push(f);
    }
    return [...byGroup.entries()].sort(([a], [b]) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b));
  }, [list, query]);

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="grid content-start gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter files…"
            type="search"
            className="pl-8"
          />
        </div>
        <nav className="max-h-[560px] overflow-y-auto rounded-md border">
          {list === null && <p className="px-3 py-3 text-sm text-muted-foreground">Loading…</p>}
          {list?.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">No editable files yet.</p>}
          {groups.map(([group, items]) => (
            <div key={group}>
              <p className="sticky top-0 bg-muted/60 px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
                {group}
              </p>
              {items.map((f) => (
                <FileButton key={f.path} file={f} active={selected === f.path} onSelect={setSelected} />
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <section className="grid min-w-0 gap-3">
        {selected ? (
          <FileDraft key={selected} id={id} path={selected} running={running} canManage={canManage} />
        ) : (
          <div className="flex h-[560px] items-center justify-center rounded-md border text-sm text-muted-foreground">
            Pick a file to edit. Only Paper, Bukkit, world and plugin config files are exposed here.
          </div>
        )}
      </section>
    </div>
  );
}

function FileButton({
  file,
  active,
  onSelect,
}: {
  file: ConfigFile;
  active: boolean;
  onSelect: (path: string) => void;
}) {
  const shown = file.group === "Plugins" ? file.path.replace(/^plugins\//, "") : file.path;
  return (
    <button
      type="button"
      onClick={() => onSelect(file.path)}
      title={`${file.path} · ${formatBytes(file.size)}`}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent",
        active && "bg-accent",
      )}
    >
      <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className={`${mono} truncate text-xs`}>{shown}</span>
    </button>
  );
}

/** Editor for one file. Keyed by path from the parent, so switching files remounts a fresh draft. */
function FileDraft({
  id,
  path,
  running,
  canManage,
}: {
  id: string;
  path: string;
  running: boolean;
  canManage: boolean;
}) {
  const load = useCallback(() => files.read(id, path), [id, path]);
  const write = useCallback((t: string) => files.write(id, path, t), [id, path]);
  const draft = useTextDraft(load, write);

  // Leaving with unsaved edits closes the tab silently otherwise.
  useEffect(() => {
    if (!draft.dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft.dirty]);

  if (draft.original === null) return <p className="py-4 text-sm text-muted-foreground">Loading {path}…</p>;
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className={`${mono} truncate text-sm`}>{path}</span>
        {draft.dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
      </div>
      <CodeEditor value={draft.text} onChange={draft.setText} language={languageFor(path)} readOnly={!canManage} />
      {running && (
        <p className="text-xs text-muted-foreground">
          Paper reads these files at startup: changes apply on the next start.
        </p>
      )}
      {canManage && (
        <SaveBar dirty={draft.dirty} pending={draft.pending} onDiscard={draft.discard} onSave={draft.save}>
          <Button variant="outline" onClick={draft.reload} disabled={draft.pending}>
            Reload
          </Button>
        </SaveBar>
      )}
    </>
  );
}
