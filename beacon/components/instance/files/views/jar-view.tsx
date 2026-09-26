"use client";

import { Badge } from "@warden/ui/components/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@warden/ui/components/tabs";
import { badgeTone } from "@warden/ui/lib/badge-tone";
import { cn } from "@warden/ui/lib/utils";
import { useEffect, useState } from "react";
import { ArchiveView } from "@/components/instance/files/views/archive-view";
import { JsonEditor } from "@/components/instance/files/views/json-editor";
import { fs, type JarInfo } from "@/lib/api";
import { mono } from "@/lib/utils";

const KIND: Record<JarInfo["kind"], { label: string; tone: string }> = {
  "paper-plugin": { label: "Paper plugin", tone: badgeTone.blue },
  "bukkit-plugin": { label: "Bukkit plugin", tone: badgeTone.sky },
  "velocity-plugin": { label: "Velocity plugin", tone: badgeTone.violet },
  "bungee-plugin": { label: "BungeeCord plugin", tone: badgeTone.amber },
  "fabric-mod": { label: "Fabric mod", tone: badgeTone.amber },
  "quilt-mod": { label: "Quilt mod", tone: badgeTone.violet },
  "neoforge-mod": { label: "NeoForge mod", tone: badgeTone.red },
  "forge-mod": { label: "Forge mod", tone: badgeTone.red },
  library: { label: "Library", tone: badgeTone.muted },
};

const text = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);
const list = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map((x) => (typeof x === "string" ? x : (text((x as { id?: unknown })?.id) ?? ""))).filter(Boolean)
    : text(v)
      ? [text(v) as string]
      : [];
const keys = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v) : []);

/** The facts a descriptor names, whatever its flavour (plugin.yml, paper-plugin.yml, fabric.mod.json…). */
function facts(info: JarInfo) {
  const m = info.meta ?? {};
  const paperDeps = keys((m.dependencies as { server?: unknown } | undefined)?.server);
  return {
    name: text(m.name) ?? text(m.id) ?? info.manifest?.["Implementation-Title"],
    version: text(m.version) ?? info.manifest?.["Implementation-Version"],
    description: text(m.description),
    main: text(m.main) ?? text(m.entrypoints && (m.entrypoints as { main?: unknown }).main),
    authors: [...list(m.author), ...list(m.authors)],
    website: text(m.website) ?? text((m.contact as { homepage?: unknown } | undefined)?.homepage),
    api: text(m["api-version"]),
    depends: info.kind === "paper-plugin" ? paperDeps : [...list(m.depend), ...keys(m.depends)],
    softDepends: list(m.softdepend),
    commands: keys(m.commands),
    permissions: keys(m.permissions),
  };
}

/**
 * A jar as what it is (ADR-020): the plugin or mod its descriptor names — version, authors, what
 * it needs, its commands and permissions — the Java it was built for, the descriptor itself, and
 * the files inside.
 */
export function JarView({ id, path }: { id: string; path: string }) {
  const [info, setInfo] = useState<JarInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    fs.jar(id, path)
      .then((i) => !stale && setInfo(i))
      .catch((e: Error) => !stale && setError(e.message));
    return () => {
      stale = true;
    };
  }, [id, path]);

  if (error) return <p className="px-4 py-3 text-sm text-muted-foreground">Not a jar this panel can read: {error}</p>;
  if (!info) return <p className="px-4 py-3 text-sm text-muted-foreground">Reading…</p>;
  const f = facts(info);
  const kind = KIND[info.kind];
  return (
    <Tabs defaultValue="about" className="flex min-h-0 flex-1 flex-col gap-0">
      <TabsList className="mx-3 mt-3">
        <TabsTrigger value="about">About</TabsTrigger>
        {info.descriptor && <TabsTrigger value="descriptor">{info.descriptor.split("/").pop()}</TabsTrigger>}
        <TabsTrigger value="files">Files · {info.entries}</TabsTrigger>
      </TabsList>
      <TabsContent value="about" className="min-h-0 flex-1 overflow-auto p-4">
        <div className="grid max-w-2xl gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold">{f.name ?? path.split("/").pop()}</span>
            {f.version && <span className={cn(mono, "text-sm text-muted-foreground")}>{f.version}</span>}
            <Badge variant="outline" className={kind.tone}>
              {kind.label}
            </Badge>
            {info.javaMin !== undefined && info.javaMin > 0 && <Badge variant="outline">Java {info.javaMin}+</Badge>}
          </div>
          {f.description && <p className="text-sm text-muted-foreground">{f.description}</p>}
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            {f.authors.length > 0 && <Fact label="Authors">{f.authors.join(", ")}</Fact>}
            {f.website && (
              <Fact label="Website">
                <a
                  href={f.website}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {f.website}
                </a>
              </Fact>
            )}
            {f.api && <Fact label="API version">{f.api}</Fact>}
            {f.main && (
              <Fact label="Main class">
                <span className={mono}>{f.main}</span>
              </Fact>
            )}
            {f.depends.length > 0 && <Fact label="Needs">{f.depends.join(", ")}</Fact>}
            {f.softDepends.length > 0 && <Fact label="Works with">{f.softDepends.join(", ")}</Fact>}
          </dl>
          {f.commands.length > 0 && <Names title="Commands" names={f.commands.map((c) => `/${c}`)} />}
          {f.permissions.length > 0 && <Names title="Permissions" names={f.permissions} />}
          {info.manifest && Object.keys(info.manifest).length > 0 && (
            <div className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">Manifest</span>
              <dl className={cn(mono, "grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs")}>
                {Object.entries(info.manifest).map(([k, v]) => (
                  <Fact key={k} label={k}>
                    {v}
                  </Fact>
                ))}
              </dl>
            </div>
          )}
        </div>
      </TabsContent>
      {info.descriptor && (
        <TabsContent value="descriptor" className="flex min-h-0 flex-1 flex-col">
          {info.meta ? (
            <JsonEditor text={JSON.stringify(info.meta, null, 2)} onChange={() => {}} readOnly />
          ) : (
            <pre className={cn(mono, "min-h-0 flex-1 overflow-auto p-3 text-[13px]")}>{info.raw}</pre>
          )}
        </TabsContent>
      )}
      <TabsContent value="files" className="flex min-h-0 flex-1 flex-col">
        <ArchiveView id={id} path={path} />
      </TabsContent>
    </Tabs>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function Names({ title, names }: { title: string; names: string[] }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs text-muted-foreground">
        {title} · {names.length}
      </span>
      <div className="flex flex-wrap gap-1">
        {names.map((n) => (
          <Badge key={n} variant="outline" className={cn(mono, "font-normal")}>
            {n}
          </Badge>
        ))}
      </div>
    </div>
  );
}
