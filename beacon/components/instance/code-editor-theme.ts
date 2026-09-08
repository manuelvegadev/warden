import { tags as t } from "@lezer/highlight";
import { createTheme } from "@uiw/codemirror-themes";

/**
 * The editor's palette: GitHub's dark-dimmed syntax colours, the ones people already read code in
 * on github.com, on the panel's own ground (the `--background` token, so the two cannot drift) so
 * the editor reads as part of the dark shadcn interface rather than another product's. The gutter
 * chrome lives in code-editor.tsx next to the typography.
 *
 * The files edited here are mostly configuration, so the groups follow those grammars: keys (YAML
 * `key:`, JSON property names, `.properties` and TOML left-hand sides), values (quoted strings,
 * YAML plain scalars, `.properties` right-hand sides), literals (numbers, booleans, null) and
 * comments. Code grammars (shell, JavaScript, SQL, XML) fall into the same buckets.
 */
export const editorTheme = createTheme({
  theme: "dark",
  settings: {
    background: "var(--background)",
    foreground: "#adbac7",
    caret: "var(--foreground)",
    selection: "rgba(255, 255, 255, 0.12)",
    selectionMatch: "rgba(255, 255, 255, 0.08)",
    lineHighlight: "rgba(255, 255, 255, 0.035)",
    gutterBackground: "var(--background)",
    gutterForeground: "#52525b",
    gutterActiveForeground: "var(--muted-foreground)",
  },
  styles: [
    { tag: t.comment, color: "#768390", fontStyle: "italic" },
    { tag: [t.propertyName, t.attributeName, t.definition(t.variableName)], color: "#8ddb8c" },
    { tag: [t.string, t.special(t.string), t.content, t.quote, t.attributeValue], color: "#96d0ff" },
    { tag: [t.number, t.bool, t.null, t.atom], color: "#6cb6ff" },
    { tag: [t.keyword, t.operatorKeyword, t.modifier], color: "#f47067" },
    { tag: [t.typeName, t.className, t.tagName], color: "#f69d50" },
    { tag: [t.function(t.variableName), t.labelName], color: "#dcbdfb" },
    { tag: [t.punctuation, t.separator, t.bracket, t.operator], color: "#768390" },
    { tag: t.heading, color: "#cdd9e5", fontWeight: "600" },
    { tag: t.link, color: "#6cb6ff", textDecoration: "underline" },
    { tag: t.invalid, color: "#f47067" },
  ],
});
