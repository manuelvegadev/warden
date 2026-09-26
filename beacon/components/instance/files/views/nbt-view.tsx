"use client";

import { cn } from "@warden/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fs, type NbtTag } from "@/lib/api";
import { mono } from "@/lib/utils";

const OPEN_DEPTH = 2;
const PAGE = 200;

// A colour per kind of tag, so a long compound scans by type.
const TYPE_TONE: Record<string, string> = {
  byte: "text-amber-300",
  short: "text-amber-300",
  int: "text-amber-300",
  long: "text-amber-300",
  float: "text-orange-300",
  double: "text-orange-300",
  string: "text-emerald-300",
};

const child = (tag: NbtTag | undefined, name: string) => tag?.c?.find((c) => c.k === name);
const at = (tag: NbtTag | undefined, ...path: string[]) => path.reduce(child, tag);
const scalar = (tag: NbtTag | undefined) => (tag && !Array.isArray(tag.v) ? tag.v : undefined);

const GAME_MODES = ["Survival", "Creative", "Adventure", "Spectator"];
const DIFFICULTIES = ["Peaceful", "Easy", "Normal", "Hard"];

/** The facts worth a card above the tree, for the two documents every server has. */
function summary(root: NbtTag, path: string): [string, string][] {
  const data = child(root, "Data");
  if (/(^|\/)level\.dat$/.test(path) && data) {
    const rows: [string, unknown][] = [
      ["World", scalar(child(data, "LevelName"))],
      ["Version", scalar(at(data, "Version", "Name"))],
      ["Data version", scalar(child(data, "DataVersion"))],
      ["Game mode", GAME_MODES[Number(scalar(child(data, "GameType")))]],
      // Newer versions keep these under difficulty_settings.
      [
        "Difficulty",
        DIFFICULTIES[Number(scalar(child(data, "Difficulty")))] ??
          scalar(at(data, "difficulty_settings", "difficulty")),
      ],
      [
        "Hardcore",
        (scalar(child(data, "hardcore")) ?? scalar(at(data, "difficulty_settings", "hardcore"))) === 1 ? "yes" : "no",
      ],
      ["Seed", scalar(at(data, "WorldGenSettings", "seed")) ?? scalar(child(data, "RandomSeed"))],
      [
        "Spawn",
        ["SpawnX", "SpawnY", "SpawnZ"].map((k) => scalar(child(data, k))).every((v) => v !== undefined)
          ? ["SpawnX", "SpawnY", "SpawnZ"].map((k) => scalar(child(data, k))).join(", ")
          : undefined,
      ],
    ];
    return rows.filter((r): r is [string, string] => r[1] !== undefined).map(([k, v]) => [k, String(v)]);
  }
  if (/(^|\/)playerdata\/[^/]+\.dat(_old)?$/.test(path)) {
    const pos = child(root, "Pos")
      ?.c?.map((c) => Math.round(Number(c.v)))
      .join(", ");
    const inventory = child(root, "Inventory")?.c?.length;
    const rows: [string, unknown][] = [
      ["Position", pos],
      ["Dimension", scalar(child(root, "Dimension"))],
      ["Health", scalar(child(root, "Health"))],
      ["Level", scalar(child(root, "XpLevel"))],
      ["Game mode", GAME_MODES[Number(scalar(child(root, "playerGameType")))]],
      ["Inventory", inventory !== undefined ? `${inventory} stacks` : undefined],
    ];
    return rows.filter((r): r is [string, string] => r[1] !== undefined).map(([k, v]) => [k, String(v)]);
  }
  return [];
}

/**
 * An NBT document (ADR-020) — level.dat, playerdata, a map, a structure or a schematic — as the
 * daemon decodes it: a tree of typed tags, the big arrays and lists shown in part, and for
 * level.dat and a player's file the facts that matter first. Read-only.
 */
export function NbtView({ id, path }: { id: string; path: string }) {
  const [doc, setDoc] = useState<{ root: NbtTag; compression: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    fs.nbt(id, path)
      .then((d) => !stale && setDoc(d))
      .catch((e: Error) => !stale && setError(e.message));
    return () => {
      stale = true;
    };
  }, [id, path]);
  const facts = useMemo(() => (doc ? summary(doc.root, path) : []), [doc, path]);

  if (error)
    return <p className="px-4 py-3 text-sm text-muted-foreground">Not an NBT document this panel can read: {error}</p>;
  if (!doc) return <p className="px-4 py-3 text-sm text-muted-foreground">Reading…</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {facts.length > 0 && (
        <dl className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-x-6 gap-y-2 border-b px-4 py-3 text-sm">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className={cn(mono, "truncate")} title={v}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className={cn(mono, "min-h-0 flex-1 overflow-auto p-3 text-[13px] leading-relaxed")}>
        <p className="mb-2 text-xs text-muted-foreground">
          NBT, {doc.compression === "none" ? "uncompressed" : doc.compression}
        </p>
        <Tag tag={doc.root} depth={0} />
      </div>
    </div>
  );
}

function Tag({ tag, depth }: { tag: NbtTag; depth: number }) {
  const [open, setOpen] = useState(depth < OPEN_DEPTH);
  const [shown, setShown] = useState(PAGE);
  const container = tag.t === "compound" || tag.t === "list";
  const array = tag.t.endsWith("Array");
  const name = tag.k !== undefined && tag.k !== "" && <span className="text-sky-300">{tag.k}</span>;
  const type = (
    <span className="rounded-sm border px-1 text-[10px] text-muted-foreground uppercase">
      {tag.t === "list" ? `list of ${tag.of}` : tag.t}
    </span>
  );

  if (!container && !array) {
    return (
      <div className="flex min-h-6 items-center gap-1.5 pl-5">
        {name}
        {name && <span className="-ml-1.5 text-muted-foreground">:</span>}
        <span className={cn("break-all", TYPE_TONE[tag.t])}>{tag.t === "string" ? `"${tag.v}"` : String(tag.v)}</span>
        {type}
      </div>
    );
  }
  const items = container ? (tag.c ?? []) : [];
  const values = array && Array.isArray(tag.v) ? tag.v : [];
  const count = tag.n ?? (container ? items.length : values.length);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-6 items-center gap-1.5 rounded-sm text-left hover:bg-accent/40"
      >
        <ChevronRight
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
        />
        {name}
        {type}
        <span className="text-xs text-muted-foreground">
          {count} {tag.t === "compound" ? (count === 1 ? "tag" : "tags") : count === 1 ? "item" : "items"}
          {tag.n !== undefined && `, the first ${container ? items.length : values.length} shown`}
        </span>
      </button>
      {open && (
        <div className="ml-2.5 border-l border-border pl-2">
          {array ? (
            <div className="flex flex-wrap gap-x-2 pl-5 text-amber-300">
              {values.map((v, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: positions in an array
                <span key={i}>{v}</span>
              ))}
            </div>
          ) : (
            items.slice(0, shown).map((c, i) => <Tag key={c.k ?? i} tag={c} depth={depth + 1} />)
          )}
          {items.length > shown && (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE)}
              className="pl-5 text-xs text-primary underline-offset-4 hover:underline"
            >
              {items.length - shown} more…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
