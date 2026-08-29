import { Badge } from "@warden/ui/components/badge";
import { Button } from "@warden/ui/components/button";
import { Card, CardContent } from "@warden/ui/components/card";
import { Table, TableBody, TableCell, TableRow } from "@warden/ui/components/table";
import { cn } from "@warden/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import { PlayerFace, PluginIcon } from "@/components/demo/avatars";
import {
  BACKUP_KIND,
  BACKUPS,
  LOG,
  LOG_COLOR,
  type LogLine,
  PLUGIN_STATUS,
  PLUGINS,
  tone,
} from "@/components/demo/data";
import { FormRow } from "@/components/demo/form-row";
import styles from "@/components/features.module.css";
import { Reveal } from "@/components/reveal";
import { Eyebrow, Heading, Section } from "@/components/section";

type Feature = { eyebrow: string; title: string; body: React.ReactNode; example: React.ReactNode };

/** A read-only select as the create dialog renders it. */
function Field({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <FormRow label={label}>
      <div
        className={cn(
          "flex h-8 w-[200px] items-center justify-between rounded-lg border border-input bg-input/30 px-2.5 text-sm",
          mono && "font-mono tabular-nums",
        )}
      >
        {value}
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </div>
    </FormRow>
  );
}

// The console example continues the demo's log with a crash the daemon recovers from.
const CONSOLE_LINES: LogLine[] = [
  ...LOG.slice(3, 6),
  { text: "> say Backup in 5 minutes", color: LOG_COLOR.stdin },
  { text: "[12:08:00 INFO]: [Server] Backup in 5 minutes", color: LOG_COLOR.info },
  { text: "[wardend]: survival-main exited (code 1) — restarting in 5 s (attempt 1/5)", color: LOG_COLOR.daemon },
  { text: "[12:08:07 INFO]: Starting minecraft server version 1.21.8", color: LOG_COLOR.info },
];

// The install queue: two plugins queued, one still available.
const QUEUE = PLUGINS.filter((p) => p.name !== "Chunky" && p.name !== "EssentialsX").map((p) => ({
  ...p,
  status: p.name === "spark" ? ("available" as const) : ("queued" as const),
}));

const FEATURES: Feature[] = [
  {
    eyebrow: "Instances",
    title: "Pick the software, the version, the build. Done.",
    body: (
      <>
        Paper, Purpur, Fabric and Vanilla from their official catalogs. wardend downloads the jar, verifies its hash,
        writes the EULA and <span className="font-mono">server.properties</span>, and selects a managed Temurin runtime
        that matches the Minecraft version.
      </>
    ),
    example: (
      <CardContent className="flex flex-col gap-3.5 p-5">
        <div>
          <div className="font-semibold">New server</div>
          <div className="text-xs text-muted-foreground">
            catalog · Fill v3, api.purpurmc.org, Fabric Meta, piston-meta
          </div>
        </div>
        <div className="rounded-xl bg-background ring-1 ring-foreground/10">
          <Field
            label="Software"
            mono={false}
            value={
              <Badge variant="outline" className={tone.blue}>
                Paper
              </Badge>
            }
          />
          <Field label="Minecraft version" value="1.21.8" />
          <Field label="Build" value="#112 · stable" />
          <Field label="Java runtime" value="Temurin 21 (auto)" />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
            <div className={cn("h-full bg-foreground", styles.fillup)} />
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">
            Downloading paper-1.21.8-112.jar · sha256 verified · preparing runtime…
          </div>
        </div>
      </CardContent>
    ),
  },
  {
    eyebrow: "Console & supervision",
    title: "The console you know, plus a daemon that never sleeps.",
    body: "Live log over WebSocket with the original levels, command history, staged stop. When the server crashes, wardend brings it back with exponential backoff; TPS is polled quietly every 16 s and the reply stays out of your view.",
    example: (
      <div className="bg-[#1c1c1c]">
        <div className="flex items-center justify-between border-b px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[13px] font-medium">
            Console
            <Badge variant="outline" className={tone.emerald}>
              running
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">WebSocket · levels &amp; colors preserved</div>
        </div>
        <div className="font-console whitespace-pre-wrap p-3.5 text-[12.5px] text-[#d4d4d4]">
          {CONSOLE_LINES.map((l) => (
            <div key={l.text} style={{ color: l.color }}>
              {l.text}
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    eyebrow: "Plugins",
    title: "Hangar and Modrinth, one search box.",
    body: "Search both catalogs, queue several plugins, pick a version for each and install them in a batch — every jar hash-verified. Update checks, enable/disable and manual uploads live in the same table. Paper and Purpur only; the tab hides elsewhere.",
    example: (
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex h-8 items-center justify-between rounded-lg border border-input bg-input/30 px-2.5 text-sm text-muted-foreground">
          <span>Search Hangar and Modrinth…</span>
          <span className="text-xs">⌘K</span>
        </div>
        <div className="overflow-hidden rounded-xl bg-background ring-1 ring-foreground/10">
          <Table>
            <TableBody>
              {QUEUE.map((p) => (
                <TableRow key={p.name}>
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-2">
                      <PluginIcon name={p.name} />
                      {p.name}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground">{p.version}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{p.source}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline" className={tone[PLUGIN_STATUS[p.status].tone || "muted"]}>
                      {p.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">2 in queue · versions chosen per plugin</span>
          <Button size="sm">Install 2 plugins</Button>
        </div>
      </CardContent>
    ),
  },
  {
    eyebrow: "Metrics",
    title: "Sampled every two seconds, kept for a week.",
    body: "CPU, RAM, network and TPS per instance from the process itself — no plugin needed. One hour in memory for the live charts, seven days in SQLite for the “what happened last night” question. Host CPU, memory and disk on the Home page.",
    example: (
      <CardContent className="flex flex-col gap-2.5 p-4">
        <div className="flex items-baseline justify-between">
          <div className="font-semibold">Metrics · last hour</div>
          <div className="font-mono text-xl font-semibold tabular-nums">
            19.97 <span className="text-xs font-normal text-muted-foreground">tps</span>
          </div>
        </div>
        <svg viewBox="0 0 600 140" preserveAspectRatio="none" className="h-[150px] w-full" aria-hidden>
          {[35, 70, 105].map((y) => (
            <line key={y} x1="0" y1={y} x2="600" y2={y} stroke="rgba(255,255,255,0.08)" />
          ))}
          <path
            className={styles.draw}
            d="M0 22 L60 24 L120 20 L180 26 L240 22 L300 60 L340 28 L400 22 L460 25 L520 21 L600 23"
            fill="none"
            stroke="#fcfcfc"
            strokeWidth="2"
          />
          <path
            className={styles.draw}
            d="M0 100 L60 92 L120 104 L180 78 L240 86 L300 50 L340 74 L400 82 L460 68 L520 90 L600 84"
            fill="none"
            stroke="#8a8a8a"
            strokeWidth="1.5"
          />
        </svg>
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>— TPS</span>
          <span>— CPU %</span>
          <span>· RAM, network and host stats on their own tabs</span>
        </div>
      </CardContent>
    ),
  },
  {
    eyebrow: "Players",
    title: "The history the server already keeps, in one card.",
    body: "Sessions from the log, advancements and statistics from the world folder, skins from Mojang. Message, kick, ban or op a player without opening the console — whitelist, ops and bans stay in sync with the files.",
    example: (
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-3">
          <PlayerFace name="Steve" className="size-10 rounded-lg" />
          <div>
            <div className="font-semibold">Steve</div>
            <div className="font-mono text-xs text-muted-foreground">online · 2h 14m this session</div>
          </div>
          <div className="grow" />
          <Badge variant="outline" className={tone.emerald}>
            online
          </Badge>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            ["Play time", "61h 20m"],
            ["Sessions", "87"],
            ["Advancements", "42 / 118"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-background px-3 py-2.5 ring-1 ring-foreground/10">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="mt-1 font-mono text-[15px] font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline">
            Message
          </Button>
          <Button size="sm" variant="outline">
            Kick
          </Button>
          <Button size="sm" variant="outline">
            Op
          </Button>
          <Button size="sm" variant="outline" className="text-red-500">
            Ban
          </Button>
        </div>
      </CardContent>
    ),
  },
  {
    eyebrow: "Backups & upgrades",
    title: "Scheduled, compressed, restorable.",
    body: "save-off, flush, tar.zst with a sidecar manifest, all inside the daemon. Retention by count or total size. Restore takes a safety copy first; upgrading the server build takes a backup before it swaps the jar.",
    example: (
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <div className="font-semibold">Backups</div>
          <div className="font-mono text-xs text-muted-foreground">nightly 03:00 · keep 7 · max 20 GB</div>
        </div>
        <div className="overflow-hidden rounded-xl bg-background ring-1 ring-foreground/10">
          <Table>
            <TableBody>
              {BACKUPS.map((b) => (
                <TableRow key={b.name}>
                  <TableCell className="font-mono">{b.name}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">{b.size}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={BACKUP_KIND[b.kind] && tone[BACKUP_KIND[b.kind] || "muted"]}>
                      {b.kind}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-right text-xs text-muted-foreground xl:table-cell">
                    Restore · Download
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="font-console text-xs text-muted-foreground">
          [wardend]: save-off → save-all flush → tar.zst (41 s) → save-on
        </div>
      </CardContent>
    ),
  },
];

export function Features() {
  return (
    <Section id="features" className="flex flex-col pb-0">
      <div className="flex max-w-3xl flex-col gap-2.5 pb-16">
        <Eyebrow>Features</Eyebrow>
        <Heading>Everything a server admin does, with the server's own data.</Heading>
      </div>
      {FEATURES.map((f, i) => {
        const flip = i % 2 === 1; // example on the left
        return (
          <div key={f.eyebrow} className="grid items-center gap-12 border-t py-16 md:grid-cols-2 md:gap-24 md:py-28">
            <Reveal className={cn("flex flex-col gap-3.5", flip && "md:order-2")}>
              <Eyebrow>{f.eyebrow}</Eyebrow>
              <h3 className="text-2xl font-semibold leading-[1.12] tracking-[-0.025em] md:text-3xl">{f.title}</h3>
              <p className="text-pretty leading-relaxed text-muted-foreground">{f.body}</p>
            </Reveal>
            <Reveal delay={0.12} className={cn(flip && "md:order-1")}>
              <Card className={cn("gap-0 py-0 ring-0", styles.tilt, flip && styles.tiltLeft)}>{f.example}</Card>
            </Reveal>
          </div>
        );
      })}
    </Section>
  );
}
