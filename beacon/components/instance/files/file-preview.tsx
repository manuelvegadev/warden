"use client";

import { Button } from "@warden/ui/components/button";
import { cn } from "@warden/ui/lib/utils";
import { ArrowLeft, Download, Pencil, Trash2, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { languageFor } from "@/components/instance/code-language";
import { DetachControls } from "@/components/instance/detach-controls";
import { FileIcon } from "@/components/instance/files/file-icon";
import { CopyButton, SaveBar } from "@/components/instance/section-card";
import { useDetachable } from "@/hooks/use-detachable";
import { useTextDraft } from "@/hooks/use-text-draft";
import { useUnsavedWarning } from "@/hooks/use-unsaved-warning";
import { FS_EDIT_LIMIT, type FsContent, type FsEntry, formatBytes, fs } from "@/lib/api";
import { formatDateTime, mono } from "@/lib/utils";

// CodeMirror is heavy; load it with the section, not with the app shell.
const CodeEditor = dynamic(() => import("../code-editor").then((m) => m.CodeEditor), {
  ssr: false,
  loading: () => <Loading />,
});

/**
 * The last column of the browser: what the chosen file is, and the file itself — an editor for
 * text, the picture for an image, a download for anything else. Mounted with the path as its key,
 * so a different file is a fresh instance. Detachable like the console: full screen, or its own
 * window (`popout` is set by that window's route).
 */
export function FilePreview({
  id,
  path,
  entry,
  running,
  canManage,
  onClose,
  onRename,
  onDelete,
  onSaved,
  fullScreen,
  popout,
}: {
  id: string;
  path: string;
  entry: FsEntry;
  running: boolean;
  canManage: boolean;
  /** Filling the screen (phones): a back arrow leads the header instead of a close cross on the right. */
  fullScreen?: boolean;
  /** Its own browser window: no way back, no rename or delete (the listing is not there to refresh). */
  popout?: boolean;
  onClose?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  /** After a save, so the listing (size, modified) catches up. */
  onSaved?: () => void;
}) {
  // The daemon keeps the server jar and the agent read-only; the editor must say so, not the caller.
  const editable = canManage && !entry.protected;
  const [content, setContent] = useState<FsContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const detach = useDetachable(`/file/${id}?path=${encodeURIComponent(path)}`, `file-${id}-${path}`, popout);

  useEffect(() => {
    let cancelled = false;
    fs.read(id, path, entry.size)
      .then((c) => !cancelled && setContent(c))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id, path, entry.size]);

  return (
    <div ref={detach.rootRef} className={cn("flex h-full min-w-0 flex-col", detach.fullscreen && "bg-background")}>
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        {fullScreen && onClose && (
          <Button variant="ghost" size="icon-sm" aria-label="Back to the folder" title="Back" onClick={onClose}>
            <ArrowLeft className="size-4" />
          </Button>
        )}
        <FileIcon name={entry.name} dir={false} path={path} className="size-8" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <h3 className={`${mono} truncate text-sm font-medium`} title={entry.name}>
              {entry.name}
            </h3>
            <CopyButton value={path} label="Copy path" className="size-6 text-muted-foreground" />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {formatBytes(entry.size)} · {formatDateTime(entry.modifiedAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Download"
            title="Download"
            render={<a href={fs.downloadUrl(id, path)} download={entry.name} />}
            nativeButton={false}
          >
            <Download className="size-4" />
          </Button>
          {editable && onRename && onDelete && (
            <>
              <Button variant="ghost" size="icon-sm" aria-label="Rename" title="Rename" onClick={onRename}>
                <Pencil className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete"
                title="Delete"
                className="text-destructive hover:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="size-4" />
              </Button>
            </>
          )}
          {/* A phone already gives the file the whole screen; a pop-up window there is a tab. */}
          {!fullScreen && (
            <DetachControls
              fullscreen={detach.fullscreen}
              showPopout={detach.showPopout}
              onPopout={detach.openPopout}
              onToggleFullscreen={detach.toggleFullscreen}
              label="file"
            />
          )}
          {!fullScreen && onClose && (
            <Button variant="ghost" size="icon-sm" aria-label="Close preview" title="Close" onClick={onClose}>
              <X className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {error && <p className="px-4 py-3 text-sm text-destructive">{error}</p>}
      {!error && content === null && <Loading />}
      {content?.kind === "text" && content.text !== undefined && (
        <TextDraft
          id={id}
          path={path}
          initial={content.text}
          running={running}
          canManage={editable}
          onSaved={onSaved}
        />
      )}
      {content?.kind === "text" && content.text === undefined && (
        <Notice>
          This file is {formatBytes(content.size)}, more than the {formatBytes(FS_EDIT_LIMIT)} the editor opens.
          Download it to read it.
        </Notice>
      )}
      {content?.kind === "image" && (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-[size:12px_12px] p-4">
          {/* biome-ignore lint/performance/noImgElement: a file served by the daemon, not a static asset */}
          <img
            src={fs.contentUrl(id, path)}
            alt={entry.name}
            className="max-h-full max-w-full [image-rendering:pixelated]"
          />
        </div>
      )}
      {content?.kind === "binary" && <Notice>Not a text file. Download it to open it with something else.</Notice>}
    </div>
  );
}

const Loading = () => <p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>;

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <p className="max-w-xs text-center text-sm text-muted-foreground text-balance">{children}</p>
    </div>
  );
}

/** Editor plus save bar for one text file; the first load reuses the text the preview already fetched. */
function TextDraft({
  id,
  path,
  initial,
  running,
  canManage,
  onSaved,
}: {
  id: string;
  path: string;
  initial: string;
  running: boolean;
  canManage: boolean;
  onSaved?: () => void;
}) {
  const cached = useRef<string | null>(initial);
  const load = useCallback(async () => {
    if (cached.current !== null) {
      const text = cached.current;
      cached.current = null;
      return text;
    }
    return (await fs.read(id, path)).text ?? "";
  }, [id, path]);
  const write = useCallback((text: string) => fs.write(id, path, text), [id, path]);
  const draft = useTextDraft(load, write);
  useUnsavedWarning(draft.dirty);

  if (draft.original === null) return <Loading />;
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col p-3">
        <CodeEditor
          value={draft.text}
          onChange={draft.setText}
          language={languageFor(path)}
          readOnly={!canManage}
          height="100%"
          className="min-h-0 flex-1"
        />
      </div>
      {canManage && (
        <SaveBar
          dirty={draft.dirty}
          pending={draft.pending}
          hint={
            draft.dirty
              ? "Unsaved changes"
              : running
                ? "The server reads most files at startup: changes apply on the next start."
                : undefined
          }
          onDiscard={draft.discard}
          onReload={draft.reload}
          onSave={async () => {
            if (await draft.save()) onSaved?.();
          }}
        />
      )}
    </>
  );
}
