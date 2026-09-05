// Paths as the file manager (ADR-020) and the daemon exchange them: slash-separated, relative to
// the server directory, "" for the root, never a leading or trailing slash.

export const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

export const parentPath = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Every directory on the way to `path`, root first: "a/b" → ["", "a", "a/b"]. */
export function ancestors(path: string): string[] {
  const out = [""];
  let current = "";
  for (const seg of path.split("/").filter(Boolean)) {
    current = joinPath(current, seg);
    out.push(current);
  }
  return out;
}

/** What a typed path means: backslashes, doubled and trailing slashes, "." and ".." are resolved. */
export function normalizePath(input: string): string {
  const parts: string[] = [];
  for (const seg of input.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/** A single file or folder name the panel may create: no separators, not the dot entries. */
export const isValidName = (name: string) =>
  name !== "" && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\\");
