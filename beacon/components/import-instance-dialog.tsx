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
import { Progress } from "@warden/ui/components/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@warden/ui/components/select";
import { FileArchive, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SectionCard, SettingRow } from "@/components/instance/section-card";
import { useInstances } from "@/components/instances-store";
import { formatBytes, instances, SOFTWARE_LABELS } from "@/lib/api";
import { ID_PATTERN, JVM_PRESETS, slugify } from "@/lib/instance-form";
import { mono } from "@/lib/utils";

const ARCHIVE_RE = /\.(zip|tar|tar\.gz|tgz|tar\.zst|tzst)$/i;
const stem = (name: string) => name.replace(ARCHIVE_RE, "");
// Select value for "let wardend detect the software" (an empty string reads as "no value" to the select).
const DETECT = "detect";

/**
 * Creates an instance from an archive of an existing server directory (the folder with
 * server.properties, the world and the jar). wardend detects the software and version from the
 * jar; the fallback selects only matter when the archive carries none.
 */
export function ImportInstanceDialog() {
  const router = useRouter();
  const { importOpen: open, setImportOpen: setOpen, refresh } = useInstances();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [software, setSoftware] = useState(DETECT);
  const [mcVersion, setMcVersion] = useState("");
  const [eula, setEula] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // The store opens the dialog (Home, instance switcher), so the reset keys on `open` itself.
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setName("");
    setId("");
    setIdTouched(false);
    setSoftware(DETECT);
    setMcVersion("");
    setEula(false);
  }, [open]);

  function onOpenChange(next: boolean) {
    if (sent !== null) return; // upload in flight
    setOpen(next);
  }

  function pick(f: File | undefined) {
    if (!f) return;
    if (!ARCHIVE_RE.test(f.name)) {
      toast.error("Use a .zip, .tar, .tar.gz or .tar.zst archive");
      return;
    }
    setFile(f);
    if (!name) {
      setName(stem(f.name));
      if (!idTouched) setId(slugify(stem(f.name)));
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return;
    const fd = new FormData(e.currentTarget);
    setSent(0);
    try {
      const res = await instances.import(
        {
          id,
          name,
          memoryMb: Number(fd.get("memoryMb")),
          port: Number(fd.get("port")),
          jvmFlagsPreset: String(fd.get("jvm")) as "aikar" | "basic",
          acceptEula: eula,
          software: software === DETECT ? undefined : software,
          mcVersion: mcVersion || undefined,
        },
        file,
        (loaded) => setSent(loaded),
      );
      toast.success(`Importing ${res.instance.name}…`);
      setSent(null);
      setOpen(false);
      void refresh();
      router.push(`/instances/${res.instance.id}/console`);
    } catch (err) {
      setSent(null);
      toast.error(err instanceof Error ? err.message : "Import failed");
    }
  }

  const uploading = sent !== null;
  const incomplete = !file || !id || !eula || (software !== DETECT && !mcVersion.trim());
  const softwareItems = { [DETECT]: "Detect from the archive", ...SOFTWARE_LABELS };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 pt-6 pb-4">
          <DialogTitle>Import a server</DialogTitle>
          <DialogDescription>
            Upload an archive of an existing server folder — the one with server.properties, the world and the jar.
            Software and version are read from the jar.
          </DialogDescription>
        </DialogHeader>
        <form id="import-instance" onSubmit={onSubmit} className="grid min-h-0 flex-1 gap-6 overflow-y-auto px-6 py-6">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              pick(e.dataTransfer.files[0]);
            }}
            className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
              dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/60"
            }`}
          >
            {file ? (
              <>
                <FileArchive className="size-8 text-primary" aria-hidden />
                <span className={`text-sm font-medium ${mono}`}>{file.name}</span>
                <span className="text-xs text-muted-foreground">{formatBytes(file.size)} · click to change</span>
              </>
            ) : (
              <>
                <Upload className="size-8 text-muted-foreground" aria-hidden />
                <span className="text-sm font-medium">Drop the archive here or click to choose</span>
                <span className="text-xs text-muted-foreground">.zip, .tar, .tar.gz or .tar.zst</span>
              </>
            )}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,.tar,.gz,.tgz,.zst,.tzst"
            aria-label="Server archive"
            className="sr-only"
            onChange={(e) => pick(e.target.files?.[0])}
          />

          <SectionCard title="Identity" subtitle="How this server appears in Beacon and on disk.">
            <SettingRow id="import-name" label="Name">
              <Input
                id="import-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!idTouched) setId(slugify(e.target.value));
                }}
                required
              />
            </SettingRow>
            <SettingRow id="import-id" label="ID" description="Folder name under servers/. Lowercase, digits, dashes.">
              <Input
                id="import-id"
                value={id}
                onChange={(e) => {
                  setIdTouched(true);
                  setId(e.target.value);
                }}
                pattern={ID_PATTERN}
                required
                className={mono}
              />
            </SettingRow>
          </SectionCard>

          <SectionCard title="Resources" subtitle="Memory and network. The port replaces the one in server.properties.">
            <SettingRow id="import-memoryMb" label="Memory (MB)">
              <Input
                id="import-memoryMb"
                name="memoryMb"
                type="number"
                min={512}
                step={256}
                defaultValue={2048}
                className={mono}
              />
            </SettingRow>
            <SettingRow id="import-port" label="Port" description="RCON is reserved on port + 10.">
              <Input
                id="import-port"
                name="port"
                type="number"
                min={1024}
                max={65535}
                defaultValue={25565}
                className={mono}
              />
            </SettingRow>
            <SettingRow id="import-jvm" label="JVM flags">
              <Select name="jvm" items={JVM_PRESETS} defaultValue="aikar">
                <SelectTrigger id="import-jvm" className="w-full">
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
          </SectionCard>

          <SectionCard
            title="What the server is"
            subtitle="Only needed when the archive has no server jar (it is downloaded) or one wardend cannot identify."
          >
            <SettingRow id="import-software" label="Software">
              <Select items={softwareItems} value={software} onValueChange={(v) => setSoftware(v ?? DETECT)}>
                <SelectTrigger id="import-software" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(softwareItems).map(([v, label]) => (
                    <SelectItem key={v} value={v}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
            <SettingRow
              id="import-version"
              label="Minecraft version"
              description="e.g. 1.21.8 — required with a software."
            >
              <Input
                id="import-version"
                value={mcVersion}
                onChange={(e) => setMcVersion(e.target.value)}
                disabled={software === DETECT}
                required={software !== DETECT}
                className={mono}
              />
            </SettingRow>
          </SectionCard>
        </form>
        <DialogFooter className="mx-0 mb-0 flex-col gap-3 bg-muted px-6 py-4 sm:items-center sm:justify-between">
          {uploading && file ? (
            <div className="grid w-full gap-1 text-sm sm:max-w-xs">
              <span>
                Uploading… {formatBytes(sent)} of {formatBytes(file.size)}
              </span>
              <Progress value={(sent / file.size) * 100} />
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <Checkbox id="import-eula" checked={eula} onCheckedChange={(v) => setEula(v === true)} />
              <Label htmlFor="import-eula" className="font-normal">
                I accept the{" "}
                <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer" className="underline">
                  Minecraft EULA
                </a>
              </Label>
            </div>
          )}
          <div className="flex gap-2 *:flex-1 sm:*:flex-none">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={uploading}>
              Cancel
            </Button>
            <Button type="submit" form="import-instance" disabled={uploading || incomplete}>
              {uploading ? "Uploading…" : "Upload and import"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
