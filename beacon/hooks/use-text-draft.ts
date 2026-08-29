"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * Load/edit/save cycle for a text document: `original` is the last loaded or saved content,
 * `dirty` compares against it. `write` returns whether a restart is needed (toast wording).
 */
export function useTextDraft(
  load: () => Promise<string>,
  write: (text: string) => Promise<{ restartRequired: boolean }>,
) {
  const [original, setOriginal] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);

  const reload = useCallback(() => {
    setOriginal(null);
    load()
      .then((t) => {
        setOriginal(t);
        setText(t);
      })
      .catch((e) => toast.error(e.message));
  }, [load]);
  useEffect(() => {
    reload();
  }, [reload]);

  const dirty = original !== null && text !== original;

  async function save(): Promise<boolean> {
    setPending(true);
    try {
      const { restartRequired } = await write(text);
      toast.success(restartRequired ? "Saved — restart the server to apply" : "Saved");
      setOriginal(text);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
      return false;
    } finally {
      setPending(false);
    }
  }

  return {
    original,
    text,
    setText,
    dirty,
    pending,
    reload,
    save,
    discard: () => original !== null && setText(original),
  };
}
