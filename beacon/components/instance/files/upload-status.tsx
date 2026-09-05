"use client";

import { Progress } from "@warden/ui/components/progress";
import { Check, X } from "lucide-react";
import { formatBytes } from "@/lib/api";
import { mono } from "@/lib/utils";

export interface Upload {
  id: string;
  name: string;
  dir: string;
  sent: number;
  total: number;
  done: boolean;
  error: string | null;
}

/** The uploads in flight and the ones just finished (the manager drops those after a moment). */
export function UploadStatus({ uploads }: { uploads: Upload[] }) {
  if (uploads.length === 0) return null;
  return (
    <div className="grid gap-1.5">
      {uploads.map((u) => (
        <div key={u.id} className="flex items-center gap-3 rounded-md bg-muted px-3 py-1.5 text-xs">
          {u.done ? (
            u.error ? (
              <X className="size-3.5 shrink-0 text-destructive" aria-hidden />
            ) : (
              <Check className="size-3.5 shrink-0 text-emerald-500" aria-hidden />
            )
          ) : null}
          <span className={`${mono} min-w-0 flex-1 truncate`}>
            {u.dir ? `${u.dir}/` : ""}
            {u.name}
          </span>
          {!u.done && (
            <>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {formatBytes(u.sent)} / {formatBytes(u.total)}
              </span>
              <Progress value={u.total ? (u.sent / u.total) * 100 : 0} className="w-32" />
            </>
          )}
          {u.error && <span className="truncate text-destructive">{u.error}</span>}
        </div>
      ))}
    </div>
  );
}
