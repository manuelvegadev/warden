// Which editor mode a file name gets. Kept apart from code-editor.tsx, which pulls in CodeMirror
// and every language package: callers that only need the name → mode decision (to pass it to a
// lazily loaded editor) must not drag the editor into their bundle.

export type CodeLanguage =
  | "properties"
  | "yaml"
  | "json"
  | "toml"
  | "shell"
  | "markdown"
  | "xml"
  | "javascript"
  | "sql"
  | "text";

const BY_EXTENSION: Record<string, CodeLanguage> = {
  yml: "yaml",
  yaml: "yaml",
  json: "json",
  json5: "json",
  mcmeta: "json",
  properties: "properties",
  // INI-style files: sections and key=value, which the properties mode reads.
  ini: "properties",
  cfg: "properties",
  conf: "properties",
  toml: "toml",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  md: "markdown",
  markdown: "markdown",
  xml: "xml",
  svg: "xml",
  html: "xml",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  sql: "sql",
};

/** Picks the editor language from a file name; anything unknown is plain text. */
export function languageFor(path: string): CodeLanguage {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return BY_EXTENSION[ext] ?? "text";
}
