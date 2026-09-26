"use client";

import { Button } from "@warden/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@warden/ui/components/dropdown-menu";
import { cn } from "@warden/ui/lib/utils";
import { ChevronRight, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { type KeyboardEvent, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  addTo,
  convert,
  hasUnsafeNumbers,
  type Json,
  type JsonPath,
  type JsonType,
  removeAt,
  renameKey,
  serialize,
  setAt,
  typeOf,
} from "@/lib/json-edit";
import { mono } from "@/lib/utils";

/** Levels open when the document first shows; deeper ones wait for a click. */
const OPEN_DEPTH = 2;
/** Entries a container lists before a "show more", so a huge array does not freeze the page. */
const PAGE = 200;
const TYPES: JsonType[] = ["string", "number", "boolean", "null", "object", "array"];

type Ctx = { root: Json; locked: boolean; commit: (next: Json) => void };

/**
 * Any JSON file as a document you edit in place (ADR-020): objects and arrays fold; a value is
 * changed by clicking it (a boolean flips), a key renamed the same way; each entry's menu changes
 * its type or deletes it, and a container's + adds to it. Every edit rewrites the draft in the
 * file's own indentation, so the Save bar and the text editor see the same document.
 */
export function JsonEditor({
  text,
  onChange,
  readOnly,
}: {
  text: string;
  onChange: (text: string) => void;
  readOnly?: boolean;
}) {
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(text) as Json };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "invalid JSON" };
    }
  }, [text]);
  const unsafe = useMemo(() => hasUnsafeNumbers(text), [text]);

  if (!parsed.ok) {
    return (
      <p className="px-4 py-3 text-sm text-muted-foreground">
        Not valid JSON ({parsed.error}). Switch to Edit to fix it as text.
      </p>
    );
  }
  const ctx: Ctx = {
    root: parsed.value,
    locked: Boolean(readOnly) || unsafe,
    commit: (next) => onChange(serialize(next, text)),
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {unsafe && !readOnly && (
        <p className="border-b px-4 py-2 text-xs text-muted-foreground">
          This file holds numbers too large to edit here without changing them; edit it as text.
        </p>
      )}
      <div className={cn(mono, "min-h-0 flex-1 overflow-auto p-3 text-[13px] leading-relaxed")}>
        <Entry ctx={ctx} path={[]} value={parsed.value} depth={0} />
      </div>
    </div>
  );
}

function Entry({
  ctx,
  path,
  value,
  depth,
  keyName,
}: {
  ctx: Ctx;
  path: JsonPath;
  value: Json;
  depth: number;
  /** The key under which the value sits in an object (undefined in an array and at the root). */
  keyName?: string;
}) {
  const [open, setOpen] = useState(depth < OPEN_DEPTH);
  const [shown, setShown] = useState(PAGE);
  const type = typeOf(value);
  const container = type === "object" || type === "array";
  const entries: [string | number, Json][] = container
    ? Array.isArray(value)
      ? value.map((v, i) => [i, v])
      : Object.entries(value as { [key: string]: Json })
    : [];

  const add = () => {
    ctx.commit(addTo(ctx.root, path, ""));
    setOpen(true);
  };

  return (
    <div>
      <div className="group flex min-h-7 items-center gap-1 rounded-sm pr-1 hover:bg-accent/40">
        {container ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? "Fold" : "Unfold"}
            className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}
        {keyName !== undefined && (
          <span className="flex items-center">
            <KeyName ctx={ctx} path={path} name={keyName} />
            <span className="text-muted-foreground">:</span>
          </span>
        )}
        {container ? (
          <span className="text-muted-foreground">
            {type === "array" ? "[" : "{"}
            {!open &&
              ` ${entries.length} ${type === "array" ? (entries.length === 1 ? "item" : "items") : entries.length === 1 ? "key" : "keys"} ${type === "array" ? "]" : "}"}`}
          </span>
        ) : (
          <Scalar ctx={ctx} path={path} value={value} />
        )}
        {!ctx.locked && (
          <span className="ml-auto flex items-center gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
            {container && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={type === "array" ? "Add an item" : "Add a key"}
                onClick={add}
              >
                <Plus />
              </Button>
            )}
            <EntryMenu ctx={ctx} path={path} value={value} />
          </span>
        )}
      </div>
      {container && open && (
        <>
          <div className="ml-2.5 border-l border-border pl-2">
            {entries.length === 0 && <div className="pl-6 text-muted-foreground italic">empty</div>}
            {entries.slice(0, shown).map(([k, v]) => (
              <Entry
                key={k}
                ctx={ctx}
                path={[...path, k]}
                value={v}
                depth={depth + 1}
                keyName={typeof k === "string" ? k : undefined}
              />
            ))}
            {entries.length > shown && (
              <button
                type="button"
                onClick={() => setShown((n) => n + PAGE)}
                className="pl-6 text-xs text-primary underline-offset-4 hover:underline"
              >
                {entries.length - shown} more…
              </button>
            )}
          </div>
          <div className="pl-6 text-muted-foreground">{type === "array" ? "]" : "}"}</div>
        </>
      )}
    </div>
  );
}

/** Commit on Enter or blur, back out on Escape. */
function InlineInput({
  initial,
  onCommit,
  onCancel,
  className,
}: {
  initial: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(initial);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onCommit(draft);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };
  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: the field appears because it was just clicked to edit
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => onCommit(draft)}
      className={cn(
        "h-6 min-w-24 rounded-sm border border-ring bg-background px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
      size={Math.max(draft.length + 1, 8)}
    />
  );
}

function KeyName({ ctx, path, name }: { ctx: Ctx; path: JsonPath; name: string }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <InlineInput
        initial={name}
        className="text-sky-300"
        onCancel={() => setEditing(false)}
        onCommit={(to) => {
          setEditing(false);
          if (!to || to === name) return;
          const next = renameKey(ctx.root, path.slice(0, -1), name, to);
          if (next === null) toast.error(`There is already a key named “${to}”`);
          else ctx.commit(next);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      disabled={ctx.locked}
      onClick={() => setEditing(true)}
      title={ctx.locked ? undefined : "Rename"}
      className="rounded-sm text-sky-300 enabled:hover:bg-accent disabled:cursor-default"
    >
      {name}
    </button>
  );
}

function Scalar({ ctx, path, value }: { ctx: Ctx; path: JsonPath; value: Json }) {
  const [editing, setEditing] = useState(false);
  const type = typeOf(value);
  const shown =
    type === "string" ? (
      <span className="break-all text-emerald-300">"{value as string}"</span>
    ) : type === "number" ? (
      <span className="text-amber-300">{value as number}</span>
    ) : type === "boolean" ? (
      <span className="text-violet-300">{String(value)}</span>
    ) : (
      <span className="text-muted-foreground">null</span>
    );
  if (ctx.locked || type === "null") return shown;
  if (type === "boolean") {
    return (
      <button
        type="button"
        onClick={() => ctx.commit(setAt(ctx.root, path, !value))}
        title="Flip"
        className="rounded-sm hover:bg-accent"
      >
        {shown}
      </button>
    );
  }
  if (editing) {
    return (
      <InlineInput
        initial={String(value)}
        className={type === "string" ? "text-emerald-300" : "text-amber-300"}
        onCancel={() => setEditing(false)}
        onCommit={(t) => {
          setEditing(false);
          if (type === "number") {
            const n = Number(t);
            if (t.trim() === "" || !Number.isFinite(n)) return void toast.error(`“${t}” is not a number`);
            if (n !== value) ctx.commit(setAt(ctx.root, path, n));
          } else if (t !== value) {
            ctx.commit(setAt(ctx.root, path, t));
          }
        }}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Edit"
      className="min-w-0 rounded-sm text-left hover:bg-accent"
    >
      {shown}
    </button>
  );
}

function EntryMenu({ ctx, path, value }: { ctx: Ctx; path: JsonPath; value: Json }) {
  const type = typeOf(value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Entry actions" />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground">Type</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={type}
            onValueChange={(t) => t !== type && ctx.commit(setAt(ctx.root, path, convert(value, t as JsonType)))}
          >
            {TYPES.map((t) => (
              <DropdownMenuRadioItem key={t} value={t}>
                {t}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {path.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => ctx.commit(removeAt(ctx.root, path))}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
