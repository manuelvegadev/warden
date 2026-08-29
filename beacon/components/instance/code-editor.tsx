"use client";

import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { StreamLanguage } from "@codemirror/language";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { oneDark } from "@codemirror/theme-one-dark";
import CodeMirror, { EditorView, type Extension } from "@uiw/react-codemirror";

export type CodeLanguage = "properties" | "yaml" | "json" | "text";

/** Picks the editor language from a file name. */
export function languageFor(path: string): CodeLanguage {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "yml" || ext === "yaml") return "yaml";
  if (ext === "json") return "json";
  if (ext === "properties") return "properties";
  return "text";
}

const editorTheme = EditorView.theme({
  "&": { fontSize: "12px", backgroundColor: "#0a0a0a" },
  ".cm-gutters": { backgroundColor: "#0a0a0a", borderRight: "1px solid var(--border)" },
  ".cm-content, .cm-gutters": { fontFamily: "var(--font-console)", lineHeight: "var(--console-line-height)" },
  ".cm-scroller": { fontFamily: "var(--font-console)" },
});

// Stable references: react-codemirror reconfigures the editor whenever the extensions array identity changes.
const base: Extension[] = [editorTheme, EditorView.lineWrapping];
const SETUP = {
  folding: { foldGutter: true, highlightActiveLine: true },
  plain: { foldGutter: false, highlightActiveLine: true },
};
const EXTENSIONS: Record<CodeLanguage, Extension[]> = {
  properties: [StreamLanguage.define(properties), ...base],
  yaml: [yaml(), ...base],
  json: [json(), ...base],
  text: base,
};

/** CodeMirror with the panel's console font and dark theme; validation happens server-side on save. */
export function CodeEditor({
  value,
  onChange,
  language = "text",
  readOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  language?: CodeLanguage;
  readOnly?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-md border">
      <CodeMirror
        value={value}
        height="520px"
        theme={oneDark}
        extensions={EXTENSIONS[language]}
        basicSetup={language === "yaml" || language === "json" ? SETUP.folding : SETUP.plain}
        onChange={onChange}
        readOnly={readOnly}
      />
    </div>
  );
}
