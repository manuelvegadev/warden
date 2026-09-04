// Fetches the game art the live view draws with (ADR-018): block and entity textures, block models
// and blockstates from the Java client jar, and the entity geometries and animations from Mojang's
// Bedrock samples. None of it is kept in the repository or in the image — it is Mojang's — so it is
// downloaded where Beacon runs: by `pnpm install` (postinstall) for a checkout, by the container's
// entrypoint into the /data volume in Docker. Beacon serves the tree at /liveview/mc/… to signed-in
// users only.
//
//   pnpm mc:assets                       fetch when nothing is there yet
//   pnpm mc:assets --force               fetch again (the latest releases)
//   pnpm mc:assets --java 1.21.10        pin the Java version (default: the latest release)
//   pnpm mc:assets --bedrock v1.21.100.6 pin the Bedrock samples release (default: the latest)
//
//   MC_ASSETS_DIR      where the tree goes (default beacon/data/mc-assets)
//   MC_JAVA_VERSION    as --java;  MC_BEDROCK_TAG as --bedrock
//   MC_ASSETS=skip     do nothing (CI, image builds); CI=true skips too unless MC_ASSETS=fetch
//
// A tree that is already there is kept without asking the network, unless a pinned version differs
// or --force is given. Plain Node: no unzip binary, no dependencies (the runtime image has neither).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const PISTON_MANIFEST = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const BEDROCK_RELEASES = "https://api.github.com/repos/Mojang/bedrock-samples/releases";
/** What is taken out of the Java jar, under assets/minecraft/. */
const JAVA_PATHS = [
  "textures/block/",
  "textures/entity/",
  "textures/colormap/",
  "textures/environment/",
  "models/block/",
  "blockstates/",
];
/** What is taken out of the Bedrock samples, under resource_pack/. */
const BEDROCK_PATHS = ["models/", "animations/", "animation_controllers/", "entity/", "render_controllers/"];
const TIMEOUT_MS = 30_000;
const log = (line) => process.stdout.write(`${line}\n`);

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? "") : undefined;
};
const force = args.includes("--force");
const beaconRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(process.env.MC_ASSETS_DIR || join(beaconRoot, "data", "mc-assets"));
const wantJava = flag("--java") || process.env.MC_JAVA_VERSION || "latest";
const wantBedrock = flag("--bedrock") || process.env.MC_BEDROCK_TAG || "latest";

if (process.env.MC_ASSETS === "skip" || (process.env.CI && process.env.MC_ASSETS !== "fetch")) {
  log("mc-assets: skipped");
  process.exit(0);
}

// ---- a ZIP reader: the central directory, then each entry's local header ----

function readZip(buf) {
  // The end-of-central-directory record is within the last 64 KiB (it ends with the comment).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
    const nameLen = buf.readUInt16LE(p + 28);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (!name.endsWith("/")) {
      entries.push({
        name,
        method: buf.readUInt16LE(p + 10),
        compressed: buf.readUInt32LE(p + 20),
        offset: buf.readUInt32LE(p + 42),
      });
    }
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  const read = (entry) => {
    const h = entry.offset;
    if (buf.readUInt32LE(h) !== 0x04034b50) throw new Error("bad local header");
    const start = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
    const data = buf.subarray(start, start + entry.compressed);
    if (entry.method === 0) return data;
    if (entry.method === 8) return inflateRawSync(data);
    throw new Error(`unsupported zip method ${entry.method}`);
  };
  return { entries, read };
}

/** Copies every entry under one of `prefixes` (stripped of `strip`) into `out`. */
function extract(zip, strip, prefixes, out) {
  let n = 0;
  for (const entry of zip.entries) {
    if (!entry.name.startsWith(strip)) continue;
    const rel = entry.name.slice(strip.length);
    if (!prefixes.some((p) => rel.startsWith(p))) continue;
    const target = join(out, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, zip.read(entry));
    n++;
  }
  return n;
}

// ---- downloads ----

async function get(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "warden-beacon mc-assets", Accept: "application/json, */*" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

const getJson = (url) => get(url).then((res) => res.json());

async function getBuffer(url, label) {
  const res = await get(url);
  const total = Number(res.headers.get("content-length")) || 0;
  log(`mc-assets: downloading ${label}${total ? ` (${(total / 1048576).toFixed(1)} MB)` : ""}`);
  return Buffer.from(await res.arrayBuffer());
}

async function resolveJava(version) {
  const manifest = await getJson(PISTON_MANIFEST);
  const id = version === "latest" ? manifest.latest.release : version;
  const entry = manifest.versions.find((v) => v.id === id);
  if (!entry) throw new Error(`Java version ${id} is not in Mojang's manifest`);
  const meta = await getJson(entry.url);
  const client = meta.downloads.client;
  return { version: id, url: client.url, sha1: client.sha1 };
}

async function resolveBedrock(tag) {
  const release = await getJson(tag === "latest" ? `${BEDROCK_RELEASES}/latest` : `${BEDROCK_RELEASES}/tags/${tag}`);
  const asset = release.assets.find((a) => a.name.endsWith("-min.zip"));
  if (!asset) throw new Error(`Bedrock samples ${release.tag_name} has no -min.zip`);
  return { tag: release.tag_name, url: asset.browser_download_url };
}

// ---- main ----

async function main() {
  const manifestPath = join(dir, "manifest.json");
  const have = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
  const complete = have && existsSync(join(dir, "java")) && existsSync(join(dir, "bedrock"));
  const pinnedSame = (want, got) => want === "latest" || want === got;
  if (complete && !force && pinnedSame(wantJava, have.java) && pinnedSame(wantBedrock, have.bedrock)) {
    log(`mc-assets: keeping Java ${have.java} and Bedrock samples ${have.bedrock} in ${dir}`);
    return;
  }
  const [java, bedrock] = await Promise.all([resolveJava(wantJava), resolveBedrock(wantBedrock)]);
  if (complete && !force && have.java === java.version && have.bedrock === bedrock.tag) {
    log(`mc-assets: up to date (Java ${java.version}, Bedrock samples ${bedrock.tag}) in ${dir}`);
    return;
  }
  mkdirSync(dir, { recursive: true });
  const [jar, zip] = await Promise.all([
    getBuffer(java.url, `Minecraft ${java.version} client`),
    getBuffer(bedrock.url, `Bedrock samples ${bedrock.tag}`),
  ]);
  const sha1 = createHash("sha1").update(jar).digest("hex");
  if (sha1 !== java.sha1) throw new Error(`client jar checksum mismatch: ${sha1} != ${java.sha1}`);
  const javaFiles = extract(readZip(jar), "assets/minecraft/", JAVA_PATHS, join(dir, "java"));
  log(`mc-assets: ${javaFiles} files from the Java client`);
  const bedrockFiles = extract(readZip(zip), "resource_pack/", BEDROCK_PATHS, join(dir, "bedrock"));
  log(`mc-assets: ${bedrockFiles} files from the Bedrock samples`);
  const manifest = { java: java.version, bedrock: bedrock.tag, fetchedAt: new Date().toISOString() };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  log(`mc-assets: ready in ${dir}`);
}

main().catch((e) => {
  console.error(`mc-assets: ${e instanceof Error ? e.message : e}`);
  // An install must not fail for want of the art (offline, a proxy): the live view says so later.
  process.exit(process.env.npm_lifecycle_event === "postinstall" ? 0 : 1);
});
