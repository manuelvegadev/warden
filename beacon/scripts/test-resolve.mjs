// Resolver for `node --test`: maps the `@/` tsconfig alias to the beacon root and adds the
// extension to relative imports of .ts/.tsx files, so tests run on the sources without a bundler.
//   node --import ./scripts/test-resolve.mjs --test "lib/**/*.test.ts"
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const hooks = `
  const root = ${JSON.stringify(root)};
  const { existsSync } = await import("node:fs");
  const { pathToFileURL, fileURLToPath } = await import("node:url");
  const { join } = await import("node:path");
  const withExt = (p) => [p, p + ".ts", p + ".tsx", p + ".json", join(p, "index.ts")].find((c) => existsSync(c));
  export async function resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) {
      const hit = withExt(join(root, specifier.slice(2)));
      if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const hit = withExt(join(fileURLToPath(context.parentURL), "..", specifier));
      if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
    }
    return next(specifier, context);
  }
`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`, pathToFileURL(root));
