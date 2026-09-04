// The game's block models, read from an extracted `assets/minecraft` tree: blockstates name
// models, models inherit from parents and refer to textures through `#variables`. Shared by the
// asset scripts.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** @param root the `assets/minecraft` directory (blockstates/, models/, textures/ under it). */
export function openModels(root) {
  const modelCache = new Map();

  /** A model with its parent chain folded in: the textures map and the elements. */
  function model(id) {
    const name = id.replace(/^minecraft:/, "");
    if (modelCache.has(name)) return modelCache.get(name);
    const file = join(root, "models", `${name}.json`);
    if (!existsSync(file)) return null;
    const m = JSON.parse(readFileSync(file, "utf8"));
    const parent = m.parent ? model(m.parent) : null;
    const textures = { ...(parent?.textures ?? {}), ...(m.textures ?? {}) };
    const elements = m.elements ?? parent?.elements ?? [];
    const out = { textures, elements };
    modelCache.set(name, out);
    return out;
  }

  /** A face's texture reference resolved through the model's variables to a texture id ("block/dirt"). */
  function resolveTexture(textures, ref) {
    let v = ref;
    for (let i = 0; i < 10; i++) {
      if (v && typeof v === "object") v = v.sprite; // 26.x: { sprite, force_translucent }
      if (typeof v !== "string" || !v.startsWith("#")) break;
      v = textures[v.slice(1)];
    }
    return typeof v === "string" ? v.replace(/^minecraft:/, "") : null;
  }

  /** The first model a blockstate names (its default look). */
  function firstModel(state) {
    if (state.variants) {
      const v = state.variants[""] ?? Object.values(state.variants)[0];
      const one = Array.isArray(v) ? v[0] : v;
      return one?.model ?? null;
    }
    if (state.multipart?.length) {
      const apply = state.multipart[0].apply;
      return (Array.isArray(apply) ? apply[0] : apply)?.model ?? null;
    }
    return null;
  }

  /** Every blockstate, by block name, in a stable order. */
  function* blockstates() {
    const dir = join(root, "blockstates");
    for (const file of readdirSync(dir).sort()) {
      yield [file.replace(/\.json$/, ""), JSON.parse(readFileSync(join(dir, file), "utf8"))];
    }
  }

  return { model, resolveTexture, firstModel, blockstates, texturePath: (id) => join(root, "textures", `${id}.png`) };
}
