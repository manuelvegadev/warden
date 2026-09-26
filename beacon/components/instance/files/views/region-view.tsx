"use client";

import { cn } from "@warden/ui/lib/utils";
import { useEffect, useMemo, useState } from "react";
import { formatBytes, fs } from "@/lib/api";
import { parseRegionHeader, REGION_HEADER_BYTES, type RegionChunk, regionOf } from "@/lib/region";
import { formatWhen, mono } from "@/lib/utils";

/**
 * A region file as the 32×32 chunks it holds (ADR-020), read from its first 8 KiB alone: stored
 * chunks shaded by how recently they were saved — the freshest brightest — the rest empty, with a
 * chunk's coordinates, size and save time under the pointer.
 */
export function RegionView({ id, path, size }: { id: string; path: string; size: number }) {
  const [chunks, setChunks] = useState<RegionChunk[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<RegionChunk | null>(null);
  const region = regionOf(path);

  useEffect(() => {
    let stale = false;
    fs.range(id, path, `bytes=0-${REGION_HEADER_BYTES - 1}`)
      .then(({ bytes }) => {
        if (stale) return;
        if (!bytes || bytes.byteLength < REGION_HEADER_BYTES)
          throw new Error("the file is shorter than a region header");
        setChunks(parseRegionHeader(new Uint8Array(bytes)));
      })
      .catch((e: Error) => !stale && setError(e.message));
    return () => {
      stale = true;
    };
  }, [id, path]);

  const { stored, oldest, newest } = useMemo(() => {
    const present = (chunks ?? []).filter((c) => c.present);
    const times = present.map((c) => c.savedAt).filter((t) => t > 0);
    return { stored: present.length, oldest: Math.min(...times), newest: Math.max(...times) };
  }, [chunks]);

  if (error) return <p className="px-4 py-3 text-sm text-muted-foreground">Not a region file: {error}</p>;
  if (!chunks) return <p className="px-4 py-3 text-sm text-muted-foreground">Reading…</p>;
  // 0 for the oldest save in the file, 1 for the newest.
  const age = (c: RegionChunk) => (newest > oldest ? (c.savedAt - oldest) / (newest - oldest) : 1);
  const world = (c: RegionChunk) => (region ? [region.x * 32 + c.x, region.z * 32 + c.z] : [c.x, c.z]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span>
          {stored} of 1024 chunks stored{" "}
          <span className="text-muted-foreground">
            · {formatBytes(size)}
            {region && ` · region ${region.x}, ${region.z}`}
          </span>
        </span>
        <span className={cn(mono, "text-xs text-muted-foreground")}>
          {hover
            ? hover.present
              ? `chunk ${world(hover).join(", ")} · ${formatBytes(hover.bytes)} · saved ${hover.savedAt ? formatWhen(hover.savedAt) : "—"}`
              : `chunk ${world(hover).join(", ")} · not generated`
            : "Point at a chunk"}
        </span>
      </div>
      <div
        className="grid aspect-square w-full max-w-[32rem] grid-cols-32 gap-px self-center rounded-md border bg-border p-px"
        onPointerLeave={() => setHover(null)}
      >
        {chunks.map((c) => (
          <div
            key={`${c.x}.${c.z}`}
            onPointerEnter={() => setHover(c)}
            className={cn("aspect-square", c.present ? "bg-emerald-500" : "bg-background")}
            style={c.present ? { opacity: 0.25 + 0.75 * age(c) } : undefined}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 self-center text-xs text-muted-foreground">
        <span>older</span>
        <span className="h-2 w-24 rounded-full bg-gradient-to-r from-emerald-500/25 to-emerald-500" />
        <span>saved more recently</span>
        <span className="ml-3 size-2 rounded-sm border bg-background" /> <span>empty</span>
      </div>
    </div>
  );
}
