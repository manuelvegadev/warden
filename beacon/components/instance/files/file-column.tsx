"use client";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@warden/ui/components/context-menu";
import { Skeleton } from "@warden/ui/components/skeleton";
import { cn } from "@warden/ui/lib/utils";
import { ChevronLeft, ChevronRight, Download, FolderOpen, Link2, Pencil, Trash2 } from "lucide-react";
import { type KeyboardEvent, type MouseEvent, memo, useEffect, useRef } from "react";
import { FileIcon } from "@/components/instance/files/file-icon";
import type { Column } from "@/components/instance/files/use-file-browser";
import { useDropZone } from "@/hooks/use-drop-zone";
import { type FsEntry, formatBytes } from "@/lib/api";
import { baseName, joinPath } from "@/lib/fs-path";
import { mono } from "@/lib/utils";

/** The column width; the container scrolls the strip to keep the newest columns in view. */
export const COLUMN_WIDTH = 240;

/** A phone's column: most of the strip, so the parent peeks in at the left edge. */
const MOBILE_COLUMN_WIDTH = "min(85%, 22rem)";

/**
 * One Miller column: the entries of a directory, the chosen one highlighted, a context menu per
 * entry, and files dropped on it uploaded into it. Up/Down move the choice; Left/Right cross to
 * the chosen entry of the previous column or the first entry of the next. Memoised: a large
 * directory must not re-render for every keystroke in the path bar or upload progress tick.
 */
export const FileColumn = memo(function FileColumn({
  index,
  column,
  canManage,
  onChoose,
  onRename,
  onDelete,
  onDrop,
  downloadUrl,
  mobile,
  onBack,
}: {
  index: number;
  column: Column;
  canManage: boolean;
  /** A phone's column: wider, snapping in the strip, with rows sized for a finger. */
  mobile?: boolean;
  /** Shown as a back chevron in the header: go up from this directory (the last column on a phone). */
  onBack?: (dir: string) => void;
  onChoose: (columnPath: string, entry: FsEntry) => void;
  onRename: (dir: string, entry: FsEntry) => void;
  onDelete: (dir: string, entry: FsEntry) => void;
  onDrop: (dir: string, files: FileList) => void;
  downloadUrl: (path: string) => string;
}) {
  const drop = useDropZone(canManage, (files) => onDrop(column.path, files));
  const entries = column.listing?.entries ?? [];
  const title = baseName(column.path) || "server";

  // The chosen entry stays in view when the listing arrives or the choice changes — a typed path
  // or a deep link can choose a row far down. The listbox is scrolled by hand: `scrollIntoView`
  // would also scroll the strip sideways, and the page.
  const listRef = useRef<HTMLDivElement>(null);
  const loaded = column.listing !== null;
  useEffect(() => {
    const list = listRef.current;
    if (!list || !loaded || !column.selected) return;
    const row = list.querySelector<HTMLElement>('button[data-entry][aria-selected="true"]');
    if (!row) return;
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
  }, [loaded, column.selected]);

  // On a phone a tap on a column the strip shows only in part brings it into view instead of
  // choosing the row under the finger, which would close every column after it.
  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    if (!mobile) return;
    const strip = e.currentTarget.closest("[data-strip]");
    if (!strip) return;
    const col = e.currentTarget.getBoundingClientRect();
    const view = strip.getBoundingClientRect();
    if (col.left >= view.left - 1 && col.right <= view.right + 1) return;
    e.preventDefault();
    e.stopPropagation();
    strip.scrollBy({ left: col.left < view.left ? col.left - view.left : col.right - view.right, behavior: "smooth" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-entry]"));
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = buttons[at + (e.key === "ArrowDown" ? 1 : -1)];
      if (!next) return;
      e.preventDefault();
      next.focus();
      const entry = entries.find((x) => x.name === next.dataset.entry);
      if (entry) onChoose(column.path, entry);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const strip = e.currentTarget.closest("[data-strip]");
      const to = strip?.querySelector<HTMLElement>(`[data-column="${index + (e.key === "ArrowRight" ? 1 : -1)}"]`);
      if (!to) return;
      e.preventDefault();
      const chosen = to.querySelector<HTMLButtonElement>('button[data-entry][aria-selected="true"]');
      const target = chosen ?? to.querySelector<HTMLButtonElement>("button[data-entry]");
      target?.focus();
      if (!chosen) target?.click();
    }
  };

  return (
    <div
      data-column={index}
      className={cn(
        "relative flex h-full shrink-0 flex-col border-r transition-colors",
        mobile && "snap-end",
        drop.over && "bg-primary/5",
      )}
      style={{ width: mobile ? MOBILE_COLUMN_WIDTH : COLUMN_WIDTH }}
      onClickCapture={onClickCapture}
      {...drop.handlers}
    >
      <div className={cn("flex shrink-0 items-center gap-1.5 border-b bg-muted/30 px-3", mobile ? "h-11" : "h-8")}>
        {onBack && (
          <button
            type="button"
            aria-label="Up one level"
            title="Up one level"
            onClick={() => onBack(column.path)}
            className={cn(
              "-ml-1.5 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
              mobile ? "size-9" : "size-6",
            )}
          >
            <ChevronLeft className="size-4" />
          </button>
        )}
        <FileIcon name={title} dir open className="size-3.5" />
        <span className={`${mono} truncate text-xs text-muted-foreground`}>{title}</span>
        {column.listing && (
          <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">{entries.length}</span>
        )}
      </div>
      <div
        ref={listRef}
        role="listbox"
        tabIndex={-1}
        className="relative min-h-0 flex-1 overflow-y-auto py-1"
        onKeyDown={onKeyDown}
      >
        {column.listing === null && column.error === null && (
          <div className="grid gap-1 px-2 py-1">
            {Array.from({ length: 6 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        )}
        {column.error && <p className="px-3 py-2 text-xs text-destructive">{column.error}</p>}
        {column.listing && entries.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted-foreground italic">Empty folder</p>
        )}
        {entries.map((entry) => {
          const path = joinPath(column.path, entry.name);
          const selected = column.selected === entry.name;
          return (
            <ContextMenu key={entry.name}>
              <ContextMenuTrigger>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-entry={entry.name}
                  title={entry.dir ? entry.name : `${entry.name} · ${formatBytes(entry.size)}`}
                  onClick={() => onChoose(column.path, entry)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1 text-left text-sm outline-none",
                    "hover:bg-accent/50 focus-visible:bg-accent/50",
                    // A long press opens the entry's menu, not the text-selection callout.
                    mobile && "py-2.5 select-none [-webkit-touch-callout:none]",
                    selected && "bg-accent hover:bg-accent",
                  )}
                >
                  <FileIcon name={entry.name} dir={entry.dir} path={path} open={selected && entry.dir} />
                  <span className={`${mono} min-w-0 flex-1 truncate text-xs`}>{entry.name}</span>
                  {entry.symlink && <Link2 className="size-3 shrink-0 text-muted-foreground" aria-hidden />}
                  {entry.dir && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                {entry.dir ? (
                  <ContextMenuItem onClick={() => onChoose(column.path, entry)}>
                    <FolderOpen /> Open
                  </ContextMenuItem>
                ) : (
                  <ContextMenuItem
                    render={<a href={downloadUrl(path)} download={entry.name} />}
                    closeOnClick
                    nativeButton={false}
                  >
                    <Download /> Download
                  </ContextMenuItem>
                )}
                {canManage && !entry.protected && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => onRename(column.path, entry)}>
                      <Pencil /> Rename…
                    </ContextMenuItem>
                    <ContextMenuItem variant="destructive" onClick={() => onDelete(column.path, entry)}>
                      <Trash2 /> Delete…
                    </ContextMenuItem>
                  </>
                )}
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
      {drop.over && (
        <div className="pointer-events-none absolute inset-1 flex items-center justify-center rounded-md border-2 border-dashed border-primary/40 bg-background/60">
          <span className="text-xs font-medium text-primary">Drop to upload into {title}</span>
        </div>
      )}
    </div>
  );
});
