/**
 * Mojang's Bedrock resource files are JSON with comments and trailing commas. Strings are matched
 * first so nothing inside them is touched; comments go, a comma before a closing bracket goes.
 */
export function parseJsonc<T = unknown>(text: string): T {
  return JSON.parse(
    text.replace(/("(?:\\.|[^"\\])*")|\/\/.*|\/\*[\s\S]*?\*\/|,(\s*[}\]])/g, (_, str, tail) => str ?? tail ?? ""),
  ) as T;
}
