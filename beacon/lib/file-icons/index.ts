// The file manager's icons (ADR-020): Atom Material Icons rules, generated into icons.generated.ts
// by scripts/file-icons.mjs. A rule is a regular expression over the file name — or over the path
// relative to the server root when the pattern looks at directories — and the first match wins,
// the rules being sorted best first at generation time. Answers are memoised: a name's icon never
// changes, and a large directory asks for thousands of them per render.
import { DEFAULT_ICONS, FILE_RULES, FOLDER_RULES, ICONS, type IconRule } from "./icons.generated";

interface Compiled {
  rule: IconRule;
  re: RegExp;
  /** The pattern mentions a slash: match it against the whole path, not the name. */
  onPath: boolean;
}

const compile = (rules: readonly IconRule[]): Compiled[] =>
  rules.map((rule) => ({ rule, re: new RegExp(rule.pattern), onPath: rule.pattern.includes("/") }));

const fileRules = compile(FILE_RULES);
const folderRules = compile(FOLDER_RULES);

const find = (rules: Compiled[], name: string, path: string) =>
  rules.find((c) => c.re.test(c.onPath ? path : name))?.rule;

/** The rule a file name (and its path, for path-aware rules) falls under, if any. */
export const fileIconRule = (name: string, path = name): IconRule | undefined => find(fileRules, name, path);

/** The rule a folder name falls under, if any. */
export const folderIconRule = (name: string): IconRule | undefined => find(folderRules, name, name);

const memo = new Map<string, string>();
const remember = (key: string, compute: () => string) => {
  let src = memo.get(key);
  if (src === undefined) {
    src = compute();
    memo.set(key, src);
  }
  return src;
};

/** SVG data URI for a file. */
export const fileIconSrc = (name: string, path = name): string =>
  remember(`f:${path}`, () => ICONS[fileIconRule(name, path)?.icon ?? DEFAULT_ICONS.file]);

/** SVG data URI for a folder, closed or open (the one whose contents are shown next to it). */
export const folderIconSrc = (name: string, open = false): string =>
  remember(`${open ? "o" : "d"}:${name}`, () => {
    const rule = folderIconRule(name);
    if (!rule) return ICONS[open ? DEFAULT_ICONS.folderOpen : DEFAULT_ICONS.folder];
    return ICONS[open && rule.open !== undefined ? rule.open : rule.icon];
  });
