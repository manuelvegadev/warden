"use client";

import { StreamLanguage } from "@codemirror/language";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { oneDark } from "@codemirror/theme-one-dark";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { instances } from "@/lib/api";

const propertiesLang = StreamLanguage.define(properties);
const editorTheme = EditorView.theme({
  "&": { fontSize: "12px", backgroundColor: "#0a0a0a" },
  ".cm-gutters": { backgroundColor: "#0a0a0a", borderRight: "1px solid var(--border)" },
  ".cm-content, .cm-gutters": { fontFamily: "var(--font-console)", lineHeight: "var(--console-line-height)" },
  ".cm-scroller": { fontFamily: "var(--font-console)" },
});
// Stable reference: react-codemirror reconfigures the editor whenever this array identity changes.
const extensions = [propertiesLang, editorTheme, EditorView.lineWrapping];

/** Plain-text server.properties editor (CodeMirror). Validation happens in the daemon on save. */
export function PropertiesRawEditor({ id, running, onSaved }: { id: string; running: boolean; onSaved: () => void }) {
  const [original, setOriginal] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);

  const load = useCallback(
    () =>
      instances
        .propertiesRaw(id)
        .then((t) => {
          setOriginal(t);
          setText(t);
        })
        .catch((e) => toast.error(e.message)),
    [id],
  );
  useEffect(() => {
    load();
  }, [load]);

  const dirty = original !== null && text !== original;

  async function save() {
    setPending(true);
    try {
      const { restartRequired } = await instances.updatePropertiesRaw(id, text);
      toast.success(restartRequired ? "Saved — restart the server to apply" : "Saved");
      setOriginal(text);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setPending(false);
    }
  }

  if (original === null) return <p className="py-4 text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="grid gap-3">
      <div className="overflow-hidden rounded-md border">
        <CodeMirror
          value={text}
          height="520px"
          theme={oneDark}
          extensions={extensions}
          basicSetup={{ foldGutter: false, highlightActiveLine: true }}
          onChange={setText}
        />
      </div>
      {running && (
        <p className="text-xs text-muted-foreground">
          The server is running: changes apply on the next start. wardend re-applies this file after the server rewrites
          it on stop.
        </p>
      )}
      <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur">
        {dirty && (
          <Button variant="ghost" onClick={() => setText(original)}>
            Discard
          </Button>
        )}
        <Button variant="outline" onClick={load} disabled={pending}>
          Reload
        </Button>
        <Button onClick={save} disabled={!dirty || pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
