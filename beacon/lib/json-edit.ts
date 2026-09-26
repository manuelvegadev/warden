// Pure edits for the file manager's JSON editor: every change returns a new document, which is
// written back in the file's own indentation. Kept apart from the component so it can be tested.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
/** Keys and indices from the root to a value. */
export type JsonPath = (string | number)[];
export type JsonType = "string" | "number" | "boolean" | "null" | "object" | "array";

export const typeOf = (v: Json): JsonType =>
  v === null ? "null" : Array.isArray(v) ? "array" : (typeof v as "string" | "number" | "boolean" | "object");

/** The document with the value at `path` replaced (the root, for an empty path). */
export function setAt(root: Json, path: JsonPath, value: Json): Json {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(root)) {
    const copy = root.slice();
    copy[head as number] = setAt(root[head as number], rest, value);
    return copy;
  }
  const obj = root as { [key: string]: Json };
  return { ...obj, [head]: setAt(obj[head as string], rest, value) };
}

const getAt = (root: Json, path: JsonPath): Json =>
  path.reduce<Json>((v, k) => (Array.isArray(v) ? v[k as number] : (v as { [key: string]: Json })[k as string]), root);

/** The document without the entry at `path`. */
export function removeAt(root: Json, path: JsonPath): Json {
  const parent = path.slice(0, -1);
  const last = path[path.length - 1];
  const container = getAt(root, parent);
  if (Array.isArray(container))
    return setAt(
      root,
      parent,
      container.filter((_, i) => i !== last),
    );
  const { [last as string]: _, ...rest } = container as { [key: string]: Json };
  return setAt(root, parent, rest);
}

/** The document with a key of the object at `path` renamed, in its place. Null when the name is taken. */
export function renameKey(root: Json, path: JsonPath, from: string, to: string): Json | null {
  const obj = getAt(root, path) as { [key: string]: Json };
  if (from === to) return root;
  if (Object.hasOwn(obj, to)) return null;
  const renamed = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k === from ? to : k, v]));
  return setAt(root, path, renamed);
}

/** A key not in the object yet: `name`, then `name2`, `name3`… */
export function freeKey(obj: { [key: string]: Json }, name = "key"): string {
  if (!Object.hasOwn(obj, name)) return name;
  let n = 2;
  while (Object.hasOwn(obj, `${name}${n}`)) n++;
  return `${name}${n}`;
}

/** The document with an entry added to the container at `path`: at the end of an array, or under `key`. */
export function addTo(root: Json, path: JsonPath, value: Json, key?: string): Json {
  const container = getAt(root, path);
  if (Array.isArray(container)) return setAt(root, path, [...container, value]);
  return setAt(root, path, { ...(container as { [key: string]: Json }), [key ?? freeKey(container as never)]: value });
}

/** A value of another type, keeping what it can: "12" becomes 12, a number its text, and so on. */
export function convert(value: Json, to: JsonType): Json {
  switch (to) {
    case "string":
      return value === null || typeof value === "object" ? "" : String(value);
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }
    case "boolean":
      return value === true || value === "true";
    case "null":
      return null;
    case "object":
      return {};
    case "array":
      return [];
  }
}

/** The indentation the file uses: its first indented line's, two spaces for a flat file. */
export function detectIndent(text: string): string {
  const m = /\n([ \t]+)\S/.exec(text);
  return m ? m[1] : "  ";
}

/** The document as the file's text: its indentation, and its final newline if it had one. */
export function serialize(value: Json, original: string): string {
  return JSON.stringify(value, null, detectIndent(original)) + (original.endsWith("\n") ? "\n" : "");
}

/**
 * Whether the text holds an integer JavaScript cannot represent exactly (16 digits or more, outside
 * strings): a seed, a snowflake id. Parsing and writing it back would change it, so the visual
 * editor stays read-only for such a file.
 */
export const hasUnsafeNumbers = (text: string) => /-?\d{16,}/.test(text.replace(/"(?:\\.|[^"\\])*"/g, '""'));
