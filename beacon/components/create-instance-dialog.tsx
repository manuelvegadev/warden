"use client";

import { Button } from "@warden/ui/components/button";
import { Checkbox } from "@warden/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@warden/ui/components/dialog";
import { Input } from "@warden/ui/components/input";
import { Label } from "@warden/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@warden/ui/components/select";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { SectionCard, SettingRow } from "@/components/instance/section-card";
import { useInstances } from "@/components/instances-store";
import {
  type Build,
  catalog,
  DEFAULT_SOFTWARE,
  instances,
  type JavaRuntime,
  java,
  SOFTWARE,
  SOFTWARE_LABELS,
  softwareName,
  type VersionList,
} from "@/lib/api";

const EMPTY: string[] = [];

import { mono } from "@/lib/utils";

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

const JVM_PRESETS = { aikar: "Aikar (recommended)", basic: "Basic" };

export function CreateInstanceDialog() {
  const router = useRouter();
  const { createOpen: open, setCreateOpen: setOpen, refresh } = useInstances();
  const [software, setSoftware] = useState(DEFAULT_SOFTWARE);
  // Version lists per software, kept across opens (the daemon caches upstream for 10 min anyway).
  const [lists, setLists] = useState<Record<string, VersionList>>({});
  const [version, setVersion] = useState("");
  const [builds, setBuilds] = useState<Build[]>([]);
  const [build, setBuild] = useState<string>("latest");
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [eula, setEula] = useState(false);
  const [runtimes, setRuntimes] = useState<JavaRuntime[]>([]);
  const [javaChoice, setJavaChoice] = useState("auto");
  const [requiredMajor, setRequiredMajor] = useState<number | null>(null);
  const [pending, setPending] = useState(false);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setName("");
      setId("");
      setIdTouched(false);
      setEula(false);
      setJavaChoice("auto");
    }
  }

  const known = lists[software];
  const versions = known?.versions ?? EMPTY;

  useEffect(() => {
    if (!open) return;
    setBuild("latest");
    if (known) {
      setVersion(known.latest);
      return;
    }
    let stale = false;
    catalog
      .versions(software)
      .then((v) => {
        if (stale) return;
        setLists((l) => ({ ...l, [software]: v }));
        setVersion(v.latest);
      })
      .catch((e) => toast.error(`Cannot load ${softwareName(software)} versions: ${e.message}`));
    return () => {
      stale = true;
    };
  }, [open, software, known]);

  useEffect(() => {
    if (!open) return;
    java
      .list()
      .then((r) => setRuntimes(r.installed))
      .catch(() => setRuntimes([]));
  }, [open]);

  useEffect(() => {
    // Skips the stale (new software, old version) render right after a software switch.
    if (!version || !versions.includes(version)) return;
    let stale = false;
    java
      .required(version)
      .then((r) => {
        if (!stale) setRequiredMajor(r.requiredMajor);
      })
      .catch(() => {});
    catalog
      .builds(software, version)
      .then((b) => {
        if (!stale) setBuilds(b);
      })
      .catch(() => {
        if (!stale) setBuilds([]);
      });
    return () => {
      stale = true;
    };
  }, [version, software, versions]);

  function selectVersion(v: string | null) {
    if (!v) return;
    setVersion(v);
    setBuild("latest");
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending(true);
    try {
      const res = await instances.create({
        id,
        name,
        software,
        mcVersion: version,
        build: build === "latest" ? undefined : Number(build),
        memoryMb: Number(fd.get("memoryMb")),
        port: Number(fd.get("port")),
        jvmFlagsPreset: String(fd.get("jvm")) as "aikar" | "basic",
        javaRuntime: javaChoice,
        restartPolicy: "on-crash",
        autostart: false,
        acceptEula: eula,
        properties: { motd: String(fd.get("motd") || name), "max-players": String(fd.get("maxPlayers")) },
      });
      toast.success(`Installing ${res.instance.name}…`);
      setOpen(false);
      void refresh();
      router.push(`/instances/${res.instance.id}/console`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create instance");
    } finally {
      setPending(false);
    }
  }

  const sw = SOFTWARE[software];
  // value → label maps feed both the trigger (`items`) and the option list, so labels live once.
  const buildItems = useMemo(
    () => ({
      latest: "Latest stable",
      ...Object.fromEntries(builds.slice(0, 15).map((b) => [String(b.id), sw.buildOf(b)])),
    }),
    [builds, sw],
  );
  // Runtimes older than what the Minecraft version needs stay listed but disabled.
  const tooOld = runtimes.filter((r) => r.major < (requiredMajor ?? 0));
  const runtimeItems = {
    auto: `Automatic${requiredMajor ? ` — Temurin ${requiredMajor}` : ""}`,
    ...Object.fromEntries(
      runtimes.map((r) => [r.id, `${r.id} · Java ${r.version}${tooOld.includes(r) ? " (too old)" : ""}`]),
    ),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 pt-6 pb-4">
          <DialogTitle>New server</DialogTitle>
          <DialogDescription>
            Pick the software and version; wardend downloads the jar and prepares the folder.
          </DialogDescription>
        </DialogHeader>
        <form id="create-instance" onSubmit={onSubmit} className="grid min-h-0 flex-1 gap-6 overflow-y-auto px-6 py-6">
          <SectionCard title="Identity" subtitle="How this server appears in Beacon and on disk.">
            <SettingRow id="new-name" label="Name" description="Shown in the sidebar and breadcrumbs.">
              <Input
                id="new-name"
                value={name}
                required
                autoFocus
                onChange={(e) => {
                  setName(e.target.value);
                  if (!idTouched) setId(slug(e.target.value));
                }}
              />
            </SettingRow>
            <SettingRow
              id="new-id"
              label="ID"
              description="Folder name under the data directory. Lowercase, digits and dashes."
            >
              <Input
                id="new-id"
                value={id}
                required
                pattern="[a-z0-9][a-z0-9-]{1,31}"
                className={mono}
                onChange={(e) => {
                  setIdTouched(true);
                  setId(e.target.value);
                }}
              />
            </SettingRow>
          </SectionCard>

          <SectionCard title="Software" subtitle={sw.description}>
            <SettingRow id="new-software" label="Software">
              <Select items={SOFTWARE_LABELS} value={software} onValueChange={(v) => v && setSoftware(v)}>
                <SelectTrigger id="new-software" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SOFTWARE_LABELS).map(([id, label]) => (
                    <SelectItem key={id} value={id}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
            <SettingRow
              id="new-version"
              label="Minecraft version"
              description={requiredMajor ? `Requires Java ${requiredMajor} or newer.` : undefined}
            >
              <Select value={version} onValueChange={selectVersion}>
                <SelectTrigger id="new-version" className={`w-full ${mono}`}>
                  <SelectValue placeholder="Loading…" />
                </SelectTrigger>
                <SelectContent fit="content">
                  {versions.map((v) => (
                    <SelectItem key={v} value={v} className={mono}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
            {sw.builds && (
              <SettingRow id="new-build" label={sw.buildLabel} description="Latest stable is what most servers want.">
                <Select items={buildItems} value={build} onValueChange={(v) => setBuild(v ?? "latest")}>
                  <SelectTrigger id="new-build" className={`w-full ${mono}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent fit="content">
                    {Object.entries(buildItems).map(([v, label]) => (
                      <SelectItem key={v} value={v} className={mono}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
            )}
            <SettingRow
              id="new-java"
              label="Java runtime"
              description="Automatic downloads the Temurin release Minecraft requires if it is missing."
            >
              <Select items={runtimeItems} value={javaChoice} onValueChange={(v) => setJavaChoice(v ?? "auto")}>
                <SelectTrigger id="new-java" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent fit="content">
                  {Object.entries(runtimeItems).map(([id, label]) => (
                    <SelectItem key={id} value={id} disabled={tooOld.some((r) => r.id === id)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
          </SectionCard>

          <SectionCard title="Resources" subtitle="Memory, network and the first server.properties values.">
            <SettingRow
              id="new-memoryMb"
              label="Memory (MB)"
              description="Heap size: -Xms and -Xmx are both set to this value."
            >
              <Input
                id="new-memoryMb"
                name="memoryMb"
                type="number"
                min={512}
                step={256}
                defaultValue={2048}
                className={mono}
              />
            </SettingRow>
            <SettingRow id="new-port" label="Port" description="RCON is reserved on port + 10.">
              <Input
                id="new-port"
                name="port"
                type="number"
                min={1024}
                max={65535}
                defaultValue={25565}
                className={mono}
              />
            </SettingRow>
            <SettingRow id="new-jvm" label="JVM flags" description="Aikar's flags are the community-tuned G1GC set.">
              <Select name="jvm" items={JVM_PRESETS} defaultValue="aikar">
                <SelectTrigger id="new-jvm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(JVM_PRESETS).map(([v, label]) => (
                    <SelectItem key={v} value={v}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
            <SettingRow id="new-motd" label="MOTD" description="Shown in the multiplayer server list.">
              <Input id="new-motd" name="motd" placeholder={name || "A Minecraft Server"} />
            </SettingRow>
            <SettingRow id="new-maxPlayers" label="Max players">
              <Input id="new-maxPlayers" name="maxPlayers" type="number" min={1} defaultValue={20} className={mono} />
            </SettingRow>
          </SectionCard>
        </form>
        <DialogFooter className="mx-0 mb-0 items-center bg-muted px-6 py-4 sm:justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Checkbox id="eula" checked={eula} onCheckedChange={(v) => setEula(v === true)} />
            <Label htmlFor="eula" className="font-normal">
              I accept the{" "}
              <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer" className="underline">
                Minecraft EULA
              </a>
            </Label>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="create-instance" disabled={pending || !eula || !version || !id}>
              {pending ? "Creating…" : "Create and install"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
