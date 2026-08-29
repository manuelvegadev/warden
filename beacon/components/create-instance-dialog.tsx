"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { catalog, instances, java, type Build, type JavaRuntime } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

export function CreateInstanceDialog({ onCreated }: { onCreated: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<string[]>([]);
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
      setBuild("latest");
      setJavaChoice("auto");
    }
  }

  useEffect(() => {
    if (!open || versions.length) return;
    catalog
      .versions("paper")
      .then((v) => {
        setVersions(v.versions);
        setVersion(v.latest);
      })
      .catch((e) => toast.error(`Cannot load Paper versions: ${e.message}`));
  }, [open, versions.length]);

  useEffect(() => {
    if (!open) return;
    java
      .list()
      .then((r) => setRuntimes(r.installed))
      .catch(() => setRuntimes([]));
  }, [open]);

  useEffect(() => {
    if (!version) return;
    let stale = false;
    java
      .required(version)
      .then((r) => {
        if (!stale) setRequiredMajor(r.requiredMajor);
      })
      .catch(() => {});
    catalog
      .builds("paper", version)
      .then((b) => {
        if (!stale) setBuilds(b);
      })
      .catch(() => {
        if (!stale) setBuilds([]);
      });
    return () => {
      stale = true;
    };
  }, [version]);

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
        software: "paper",
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
      onCreated();
      router.push(`/instances/${res.instance.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create instance");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button />}>New instance</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Paper server</DialogTitle>
          <DialogDescription>The jar is downloaded from PaperMC and verified with SHA-256.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                required
                onChange={(e) => {
                  setName(e.target.value);
                  if (!idTouched) setId(slug(e.target.value));
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="id">ID</Label>
              <Input
                id="id"
                value={id}
                required
                pattern="[a-z0-9][a-z0-9-]{1,31}"
                onChange={(e) => {
                  setIdTouched(true);
                  setId(e.target.value);
                }}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Minecraft version</Label>
              <Select value={version} onValueChange={selectVersion}>
                <SelectTrigger>
                  <SelectValue placeholder="Loading…" />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Build</Label>
              <Select value={build} onValueChange={(v) => setBuild(v ?? "latest")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest">Latest stable</SelectItem>
                  {builds.slice(0, 15).map((b) => (
                    <SelectItem key={b.id} value={String(b.id)}>
                      #{b.id} · {b.channel.toLowerCase()} · {new Date(b.time).toLocaleDateString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="memoryMb">Memory (MB)</Label>
              <Input id="memoryMb" name="memoryMb" type="number" min={512} step={256} defaultValue={2048} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="port">Port</Label>
              <Input id="port" name="port" type="number" min={1024} max={65535} defaultValue={25565} />
            </div>
            <div className="grid gap-1.5">
              <Label>JVM flags</Label>
              <Select name="jvm" defaultValue="aikar">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="aikar">Aikar (recommended)</SelectItem>
                  <SelectItem value="basic">Basic</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 grid gap-1.5">
              <Label htmlFor="motd">MOTD</Label>
              <Input id="motd" name="motd" placeholder={name || "A Minecraft Server"} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="maxPlayers">Max players</Label>
              <Input id="maxPlayers" name="maxPlayers" type="number" min={1} defaultValue={20} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Java runtime</Label>
            <Select value={javaChoice} onValueChange={(v) => setJavaChoice(v ?? "auto")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  Automatic{requiredMajor ? ` — Temurin ${requiredMajor} (downloaded if missing)` : ""}
                </SelectItem>
                {runtimes.map((r) => (
                  <SelectItem key={r.id} value={r.id} disabled={requiredMajor !== null && r.major < requiredMajor}>
                    {r.id} · Java {r.version}
                    {requiredMajor !== null && r.major < requiredMajor ? " (too old)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {requiredMajor !== null && (
              <p className="text-xs text-muted-foreground">Minecraft {version} requires Java {requiredMajor} or newer.</p>
            )}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={eula} onCheckedChange={(v) => setEula(v === true)} className="mt-0.5" />
            <span>
              I accept the{" "}
              <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer" className="underline">
                Minecraft EULA
              </a>
            </span>
          </label>
          <Button type="submit" disabled={pending || !eula || !version || !id}>
            {pending ? "Creating…" : "Create and install"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
