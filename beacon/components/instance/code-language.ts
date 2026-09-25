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

/**
 * What a file is, for line wrapping: a log or a data file reads by column and wants long lines to
 * scroll sideways; prose and configuration read better wrapped. Each kind remembers its own choice.
 */
export type WrapKind = "log" | "data" | "text";

const DATA_EXTENSIONS = new Set(["json", "json5", "mcmeta", "csv", "tsv", "sql", "xml", "svg", "html"]);

export function wrapKindFor(path: string): WrapKind {
  const lower = path.toLowerCase();
  if (/\.log(\.\d+)?$/.test(lower) || /(^|\/)(logs|crash-reports)\//.test(lower)) return "log";
  return DATA_EXTENSIONS.has(lower.slice(lower.lastIndexOf(".") + 1)) ? "data" : "text";
}

/** Picks the editor language from a file name; anything unknown is plain text. */
export function languageFor(path: string): CodeLanguage {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return BY_EXTENSION[ext] ?? "text";
}
