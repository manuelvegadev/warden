"use client";

import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { StreamLanguage } from "@codemirror/language";
import { javascript } from "@codemirror/legacy-modes/mode/javascript";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { xml } from "@codemirror/legacy-modes/mode/xml";
import CodeMirror, { EditorView, type Extension } from "@uiw/react-codemirror";
import { cn } from "@warden/ui/lib/utils";
import { editorTheme } from "@/components/instance/code-editor-theme";
import type { CodeLanguage } from "@/components/instance/code-language";

// The panel's code font (Google Sans Code, docs/design.md), a size and leading a notch above the
// console's: the console packs lines, an editor is read and written line by line.
const typography = EditorView.theme({
  "&": { fontSize: "13px" },
  ".cm-content, .cm-gutters": { fontFamily: "var(--font-console)", lineHeight: "1.6" },
  ".cm-content": { padding: "8px 0" },
  ".cm-gutters": { borderRight: "1px solid var(--border)", paddingRight: "2px" },
  ".cm-lineNumbers .cm-gutterElement": { paddingLeft: "12px", paddingRight: "8px" },
  ".cm-scroller": { fontFamily: "var(--font-console)" },
});

// Stable references: react-codemirror reconfigures the editor whenever the extensions array identity
// changes, so each language gets two fixed lists — wrapping and not — and the toggle swaps them.
const SETUP = {
  folding: { foldGutter: true, highlightActiveLine: true },
  plain: { foldGutter: false, highlightActiveLine: true },
};
/** Languages with a real parser, where folding by block makes sense. */
const FOLDING = new Set<CodeLanguage>(["yaml", "json", "markdown"]);
const LANGUAGES: Record<CodeLanguage, Extension[]> = {
  properties: [StreamLanguage.define(properties)],
  yaml: [yaml()],
  json: [json()],
  toml: [StreamLanguage.define(toml)],
  shell: [StreamLanguage.define(shell)],
  markdown: [markdown()],
  xml: [StreamLanguage.define(xml)],
  javascript: [StreamLanguage.define(javascript)],
  sql: [StreamLanguage.define(standardSQL)],
  text: [],
};
const withBase = (base: Extension[]) =>
  Object.fromEntries(Object.entries(LANGUAGES).map(([k, v]) => [k, [...v, ...base]])) as Record<
    CodeLanguage,
    Extension[]
  >;
const EXTENSIONS = { wrap: withBase([typography, EditorView.lineWrapping]), nowrap: withBase([typography]) };

/** CodeMirror with the panel's console font and a dark palette of its own; validation happens server-side on save. */
export function CodeEditor({
  value,
  onChange,
  language = "text",
  readOnly,
  height = "520px",
  wrap = true,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  language?: CodeLanguage;
  readOnly?: boolean;
  /** CSS height of the editor; "100%" fills a flex parent with a definite height. */
  height?: string;
  /** Wrap long lines; off, they scroll sideways. */
  wrap?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-md border", className)}>
      <CodeMirror
        value={value}
        height={height}
        className="h-full"
        theme={editorTheme}
        extensions={EXTENSIONS[wrap ? "wrap" : "nowrap"][language]}
        basicSetup={FOLDING.has(language) ? SETUP.folding : SETUP.plain}
        onChange={onChange}
        readOnly={readOnly}
      />
    </div>
  );
}
