"use client";

import { type WrapKind, wrapKindFor } from "@/components/instance/code-language";
import { useStoredFlag } from "@/hooks/use-stored-preference";

const WRAPS_BY_DEFAULT: Record<WrapKind, boolean> = { log: false, data: false, text: true };

/** Whether the editor wraps this file's long lines; remembered per kind of file (`wrapKindFor`). */
export function useEditorWrap(path: string) {
  const kind = wrapKindFor(path);
  return useStoredFlag(`beacon.editor.wrap.${kind}`, WRAPS_BY_DEFAULT[kind]);
}
