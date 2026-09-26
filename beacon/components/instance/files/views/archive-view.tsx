"use client";

import { Input } from "@warden/ui/components/input";
import { cn } from "@warden/ui/lib/utils";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FileIcon } from "@/components/instance/files/file-icon";
import { JsonEditor } from "@/components/instance/files/views/json-editor";
import { MotdText } from "@/components/instance/motd-preview";
import { type ArchiveEntry, formatBytes, fs } from "@/lib/api";
import { parseMotd } from "@/lib/motd";
import { formatDateTime, mono } from "@/lib/utils";

/** A pack description is a string with § codes, or a JSON text component: its text, in order. */
function plainText(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(plainText).join("");
  if (v && typeof v === "object") {
    const o = v as { text?: unknown; extra?: unknown };
    return plainText(o.text ?? "") + plainText(o.extra ?? "");
  }
  return v === undefined || v === null ? "" : String(v);
}

const TEXT = /\.(json|mcmeta|ya?ml|txt|md|properties|toml|cfg|lang|mcfunction|js|MF)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
/** Text entries read in full only up to this size. */
const TEXT_LIMIT = 1024 * 1024;

/**
 * A zip's files (ADR-020): a datapack, a resource pack, a jar's insides. Filterable; a text or JSON
 * entry opens beside the list, a picture shows. A pack's `pack.mcmeta` leads with its description
 * and format.
 */
export function ArchiveView({ id, path }: { id: string; path: string }) {
  const [listing, setListing] = useState<{ entries: ArchiveEntry[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<ArchiveEntry | null>(null);
  const [pack, setPack] = useState<{ description: string; format?: number } | null>(null);

  useEffect(() => {
    let stale = false;
    fs.archive(id, path)
      .then((l) => {
        if (stale) return;
        setListing(l);
        if (l.entries.some((e) => e.name === "pack.mcmeta")) {
          fetch(fs.archiveEntryUrl(id, path, "pack.mcmeta"))
            .then((r) => r.json())
            .then((m) => {
              if (!stale) setPack({ description: plainText(m?.pack?.description), format: m?.pack?.pack_format });
            })
            .catch(() => {});
        }
      })
      .catch((e: Error) => !stale && setError(e.message));
    return () => {
      stale = true;
    };
  }, [id, path]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (listing?.entries ?? []).filter((e) => !q || e.name.toLowerCase().includes(q));
  }, [listing, query]);

  if (error) return <p className="px-4 py-3 text-sm text-muted-foreground">Not a zip this panel can read: {error}</p>;
  if (!listing) return <p className="px-4 py-3 text-sm text-muted-foreground">Reading…</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {pack && (
        <div className="grid gap-1 border-b px-4 py-3">
          <span className="text-xs text-muted-foreground">
            Pack{pack.format !== undefined && ` · format ${pack.format}`}
          </span>
          <MotdText lines={parseMotd(pack.description)} scale={1} />
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-72 shrink-0 flex-col border-r">
          <div className="relative border-b p-2">
            <Search className="pointer-events-none absolute top-4.5 left-4.5 size-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Filter ${listing.total} files…`}
              type="search"
              className="h-8 pl-8"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {shown.map((e) => (
              <button
                key={e.name}
                type="button"
                onClick={() => setOpen(e)}
                title={`${e.name} · ${formatBytes(e.size)}`}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-accent/50",
                  open?.name === e.name && "bg-accent",
                )}
              >
                <FileIcon name={e.name.split("/").pop() ?? e.name} dir={false} path={e.name} className="size-4" />
                <span className={cn(mono, "min-w-0 flex-1 truncate text-xs")}>{e.name}</span>
              </button>
            ))}
            {listing.total > listing.entries.length && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                The first {listing.entries.length} of {listing.total} files.
              </p>
            )}
          </div>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {open ? (
            <Entry id={id} path={path} entry={open} />
          ) : (
            <p className="m-auto text-sm text-muted-foreground">Pick a file to look inside it.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Entry({ id, path, entry }: { id: string; path: string; entry: ArchiveEntry }) {
  const url = fs.archiveEntryUrl(id, path, entry.name);
  const text = TEXT.test(entry.name) && entry.size <= TEXT_LIMIT;
  const [body, setBody] = useState<string | null>(null);
  useEffect(() => {
    if (!text) return;
    let stale = false;
    setBody(null);
    fetch(url)
      .then((r) => r.text())
      .then((t) => !stale && setBody(t))
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [url, text]);

  return (
    <>
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
        <span className={cn(mono, "truncate text-foreground")}>{entry.name}</span>
        <span className="ml-auto shrink-0">
          {formatBytes(entry.size)} · {formatDateTime(entry.modified)}
        </span>
      </div>
      {IMAGE.test(entry.name) ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
          {/* biome-ignore lint/performance/noImgElement: a file inside an archive, served by the daemon */}
          <img src={url} alt={entry.name} className="max-h-full max-w-full [image-rendering:pixelated]" />
        </div>
      ) : !text ? (
        <p className="m-auto text-sm text-muted-foreground">No preview for this kind of file.</p>
      ) : body === null ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">Reading…</p>
      ) : /\.(json|mcmeta)$/i.test(entry.name) ? (
        <JsonEditor text={body} onChange={() => {}} readOnly />
      ) : (
        <pre className={cn(mono, "min-h-0 flex-1 overflow-auto p-3 text-[13px] whitespace-pre")}>{body}</pre>
      )}
    </>
  );
}
