"use client";

import { Input } from "@warden/ui/components/input";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PrettyConsole } from "@/components/instance/console-pretty";
import { FS_EDIT_LIMIT, formatBytes, fs } from "@/lib/api";
import { logLines } from "@/lib/console-parse";
import { isGzipped } from "@/lib/file-views";

/** How much of a big log is read: its last part, where what happened recently is. */
const TAIL_BYTES = FS_EDIT_LIMIT;
/** How often `latest.log` is checked for new lines while it is on screen. */
const FOLLOW_MS = 2000;

async function gunzip(bytes: ArrayBuffer) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/**
 * A log read like the console (ADR-020): each line's level and source, the kind filters, stack
 * traces folded into the line that logged them, and a search. Rotated logs are gunzipped in the
 * browser; a log bigger than the editor's limit shows its last 2 MB; `latest.log` follows new lines
 * as the server writes them.
 */
export function LogView({ id, path, size }: { id: string; path: string; size: number }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [query, setQuery] = useState("");
  // Bytes of the file read so far, and a decoder that keeps a character split across two reads.
  const offset = useRef(0);
  const decoder = useRef(new TextDecoder());
  const follow = !isGzipped(path) && /(^|\/)latest\.log$/.test(path);

  useEffect(() => {
    let stale = false;
    const decode = (bytes: ArrayBuffer) => decoder.current.decode(bytes, { stream: true });
    const load = async () => {
      decoder.current = new TextDecoder();
      if (isGzipped(path)) {
        const t = await gunzip(await fs.bytes(id, path));
        if (!stale) setText(t);
        return;
      }
      const tail = size > TAIL_BYTES;
      const { bytes, total } = await fs.range(id, path, tail ? `bytes=-${TAIL_BYTES}` : "bytes=0-");
      if (stale) return;
      offset.current = total;
      let t = bytes ? decode(bytes) : "";
      // The tail starts mid-line; the first whole line is where the view begins.
      if (tail) t = t.slice(t.indexOf("\n") + 1);
      setTruncated(tail);
      setText(t);
    };
    load().catch((e: Error) => !stale && setError(e.message));
    if (!follow) {
      return () => {
        stale = true;
      };
    }
    const timer = setInterval(async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const { bytes, total } = await fs.range(id, path, `bytes=${offset.current}-`);
        if (stale) return;
        if (bytes) {
          offset.current = total;
          const more = decode(bytes);
          setText((t) => (t ?? "") + more);
        } else if (total < offset.current) {
          // Shorter than what was read: the server restarted and began a new latest.log.
          await load();
        }
      } catch {
        /* the next tick tries again */
      }
    }, FOLLOW_MS);
    return () => {
      stale = true;
      clearInterval(timer);
    };
  }, [id, path, size, follow]);

  const lines = useMemo(() => (text === null ? [] : logLines(text)), [text]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? lines.filter((l) => l.text.toLowerCase().includes(q)) : lines;
  }, [lines, query]);

  if (error) return <p className="px-4 py-3 text-sm text-destructive">{error}</p>;
  if (text === null) return <p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this log…"
            type="search"
            className="pl-8"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {query ? `${shown.length} of ${lines.length} entries` : `${lines.length} entries`}
          {truncated && ` · the last ${formatBytes(TAIL_BYTES)} of ${formatBytes(size)}`}
          {follow && " · following new lines"}
        </span>
      </div>
      <PrettyConsole lines={shown} className="min-h-0 flex-1" />
    </div>
  );
}
