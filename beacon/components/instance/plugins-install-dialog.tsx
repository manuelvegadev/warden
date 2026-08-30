"use client";

import { Badge } from "@warden/ui/components/badge";
import { Button } from "@warden/ui/components/button";
import { Checkbox } from "@warden/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@warden/ui/components/dialog";
import { Input } from "@warden/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@warden/ui/components/select";
import { Download, ExternalLink, Search, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  IconLink,
  PluginDetailsDialog,
  PluginNameButton,
  type PluginRef,
} from "@/components/instance/plugin-details-dialog";
import { PluginIcon } from "@/components/instance/plugin-icon";
import { CATALOG_SOURCES, PluginSourceBadge } from "@/components/instance/plugin-source-badge";
import { compactNum, type PluginHit, type PluginVersion, plugins } from "@/lib/api";
import { mono } from "@/lib/utils";

const SOURCE_FILTERS: Record<string, string> = {
  all: "All sources",
  ...Object.fromEntries(Object.entries(CATALOG_SOURCES).map(([k, v]) => [k, v.label])),
};
const keyOf = (h: PluginHit) => `${h.source}:${h.id}`;

/** One queued plugin: the hit plus its compatible versions (loaded when queued) and the chosen one. */
interface Pending {
  hit: PluginHit;
  versions: PluginVersion[] | null;
  versionId: string;
}

/**
 * Prism-Launcher style installer: search, tick results to queue them, pick a version per queued
 * plugin, then install the whole queue. Each install is a daemon task; progress arrives over the socket.
 */
export function InstallPluginsDialog({
  instanceId,
  mcVersion,
  installed,
}: {
  instanceId: string;
  mcVersion: string;
  installed: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [hits, setHits] = useState<PluginHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [queue, setQueue] = useState<Pending[]>([]);
  const [installing, setInstalling] = useState(false);
  const [selected, setSelected] = useState<PluginRef | null>(null);
  const closeDetails = useCallback(() => setSelected(null), []);

  // Both sources rank by downloads, so an empty query lists the most popular compatible plugins.
  const runSearch = useCallback(
    async (q: string, src: string) => {
      setSearching(true);
      try {
        setHits((await plugins.search(q.trim(), mcVersion, src)).hits);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Search failed");
      } finally {
        setSearching(false);
      }
    },
    [mcVersion],
  );
  useEffect(() => {
    if (open) runSearch("", "all");
  }, [open, runSearch]);

  function search(e: FormEvent) {
    e.preventDefault();
    runSearch(query, source);
  }

  const queued = useMemo(() => new Set(queue.map((p) => keyOf(p.hit))), [queue]);

  /** Queue a hit and load its compatible versions (default: newest release), or drop it from the queue. */
  function toggle(hit: PluginHit, on: boolean) {
    const key = keyOf(hit);
    if (!on) {
      setQueue((q) => q.filter((p) => keyOf(p.hit) !== key));
      return;
    }
    setQueue((q) => [...q, { hit, versions: null, versionId: "" }]);
    plugins
      .versions(hit.source, hit.id, mcVersion)
      .then((versions) => {
        const pick = versions.find((v) => v.channel === "release") ?? versions[0];
        setQueue((q) => q.map((x) => (keyOf(x.hit) === key ? { ...x, versions, versionId: pick?.id ?? "" } : x)));
      })
      .catch((e) => {
        toast.error(`${hit.name}: ${e.message}`);
        setQueue((q) => q.filter((x) => keyOf(x.hit) !== key));
      });
  }
  const ready = queue.length > 0 && queue.every((p) => p.versions !== null && p.versionId);

  async function installAll() {
    setInstalling(true);
    try {
      await Promise.all(queue.map((p) => plugins.install(instanceId, p.hit.source, p.hit.id, p.versionId)));
      toast.success(`Installing ${queue.length} plugin${queue.length === 1 ? "" : "s"}…`);
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Install failed");
    } finally {
      setInstalling(false);
    }
  }

  function reset() {
    setOpen(false);
    setQueue([]);
    setHits(null);
    setQuery("");
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Download className="size-4" /> Install plugins
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && reset()}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Install plugins</DialogTitle>
            <DialogDescription>
              Search Hangar and Modrinth for Paper plugins compatible with Minecraft {mcVersion}. Tick the ones you
              want, then install them all at once.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={search} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search plugins…"
              className="min-w-0"
              type="search"
              autoFocus
            />
            <Select items={SOURCE_FILTERS} value={source} onValueChange={(v) => v && setSource(v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SOURCE_FILTERS).map(([v, label]) => (
                  <SelectItem key={v} value={v}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" variant="outline" disabled={searching}>
              <Search className="size-4" /> {searching ? "Searching…" : "Search"}
            </Button>
          </form>

          <div className="min-h-0 flex-1 divide-y overflow-y-auto rounded-md border">
            {hits === null && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading popular plugins…</p>
            )}
            {hits && hits.length > 0 && !query.trim() && (
              <p className="bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                Most downloaded for Minecraft {mcVersion}
              </p>
            )}
            {hits?.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No plugins match “{query}” for {mcVersion}.
              </p>
            )}
            {hits?.map((h) => {
              const key = keyOf(h);
              const id = `queue-${key}`;
              return (
                <label
                  key={key}
                  htmlFor={id}
                  className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/50"
                >
                  <Checkbox id={id} checked={queued.has(key)} onCheckedChange={(c) => toggle(h, c === true)} />
                  <PluginIcon src={h.iconUrl} className="size-9" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <PluginNameButton onClick={() => setSelected({ source: h.source, id: h.id })}>
                        {h.name}
                      </PluginNameButton>
                      <PluginSourceBadge source={h.source} />
                      {installed.has(key) && <Badge variant="outline">installed</Badge>}
                      <span className="text-xs text-muted-foreground">
                        by {h.author || "—"} · {compactNum(h.downloads)} downloads
                      </span>
                    </div>
                    <p className="line-clamp-1 text-xs text-muted-foreground">{h.description}</p>
                  </div>
                  <IconLink href={h.url} label="Open project page" icon={ExternalLink} variant="ghost" />
                </label>
              );
            })}
          </div>

          {queue.length > 0 && (
            <div className="grid gap-2">
              <p className="text-xs font-medium text-muted-foreground">Queued ({queue.length})</p>
              <div className="max-h-40 divide-y overflow-y-auto rounded-md border">
                {queue.map((p) => (
                  <div key={keyOf(p.hit)} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <PluginIcon src={p.hit.iconUrl} className="size-7" />
                    <span className="min-w-0 flex-1 truncate font-medium">{p.hit.name}</span>
                    {p.versions === null ? (
                      <span className="text-xs text-muted-foreground">Loading versions…</span>
                    ) : (
                      <Select
                        value={p.versionId}
                        onValueChange={(v) =>
                          v && setQueue((q) => q.map((x) => (x === p ? { ...x, versionId: v } : x)))
                        }
                      >
                        <SelectTrigger size="sm" className={`w-56 ${mono}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {p.versions.map((v) => (
                            <SelectItem key={v.id} value={v.id} className={mono}>
                              {v.name} · {v.channel}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Remove from queue"
                      onClick={() => toggle(p.hit, false)}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={reset}>
              Cancel
            </Button>
            <Button onClick={installAll} disabled={!ready || installing}>
              <Download className="size-4" />
              {installing ? "Installing…" : `Install ${queue.length || ""}`.trim()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PluginDetailsDialog selected={selected} onClose={closeDetails} />
    </>
  );
}
