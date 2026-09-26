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
import { InputGroup, InputGroupAddon, InputGroupInput } from "@warden/ui/components/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@warden/ui/components/select";
import { badgeTone } from "@warden/ui/lib/badge-tone";
import { cn } from "@warden/ui/lib/utils";
import { Download, ExternalLink, Loader2, Search, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  IconLink,
  PluginDetailsDialog,
  PluginNameButton,
  type PluginRef,
} from "@/components/instance/plugin-details-dialog";
import { PluginIcon } from "@/components/instance/plugin-icon";
import { CATALOG_SOURCES, PluginSourceBadge } from "@/components/instance/plugin-source-badge";
import { usePluginSearch } from "@/hooks/use-plugin-search";
import { compactNum, hostOf, type PluginHit, type PluginVersion, plugins } from "@/lib/api";
import { mono } from "@/lib/utils";

const SOURCE_FILTERS: Record<string, string> = {
  all: "All sources",
  ...Object.fromEntries(Object.entries(CATALOG_SOURCES).map(([k, v]) => [k, v.label])),
};
const keyOf = (h: PluginHit) => `${h.source}:${h.id}`;

/** How a release reads in the version picker; Modrinth ids are opaque, so the trigger needs it too. */
const versionLabel = (v: PluginVersion) =>
  [v.name, v.channel !== "release" && v.channel, !v.listed && "not listed"].filter(Boolean).join(" · ");

/**
 * The release a queued plugin starts on: the newest release listed for this Minecraft, else the
 * newest listed build, else — nothing is listed — the newest release there is (installing it asks first).
 */
function defaultVersion(versions: PluginVersion[]) {
  const listed = versions.filter((v) => v.listed);
  return (
    listed.find((v) => v.channel === "release") ??
    listed[0] ??
    versions.find((v) => v.channel === "release") ??
    versions[0]
  );
}

/** One queued plugin: the hit plus its compatible versions (loaded when queued) and the chosen one. */
interface Pending {
  hit: PluginHit;
  versions: PluginVersion[] | null;
  versionId: string;
}

/**
 * Prism-Launcher style installer: search as you type, tick results to queue them, pick a version per queued
 * plugin, then install the whole queue. Each install is a daemon task; progress arrives over the socket.
 * Plugins that do not list this Minecraft version are not hidden (ADR-022): they keep their place,
 * dimmed, and installing one asks first — a plugin that has not caught up with a new
 * Minecraft often runs on it all the same.
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
  const { query, setQuery, source, setSource, results, searching, searchNow } = usePluginSearch(mcVersion, open);
  const hits = results?.hits ?? null;
  const [queue, setQueue] = useState<Pending[]>([]);
  const [installing, setInstalling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [selected, setSelected] = useState<PluginRef | null>(null);
  const closeDetails = useCallback(() => setSelected(null), []);

  // A new answer starts at its top, not where the previous list was scrolled to.
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (results) list.current?.scrollTo({ top: 0 });
  }, [results]);

  function search(e: FormEvent) {
    e.preventDefault();
    searchNow();
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
        const pick = defaultVersion(versions);
        setQueue((q) => q.map((x) => (keyOf(x.hit) === key ? { ...x, versions, versionId: pick?.id ?? "" } : x)));
      })
      .catch((e) => {
        toast.error(`${hit.name}: ${e.message}`);
        setQueue((q) => q.filter((x) => keyOf(x.hit) !== key));
      });
  }
  const ready = queue.length > 0 && queue.every((p) => p.versions !== null && p.versionId);
  const chosen = (p: Pending) => p.versions?.find((v) => v.id === p.versionId);
  // Releases installing asks about first: not listed for this Minecraft, or hosted outside Hangar.
  const doubtful = queue.flatMap((p) => {
    const v = chosen(p);
    return v && (!v.listed || v.external) ? [{ name: p.hit.name, v }] : [];
  });
  const anyUnlisted = doubtful.some((d) => !d.v.listed);
  const anyExternal = doubtful.some((d) => d.v.external);

  async function installAll() {
    setConfirming(false);
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
              Search Hangar and Modrinth for Paper plugins. The ones that do not list Minecraft {mcVersion} are dimmed
              and can still be installed. Tick the ones you want, then install them all at once.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={search} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
            <InputGroup className="min-w-0">
              <InputGroupAddon>
                {searching ? <Loader2 className="animate-spin" aria-label="Searching" /> : <Search />}
              </InputGroupAddon>
              <InputGroupInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search plugins…"
                aria-label="Search plugins"
                type="search"
                autoFocus
              />
            </InputGroup>
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
          </form>

          <div
            ref={list}
            aria-busy={searching}
            className={cn(
              "min-h-0 flex-1 divide-y overflow-y-auto rounded-md border transition-opacity",
              searching && hits && "opacity-70",
            )}
          >
            {hits === null && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading popular plugins…</p>
            )}
            {results && results.hits.length > 0 && !results.query && (
              <p className="bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">Most downloaded</p>
            )}
            {hits?.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No plugins match “{results?.query}”.
              </p>
            )}
            {hits?.map((h) => {
              const key = keyOf(h);
              const id = `queue-${key}`;
              const notListed = h.listed === false;
              return (
                <label
                  key={key}
                  htmlFor={id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/50",
                    notListed && "opacity-60 hover:opacity-100",
                  )}
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
                      {notListed && (
                        <Badge
                          variant="outline"
                          className={badgeTone.amber}
                          title={h.newestMc ? `The newest Minecraft it lists is ${h.newestMc}` : undefined}
                        >
                          not listed for {mcVersion}
                          {h.newestMc && ` · up to ${h.newestMc}`}
                        </Badge>
                      )}
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
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{p.hit.name}</div>
                      {chosen(p)?.external && (
                        <div className="truncate text-xs text-muted-foreground">
                          from {hostOf(chosen(p)?.url ?? "")}, outside Hangar · no hash
                        </div>
                      )}
                    </div>
                    {p.versions === null ? (
                      <span className="text-xs text-muted-foreground">Loading versions…</span>
                    ) : (
                      <Select
                        items={p.versions.map((v) => ({ value: v.id, label: versionLabel(v) }))}
                        value={p.versionId}
                        onValueChange={(v) =>
                          v && setQueue((q) => q.map((x) => (x === p ? { ...x, versionId: v } : x)))
                        }
                      >
                        <SelectTrigger size="sm" className={`w-64 ${mono}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent fit="content">
                          {p.versions.map((v) => (
                            <SelectItem
                              key={v.id}
                              value={v.id}
                              className={cn(mono, !v.listed && "text-muted-foreground")}
                            >
                              {versionLabel(v)}
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
            <Button
              onClick={() => (doubtful.length ? setConfirming(true) : installAll())}
              disabled={!ready || installing}
            >
              <Download className="size-4" />
              {installing ? "Installing…" : `Install ${queue.length || ""}`.trim()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={
          !anyExternal
            ? `Install ${doubtful.length === 1 ? "a release" : "releases"} not listed for ${mcVersion}?`
            : !anyUnlisted
              ? "Download from outside Hangar?"
              : "Install anyway?"
        }
        description={
          <>
            {doubtful.map(({ name, v }) => (
              <span key={`${name}:${v.id}`} className="mb-2 block">
                <span className="font-medium text-foreground">
                  {/* Some Hangar releases are named after the plugin itself. */}
                  {v.name === name ? name : `${name} ${v.name}`}
                </span>{" "}
                {[
                  !v.listed && `does not list Minecraft ${mcVersion}`,
                  v.external && `downloads from ${hostOf(v.url)}, with no hash to check it against`,
                ]
                  .filter(Boolean)
                  .join("; ")}
                .
              </span>
            ))}
            {anyUnlisted && "A plugin that has not caught up with a new Minecraft often runs on it all the same. "}
            {anyExternal &&
              "Warden checks that the file is a plugin jar, not who made it: install from hosts you trust. "}
            If it fails to load, the server log says why; removing it from Plugins undoes this.
          </>
        }
        confirmLabel="Install anyway"
        onConfirm={() => void installAll()}
      />
      <PluginDetailsDialog selected={selected} onClose={closeDetails} />
    </>
  );
}
