"use client";

import { useCallback } from "react";
import { CodeEditor } from "@/components/instance/code-editor";
import { SaveBar } from "@/components/instance/section-card";
import { Button } from "@/components/ui/button";
import { useTextDraft } from "@/hooks/use-text-draft";
import { instances } from "@/lib/api";

/** Plain-text server.properties editor (CodeMirror). Validation happens in the daemon on save. */
export function PropertiesRawEditor({ id, running, onSaved }: { id: string; running: boolean; onSaved: () => void }) {
  const load = useCallback(() => instances.propertiesRaw(id), [id]);
  const write = useCallback((t: string) => instances.updatePropertiesRaw(id, t), [id]);
  const draft = useTextDraft(load, write);

  if (draft.original === null) return <p className="py-4 text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="grid gap-3">
      <CodeEditor value={draft.text} onChange={draft.setText} language="properties" />
      {running && (
        <p className="text-xs text-muted-foreground">
          The server is running: changes apply on the next start. wardend re-applies this file after the server rewrites
          it on stop.
        </p>
      )}
      <SaveBar
        dirty={draft.dirty}
        pending={draft.pending}
        onDiscard={draft.discard}
        onSave={async () => (await draft.save()) && onSaved()}
      >
        <Button variant="outline" onClick={draft.reload} disabled={draft.pending}>
          Reload
        </Button>
      </SaveBar>
    </div>
  );
}
