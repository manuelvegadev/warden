// Which richer view a file gets in the file manager, beside or instead of the text editor (ADR-020).
// Pure, so the rules can be pinned by tests; the components live in components/instance/files/views.

import type { FsKind } from "@/lib/api";

export type FileView = "log" | "eula" | "json" | "image" | "audio";

/** Logs, rotated logs (gzipped) and crash reports read in the log view. */
export const isLog = (path: string) => /\.log(\.gz)?$/i.test(path) || /(^|\/)crash-reports\/[^/]+\.txt$/i.test(path);

/** Rotated logs are gzipped: the view decompresses them, and they cannot be edited. */
export const isGzipped = (path: string) => /\.gz$/i.test(path);

/**
 * The view for a file, or null when the editor (or the download) is all there is. `path` is
 * relative to the server directory; `kind` is what the daemon serves it as. Every JSON file —
 * the server's lists included — gets the same JSON editor.
 */
export function viewFor(path: string, kind: FsKind): FileView | null {
  if (kind === "image") return "image";
  if (kind === "audio") return "audio";
  if (isLog(path)) return "log";
  if (kind !== "text") return null;
  if (path === "eula.txt") return "eula";
  if (/\.(json|mcmeta)$/i.test(path)) return "json";
  return null;
}
