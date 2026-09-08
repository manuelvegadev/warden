"use client";

import { Button } from "@warden/ui/components/button";
import { Dialog, DialogContent } from "@warden/ui/components/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@warden/ui/components/input-group";
import { useIsMobile } from "@warden/ui/hooks/use-mobile";
import { FilePlus2, FolderPlus, RefreshCw, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { COLUMN_WIDTH, FileColumn } from "@/components/instance/files/file-column";
import { FilePreview } from "@/components/instance/files/file-preview";
import { NameDialog } from "@/components/instance/files/name-dialog";
import { type Upload as UploadItem, UploadStatus } from "@/components/instance/files/upload-status";
import { useFileBrowser } from "@/components/instance/files/use-file-browser";
import { ApiError, type FsEntry, fs } from "@/lib/api";
import { joinPath, normalizePath, parentPath } from "@/lib/fs-path";
import { mono } from "@/lib/utils";

/** The preview never gets narrower than this, whatever the strip's width leaves next to a column. */
const PREVIEW_MIN_WIDTH = 420;

type Prompt =
  | { kind: "folder"; dir: string }
  | { kind: "file"; dir: string }
  | { kind: "rename"; dir: string; entry: FsEntry };

/** What the name dialog asks for each kind of prompt. */
function promptSpec(prompt: Prompt) {
  if (prompt.kind === "rename") {
    return {
      title: `Rename ${prompt.entry.dir ? "folder" : "file"}`,
      submitLabel: "Rename",
      initial: prompt.entry.name,
      selectStem: !prompt.entry.dir,
    };
  }
  return {
    title: prompt.kind === "folder" ? "New folder" : "New file",
    description: `In server/${prompt.dir}`,
    submitLabel: "Create",
  };
}

/**
 * The server directory, Finder-style (ADR-020): a column per open directory, the chosen file in a
 * pane on the right — an editor when it is text. A manager can add, upload, rename and delete;
 * files dropped on a column land in that directory.
 */
export function FileManager({ id, running, canManage }: { id: string; running: boolean; canManage: boolean }) {
  // No padding of its own: the shell's `page-pad` already gutters the section on all four sides.
  const { columns, file, open, choose, deselect, refresh } = useFileBrowser(id);
  // A phone has room for one level: the open directory, full width, with a way back up; a chosen
  // file then covers the screen like a modal. Wider screens get the columns.
  const mobile = useIsMobile();
  const last = columns[columns.length - 1];
  const activeDir = last?.path ?? "";
  const fileEntry = file ? last?.listing?.entries.find((e) => e.name === last.selected) : undefined;
  const fileDir = file ? parentPath(file) : "";

  // ---- Path bar: follows the columns, but not while being typed in.
  const [pathInput, setPathInput] = useState("");
  const [editingPath, setEditingPath] = useState(false);
  useEffect(() => {
    if (!editingPath) setPathInput(file ?? activeDir);
  }, [activeDir, file, editingPath]);

  // ---- Two levels in view, Finder-style: every step down scrolls the strip so the open directory
  // and its parent are what is on screen (the parent and the file when one is chosen), the levels
  // above them off to the left. The strip must be scrollable even when every column would fit,
  // so a spacer — or the preview, sized to the same end — pads the strip to the width that puts
  // the last two levels at its left edge. The first placement is instant, the rest slide.
  const stripRef = useRef<HTMLDivElement>(null);
  const [stripWidth, setStripWidth] = useState(0);
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStripWidth(el.clientWidth));
    ro.observe(el);
    setStripWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const placed = useRef(false);
  const measured = stripWidth > 0;
  useEffect(() => {
    const el = stripRef.current;
    if (!el || !measured || mobile) return;
    const levels = columns.length + (file ? 1 : 0);
    el.scrollTo({ left: Math.max(0, (levels - 2) * COLUMN_WIDTH), behavior: placed.current ? "smooth" : "instant" });
    placed.current = true;
  }, [columns.length, file, measured, mobile]);
  const spacerWidth = Math.max(0, stripWidth - 2 * COLUMN_WIDTH);
  const previewWidth = Math.max(PREVIEW_MIN_WIDTH, stripWidth - COLUMN_WIDTH);

  // ---- Mutations
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [removing, setRemoving] = useState<{ dir: string; entry: FsEntry } | null>(null);
  const promptTaken = prompt
    ? (columns.find((c) => c.path === prompt.dir)?.listing?.entries.map((e) => e.name) ?? [])
    : [];

  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : "Something went wrong");

  const submitName = async (name: string) => {
    if (!prompt) return;
    const { dir } = prompt;
    setPrompt(null);
    try {
      if (prompt.kind === "folder") {
        const { entry } = await fs.mkdir(id, joinPath(dir, name));
        refresh(dir);
        choose(dir, entry);
      } else if (prompt.kind === "file") {
        await fs.write(id, joinPath(dir, name), "");
        refresh(dir);
        choose(dir, { name, dir: false, size: 0, modifiedAt: new Date().toISOString() });
      } else {
        await fs.rename(id, joinPath(dir, prompt.entry.name), joinPath(dir, name));
        refresh(dir);
        const wasChosen = columns.find((c) => c.path === dir)?.selected === prompt.entry.name;
        if (wasChosen) choose(dir, { ...prompt.entry, name });
      }
    } catch (e) {
      fail(e);
    }
  };

  const confirmDelete = async () => {
    if (!removing) return;
    const { dir, entry } = removing;
    setRemoving(null);
    try {
      await fs.remove(id, joinPath(dir, entry.name));
      toast.success(`Deleted ${entry.name}`);
      // A chosen entry leaves with its preview or its column; the listing it was in is re-read.
      if (columns.find((c) => c.path === dir)?.selected === entry.name) open(dir);
      refresh(dir);
    } catch (e) {
      fail(e);
    }
  };

  // ---- Uploads: one request per file, progress per file, a question before replacing anything.
  // A finished upload lingers a moment in the status list, longer when it failed.
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [conflicts, setConflicts] = useState<{ dir: string; file: File }[]>([]);

  const upload = useCallback(
    async (dir: string, f: File, overwrite = false) => {
      const uid = crypto.randomUUID();
      const patch = (p: Partial<UploadItem>) => setUploads((u) => u.map((x) => (x.id === uid ? { ...x, ...p } : x)));
      const dismiss = (after: number) => setTimeout(() => setUploads((u) => u.filter((x) => x.id !== uid)), after);
      setUploads((u) => [...u, { id: uid, name: f.name, dir, sent: 0, total: f.size, done: false, error: null }]);
      try {
        await fs.upload(id, dir, f, { overwrite, onProgress: (sent, total) => patch({ sent, total }) });
        patch({ done: true });
        dismiss(3000);
        refresh(dir);
      } catch (e) {
        if (e instanceof ApiError && e.code === "exists" && !overwrite) {
          dismiss(0);
          setConflicts((c) => [...c, { dir, file: f }]);
        } else {
          patch({ done: true, error: e instanceof Error ? e.message : "Upload failed" });
          dismiss(8000);
        }
      }
    },
    [id, refresh],
  );
  const uploadAll = useCallback(
    (dir: string, files: FileList | File[]) => {
      for (const f of Array.from(files)) void upload(dir, f);
    },
    [upload],
  );

  const pickFiles = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = () => input.files && uploadAll(activeDir, input.files);
    input.click();
  };

  const conflict = conflicts[0];
  const resolveConflict = (replace: boolean) => {
    setConflicts((c) => c.slice(1));
    if (replace && conflict) void upload(conflict.dir, conflict.file, true);
  };

  // Stable handlers keep the memoised columns from re-rendering on every keystroke or progress tick.
  const onRename = useCallback((dir: string, entry: FsEntry) => setPrompt({ kind: "rename", dir, entry }), []);
  const onDelete = useCallback((dir: string, entry: FsEntry) => setRemoving({ dir, entry }), []);
  const onBack = useCallback((dir: string) => open(parentPath(dir)), [open]);
  const downloadUrl = useCallback((path: string) => fs.downloadUrl(id, path), [id]);

  const preview = (fullScreen: boolean) =>
    file && fileEntry ? (
      <FilePreview
        key={file}
        id={id}
        path={file}
        entry={fileEntry}
        running={running}
        canManage={canManage}
        fullScreen={fullScreen}
        onClose={deselect}
        onRename={() => onRename(fileDir, fileEntry)}
        onDelete={() => onDelete(fileDir, fileEntry)}
        onSaved={() => refresh(fileDir)}
      />
    ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="min-w-64 flex-1">
          <InputGroupAddon>
            <InputGroupText className={mono}>server/</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onFocus={() => setEditingPath(true)}
            onBlur={() => setEditingPath(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                open(normalizePath(pathInput));
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                setPathInput(file ?? activeDir);
                e.currentTarget.blur();
              }
            }}
            spellCheck={false}
            aria-label="Path"
            className={`${mono} text-xs`}
          />
        </InputGroup>
        <Button variant="outline" size="icon" aria-label="Refresh" title="Refresh" onClick={() => refresh(activeDir)}>
          <RefreshCw className="size-4" />
        </Button>
        {canManage && (
          <>
            <Button
              variant="outline"
              size="sm"
              title="New folder"
              onClick={() => setPrompt({ kind: "folder", dir: activeDir })}
            >
              <FolderPlus className="size-4" /> <span className="hidden sm:inline">New folder</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              title="New file"
              onClick={() => setPrompt({ kind: "file", dir: activeDir })}
            >
              <FilePlus2 className="size-4" /> <span className="hidden sm:inline">New file</span>
            </Button>
            <Button variant="outline" size="sm" title="Upload" onClick={pickFiles} disabled={!last?.listing}>
              <Upload className="size-4" /> <span className="hidden sm:inline">Upload</span>
            </Button>
          </>
        )}
      </div>

      <UploadStatus uploads={uploads} />

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border">
        <div ref={stripRef} data-strip className="flex h-full min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          {(mobile ? columns.slice(-1) : columns).map((col) => (
            <FileColumn
              key={col.path}
              index={columns.indexOf(col)}
              column={col}
              canManage={canManage}
              fluid={mobile}
              onBack={mobile && col.path !== "" ? onBack : undefined}
              onChoose={choose}
              onRename={onRename}
              onDelete={onDelete}
              onDrop={uploadAll}
              downloadUrl={downloadUrl}
            />
          ))}
          {/* The last level: the file itself, or the padding that lets the last two columns lead. */}
          {file && fileEntry && !mobile ? (
            <div className="shrink-0" style={{ width: previewWidth }}>
              {preview(false)}
            </div>
          ) : (
            !mobile && <div aria-hidden className="shrink-0" style={{ width: spacerWidth }} />
          )}
        </div>
      </div>

      {/* On a phone the file covers the page, header to save bar, until the back arrow. */}
      {mobile && (
        <Dialog open={Boolean(file && fileEntry)} onOpenChange={(o) => !o && deselect()}>
          <DialogContent
            showCloseButton={false}
            aria-label={fileEntry?.name}
            className="top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 sm:max-w-none"
          >
            {preview(true)}
          </DialogContent>
        </Dialog>
      )}

      <NameDialog
        open={prompt && promptSpec(prompt)}
        taken={promptTaken}
        onClose={() => setPrompt(null)}
        onSubmit={submitName}
      />

      <ConfirmDialog
        open={removing !== null}
        title={`Delete ${removing?.entry.dir ? "folder" : "file"}`}
        description={
          <>
            <code className="text-xs">{removing?.entry.name}</code>
            {removing?.entry.dir && " and everything inside it"} will be removed. This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
        onClose={() => setRemoving(null)}
      />

      <ConfirmDialog
        open={conflict !== undefined}
        title="Replace file?"
        description={
          <>
            <code className="text-xs">{conflict?.file.name}</code> already exists in{" "}
            <code className="text-xs">server/{conflict?.dir}</code>. Replace it with the one you are uploading?
          </>
        }
        confirmLabel="Replace"
        destructive
        onConfirm={() => resolveConflict(true)}
        onClose={() => resolveConflict(false)}
      />
    </div>
  );
}
