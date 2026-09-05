// Builds lib/file-icons/icons.generated.ts from the Atom Material Icons set (ADR-020): the file and
// folder icons the file manager shows. The icons and their name → icon rules live in the
// `iconGenerator` repository (the submodule of AtomMaterialUI/a-file-icon-idea, the IntelliJ
// plugin); this takes a curated subset — what a Minecraft server directory contains, plus the
// usual text and code types — bakes the rule colours into the SVGs and writes them as data URIs.
// The output is committed: neither the build nor the container needs the source checkout.
//
//   git clone https://github.com/AtomMaterialUI/iconGenerator.git /tmp/iconGenerator
//   pnpm file:icons --source /tmp/iconGenerator      (or ICON_GENERATOR_DIR=/tmp/iconGenerator)
//
// Atom Material Icons is MIT-licensed, © Elior "Mallowigi" Boukhobza; the notice travels in the
// generated file.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "lib", "file-icons", "icons.generated.ts");

const args = process.argv.slice(2);
const sourceFlag = args.indexOf("--source");
const SOURCE = resolve(sourceFlag >= 0 ? args[sourceFlag + 1] : (process.env.ICON_GENERATOR_DIR ?? ""));
if (!SOURCE || SOURCE === resolve("")) {
  process.stderr.write("usage: node scripts/file-icons.mjs --source <iconGenerator checkout>\n");
  process.exit(2);
}

/** File rules taken as they are, by association name. Higher priority wins; ties keep this order. */
const FILE_ASSOCIATIONS = [
  // Server directory staples
  "Java",
  "JSON",
  "JSON5",
  "YAML",
  "Properties",
  "TOML",
  "Text",
  "Log",
  "Lockfiles",
  "Minecraft",
  "Configs",
  "Settings",
  "Manifest",
  "Backup",
  // Documents
  "Markdown",
  "README Dark",
  "LICENSE",
  "Changelog",
  "TODO",
  "PDF",
  "CSV",
  // Code and scripts
  "XML",
  "HTML",
  "CSS Dark",
  "Javascript",
  "Shell",
  "Shell History",
  "PowerShell",
  "Windows",
  "Kotlin",
  "Groovy",
  "Gradle",
  "Python",
  "Lua",
  "SQL",
  "SQLite",
  "Docker",
  "Makefile",
  "Diff Dark",
  "Patch",
  "Hex",
  "Binary Object",
  "GitIgnore",
  "EditorConfig",
  // Media and archives
  "Archive",
  "Archive (2)",
  "Archive (3)",
  "Images (PNG)",
  "Images (JPG)",
  "Images (GIF)",
  "Images (BMP)",
  "WebP",
  "SVG Dark",
  "Font",
  "Audio",
  "Audio (2)",
  "Video",
  "Video (2)",
  // Secrets
  "Key",
  "Certificate",
];

/** Rules of our own for what the set has no name for; icons and colours borrowed from it. */
const CUSTOM_FILES = [
  {
    name: "Minecraft data",
    pattern: "\\.(dat|dat_old|nbt|mca|mcr|mclevel|schem|schematic|litematic)$",
    icon: "minecraft",
    color: "20ab49",
    priority: 100,
  },
  { name: "Rotated log", pattern: "\\.log\\.(gz|zip)$", icon: "log", color: "7A8387", priority: 100 },
  { name: "Crash report", pattern: "^crash-\\d{4}-.*\\.txt$", icon: "logreport", color: "7A8387", priority: 100 },
  { name: "Console history", pattern: "^\\.console_history$", icon: "shellhistory", color: "AA759F", priority: 100 },
  { name: "EULA", pattern: "^eula\\.txt$", icon: "license", color: "F5C076", priority: 100 },
];

/** Folder rules by association name. */
const FOLDER_ASSOCIATIONS = [
  "Plugins",
  "Config",
  "Logs",
  "Archives",
  "Temp",
  "Vendors",
  "Dump",
  "Generated",
  "Scripts",
  "Resources",
  "Docs",
  "Images",
  "Icons",
  "Fonts",
  "Audio",
  "Keys",
  "Java",
  "Error",
  "Tests",
  "Screens",
  "Web",
  "Downloads",
  "Models",
  "Maps",
  "Packages",
  "Users",
  "Private",
  "Other",
  "Sources",
  "Env",
  "Debug",
  "Meta",
  "Storage",
  "Docker",
  "Git",
  "Custom",
  "Shared",
  "Server",
  "Trash",
  "Dist",
  "DB",
  "JSON",
];

/** Folder rules of our own; `like` copies the colours of a named association. */
const CUSTOM_FOLDERS = [
  {
    name: "World",
    pattern: "^(world|world_nether|world_the_end|DIM-?1|.+_nether|.+_the_end)$",
    icon: "global",
    colors: ["4CAF50", "C8E6C9"],
    priority: 200,
  },
  { name: "Region", pattern: "^(region|poi)$", icon: "maps", like: "Maps", priority: 100 },
  { name: "Player data", pattern: "^playerdata$", icon: "users", like: "Users", priority: 100 },
  { name: "Stats", pattern: "^stats$", icon: "charts", colors: ["26A69A", "B2DFDB"], priority: 100 },
  { name: "Advancements", pattern: "^advancements$", icon: "favorites", colors: ["FBC02D", "FFF9C4"], priority: 100 },
  { name: "Datapacks", pattern: "^datapacks$", icon: "packages", like: "Packages", priority: 100 },
  { name: "Crash reports", pattern: "^crash-reports$", icon: "error", like: "Error", priority: 100 },
  {
    name: "Software",
    pattern: "^\\.(paper|fabric|purpur|quilt|forge|neoforge)$",
    icon: "config",
    like: "Config",
    priority: 200,
  },
  { name: "Versions", pattern: "^(versions|bundler)$", icon: "stack", colors: ["5C6BC0", "C5CAE9"], priority: 100 },
  {
    name: "Resource packs",
    pattern: "^(resourcepacks|resource_packs|texturepacks)$",
    icon: "resource",
    like: "Resources",
    priority: 100,
  },
];

const DEFAULT_FILE = "file";
const DEFAULT_FOLDER = "folder";

// ---- Sources

const loadRules = (file) =>
  JSON.parse(readFileSync(join(SOURCE, file), "utf8")).associations.associations.regex.map((e) => e.value);
const fileRules = loadRules("icon_associations.json");
const folderRules = loadRules("folder_associations.json");
const byName = (rules, name) => {
  const r = rules.find((x) => x.name === name);
  if (!r) throw new Error(`no association named "${name}"`);
  return r;
};

/** Reads one SVG, strips the licence banner and sizing, rounds the geometry, bakes the colours. */
function svg(kind, id, colours) {
  let text = readFileSync(join(SOURCE, "assets", "icons", kind, `${id}.svg`), "utf8");
  text = text.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?xml[^>]*>/g, "");
  const m = text.match(/<svg[\s\S]*<\/svg>/);
  if (!m) throw new Error(`${kind}/${id}.svg: no <svg> element`);
  text = m[0];
  text = text.replace(/\s(width|height)="[^"]*"/g, "");
  if (!/xmlns=/.test(text)) text = text.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  // The rule's colours replace the fills of the elements the set marks for theming.
  const recolour = (attr, colour) => {
    if (!colour) return;
    text = text.replace(new RegExp(`<([a-zA-Z]+)([^>]*?)\\s${attr}="[^"]*"([^>]*)>`, "g"), (_, tag, before, after) => {
      const selfClosing = /\/\s*$/.test(after);
      const attrs = `${before}${after}`
        .replace(/\sfill="[^"]*"/, "")
        .replace(/\/\s*$/, "")
        .trimEnd();
      return `<${tag}${attrs} fill="#${colour}"${selfClosing ? "/" : ""}>`;
    });
  };
  recolour("data-iconColor", colours.color);
  recolour("data-folderColor", colours.folderColor);
  recolour("data-folderIconColor", colours.folderIconColor);
  text = text.replace(/\sdata-[a-zA-Z]+="[^"]*"/g, "");
  // Two decimals are plenty at 16 px; the sources carry up to ten.
  text = text.replace(
    /\sd="([^"]*)"/g,
    (_, d) => ` d="${d.replace(/-?\d*\.\d+(?:e-?\d+)?/g, (n) => String(Number(Number(n).toFixed(2))))}"`,
  );
  // A data: URL drops raw newlines, which would glue attributes together: one space, everywhere.
  text = text.replace(/\s+/g, " ").replace(/> </g, "><").trim();
  return text;
}

const toDataUri = (s) =>
  `data:image/svg+xml,${s
    .replace(/"/g, "'")
    .replace(/%/g, "%25")
    .replace(/#/g, "%23")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E")
    .replace(/\{/g, "%7B")
    .replace(/\}/g, "%7D")}`;

// ---- Build

const icons = []; // data URIs, deduplicated
const iconIndex = new Map();
const addIcon = (kind, id, colours) => {
  const key = `${kind}/${id}/${JSON.stringify(colours)}`;
  if (!iconIndex.has(key)) {
    iconIndex.set(key, icons.length);
    icons.push(toDataUri(svg(kind, id, colours)));
  }
  return iconIndex.get(key);
};
const iconId = (path) => path.replace(/^.*\//, "").replace(/\.svg$/, "");

const checkPattern = (name, pattern) => {
  try {
    new RegExp(pattern);
  } catch (e) {
    throw new Error(`${name}: pattern ${pattern} is not a JavaScript regex: ${e.message}`);
  }
};

// The set's rules and ours become one record shape — name, pattern, priority, icon id, colours —
// before the icons are built, so each kind has a single loop.
const folderColours = (r) => ({
  folderColor: r.folderColor.replace(/^#/, ""),
  folderIconColor: r.folderIconColor.replace(/^#/, ""),
});
const fileRecords = [
  ...FILE_ASSOCIATIONS.map((name) => {
    const r = byName(fileRules, name);
    return {
      name,
      pattern: r.pattern,
      priority: Number(r.priority),
      icon: iconId(r.icon),
      colours: { color: r.iconColor },
    };
  }),
  ...CUSTOM_FILES.map((c) => ({ ...c, colours: { color: c.color } })),
];
const folderRecords = [
  ...FOLDER_ASSOCIATIONS.map((name) => {
    const r = byName(folderRules, name);
    return { name, pattern: r.pattern, priority: Number(r.priority), icon: iconId(r.icon), colours: folderColours(r) };
  }),
  ...CUSTOM_FOLDERS.map((c) => ({
    ...c,
    colours: c.like
      ? folderColours(byName(folderRules, c.like))
      : { folderColor: c.colors[0], folderIconColor: c.colors[1] },
  })),
];

const files = fileRecords.map((r) => {
  checkPattern(r.name, r.pattern);
  return { name: r.name, pattern: r.pattern, priority: r.priority, icon: addIcon("files", r.icon, r.colours) };
});
const folders = folderRecords.map((r) => {
  checkPattern(r.name, r.pattern);
  return {
    name: r.name,
    pattern: r.pattern,
    priority: r.priority,
    icon: addIcon("folders", r.icon, r.colours),
    open: addIcon("foldersOpen", r.icon, r.colours),
  };
});

// Stable order: highest priority first, then the curated order.
const byPriority = (a, b) => b.priority - a.priority;
files.sort(byPriority);
folders.sort(byPriority);

const defaults = {
  file: addIcon("files", DEFAULT_FILE, {}),
  folder: addIcon("folders", DEFAULT_FOLDER, {}),
  folderOpen: addIcon("foldersOpen", DEFAULT_FOLDER, {}),
};

const rule = (r) =>
  `  { name: ${JSON.stringify(r.name)}, pattern: ${JSON.stringify(r.pattern)}, icon: ${r.icon}${r.open === undefined ? "" : `, open: ${r.open}`} },`;

const out = `// Generated by scripts/file-icons.mjs from the Atom Material Icons set — do not edit by hand.
//
// The MIT License (MIT)
//
// Copyright (c) 2015-2024 Elior "Mallowigi" Boukhobza
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
// associated documentation files (the "Software"), to deal in the Software without restriction,
// including without limitation the rights to use, copy, modify, merge, publish, distribute,
// sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all copies or
// substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
// NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

/** A rule: a regular expression over the file name (or the path when it contains a slash). */
export interface IconRule {
  name: string;
  pattern: string;
  /** Index into ICONS. */
  icon: number;
  /** Folders only: the icon while the folder is open. */
  open?: number;
}

/** SVG data URIs, sized by the element that shows them. */
export const ICONS: readonly string[] = [
${icons.map((s) => `  ${JSON.stringify(s)},`).join("\n")}
];

/** File rules, best match first. */
export const FILE_RULES: readonly IconRule[] = [
${files.map(rule).join("\n")}
];

/** Folder rules, best match first. */
export const FOLDER_RULES: readonly IconRule[] = [
${folders.map(rule).join("\n")}
];

export const DEFAULT_ICONS = { file: ${defaults.file}, folder: ${defaults.folder}, folderOpen: ${defaults.folderOpen} } as const;
`;

writeFileSync(OUT, out);
process.stdout.write(
  `${OUT}: ${files.length} file rules, ${folders.length} folder rules, ${icons.length} icons, ${(out.length / 1024).toFixed(0)} KB\n`,
);
