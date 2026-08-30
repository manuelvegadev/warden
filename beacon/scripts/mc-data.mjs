// Builds lib/mc/data.json (item / entity / effect / biome / enchantment ids used by console
// autocompletion) from PrismarineJS/minecraft-data, for the newest 1.21.x version it knows.
//   pnpm mc:data
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAW = "https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data";
const KINDS = ["items", "entities", "effects", "biomes", "enchantments"];

const fetchJson = async (path) => {
  const res = await fetch(`${RAW}/${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
};

const paths = (await fetchJson("dataPaths.json")).pc;
const numeric = (v) => v.split(".").map(Number);
const version = Object.keys(paths)
  .filter((v) => /^1\.21(\.\d+)?$/.test(v) && KINDS.every((k) => paths[v][k]))
  .sort((a, b) => {
    const [x, y] = [numeric(a), numeric(b)];
    for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
  })
  .at(-1);
if (!version) throw new Error("no 1.21.x version with every data file");

// Effects are CamelCase in minecraft-data ("FireResistance"); the game wants fire_resistance.
const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
const ids = (rows, kind) => [...new Set(rows.map((r) => (kind === "effects" ? snake(r.name) : r.name)))].sort();

const out = { version };
for (const kind of KINDS) out[kind] = ids(await fetchJson(`${paths[version][kind]}/${kind}.json`), kind);

const file = join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "mc", "data.json");
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, `${JSON.stringify(out)}\n`);
process.stdout.write(
  `mc data ${version}: ${KINDS.map((k) => `${out[k].length} ${k}`).join(", ")} → lib/mc/data.json\n`,
);
