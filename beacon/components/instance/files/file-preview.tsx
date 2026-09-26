"use client";

import { Button } from "@warden/ui/components/button";
import { cn } from "@warden/ui/lib/utils";
import { ArrowLeft, Download, Eye, Pencil, PencilLine, Trash2, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { languageFor } from "@/components/instance/code-language";
import { DetachControls } from "@/components/instance/detach-controls";
import { FileIcon } from "@/components/instance/files/file-icon";
import { AudioPlayer } from "@/components/instance/files/views/audio-player";
import { EulaView } from "@/components/instance/files/views/eula-view";
import { ImageView } from "@/components/instance/files/views/image-view";
import { JsonEditor } from "@/components/instance/files/views/json-editor";
import { LogView } from "@/components/instance/files/views/log-view";
import { CopyButton, SaveBar } from "@/components/instance/section-card";
import { WrapToggle } from "@/components/instance/wrap-toggle";
import { useDetachable } from "@/hooks/use-detachable";
import { useEditorWrap } from "@/hooks/use-editor-wrap";
import { useTextDraft } from "@/hooks/use-text-draft";
import { useUnsavedWarning } from "@/hooks/use-unsaved-warning";
import { FS_EDIT_LIMIT, type FsContent, type FsEntry, formatBytes, fs } from "@/lib/api";
import { type FileView, isGzipped, viewFor } from "@/lib/file-views";
import { formatDateTime, mono } from "@/lib/utils";

// CodeMirror is heavy; load it with the section, not with the app shell.
const CodeEditor = dynamic(() => import("../code-editor").then((m) => m.CodeEditor), {
  ssr: false,
  loading: () => <Loading />,
});

type Mode = "view" | "edit";

/**
 * The last column of the browser: what the chosen file is, and the file itself — an editor for
 * text, and for the files that have one a richer view beside it (lib/file-views.ts: a log, JSON,
 * the EULA), a viewer for a picture, a player for a sound, a download for anything else. Mounted
 * with the path as its key, so a different file is a fresh instance. Detachable like the console:
 * full screen, or its own window (`popout` is set by that window's route).
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
  const [wrap, setWrap] = useEditorWrap(path);

  useEffect(() => {
    let cancelled = false;
    fs.read(id, path, entry.size)
      .then((c) => !cancelled && setContent(c))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id, path, entry.size]);

  const textual = content?.kind === "text" && content.text !== undefined;
  const view = content ? viewFor(path, content.kind) : null;
  // A view and the editor side by side when the file is both; a view alone when it cannot be
  // edited here (a gzipped log, a log over the limit, a picture, a sound).
  const toggles = view !== null && textual && !isGzipped(path);
  const [mode, setMode] = useState<Mode>("view");
  const showing: Mode = view === null || (toggles && mode === "edit") ? "edit" : "view";

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
          {toggles && (
            <fieldset className="mr-1 flex rounded-md border p-0.5">
              <legend className="sr-only">Show the file as</legend>
              {(
                [
                  ["view", Eye, "View"],
                  ["edit", PencilLine, "Text"],
                ] as const
              ).map(([m, Icon, label]) => (
                <Button
                  key={m}
                  size="sm"
                  variant={mode === m ? "secondary" : "ghost"}
                  className="h-7 gap-1.5 px-2"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                >
                  <Icon className="size-3.5" /> <span className="max-sm:hidden">{label}</span>
                </Button>
              ))}
            </fieldset>
          )}
          {textual && showing === "edit" && <WrapToggle wrap={wrap} onChange={setWrap} />}
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
      {content && textual && content.text !== undefined && (
        <TextFile
          id={id}
          path={path}
          size={content.size}
          initial={content.text}
          view={view}
          showing={showing}
          running={running}
          canManage={editable}
          wrap={wrap}
          onSaved={onSaved}
        />
      )}
      {/* Views of files the editor does not hold: a gzipped log, a log over the limit, a picture, a sound. */}
      {content && !textual && view === "log" && <LogView id={id} path={path} size={content.size} />}
      {view === "image" && (
        <ImageView id={id} path={path} src={fs.contentUrl(id, path)} name={entry.name} canManage={editable} />
      )}
      {content && view === "audio" && (
        <AudioPlayer src={fs.contentUrl(id, path)} name={entry.name} size={content.size} />
      )}
      {content?.kind === "text" && !textual && view === null && (
        <Notice>
          This file is {formatBytes(content.size)}, more than the {formatBytes(FS_EDIT_LIMIT)} the editor opens.
          Download it to read it.
        </Notice>
      )}
      {content?.kind === "binary" && view === null && (
        <Notice>Not a text file. Download it to open it with something else.</Notice>
      )}
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

/**
 * A text file: one draft, shown in the editor or in the file's view (the JSON editor edits the same
 * draft), and one save bar under both. The first load reuses the text the preview already fetched;
 * the editor stays mounted behind a view, so switching keeps its undo history.
 */
function TextFile({
  id,
  path,
  size,
  initial,
  view,
  showing,
  running,
  canManage,
  wrap,
  onSaved,
}: {
  id: string;
  path: string;
  size: number;
  initial: string;
  view: FileView | null;
  showing: Mode;
  running: boolean;
  canManage: boolean;
  wrap: boolean;
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
  const viewing = showing === "view";
  return (
    <>
      <div className={cn("flex min-h-0 flex-1 flex-col p-3", viewing && "hidden")}>
        <CodeEditor
          value={draft.text}
          onChange={draft.setText}
          language={languageFor(path)}
          readOnly={!canManage}
          height="100%"
          wrap={wrap}
          className="min-h-0 flex-1"
        />
      </div>
      {viewing && view === "json" && <JsonEditor text={draft.text} onChange={draft.setText} readOnly={!canManage} />}
      {viewing && view === "eula" && (
        <EulaView id={id} text={draft.original} canManage={canManage} onChanged={draft.reload} />
      )}
      {/* A log reads the file itself: its tail, and what the server appends. */}
      {viewing && view === "log" && <LogView id={id} path={path} size={size} />}
      {canManage && !(viewing && (view === "log" || view === "eula")) && (
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
