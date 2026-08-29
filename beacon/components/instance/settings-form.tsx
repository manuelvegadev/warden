"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { instances, type JavaRuntime, java, type Manifest } from "@/lib/api";

/** Editable instance settings (PATCH /instances/{id}). Changes apply on the next start. */
export function SettingsForm({ manifest, running }: { manifest: Manifest; running: boolean }) {
  const router = useRouter();
  const [runtimes, setRuntimes] = useState<JavaRuntime[]>([]);
  const [preset, setPreset] = useState(manifest.jvmFlagsPreset);
  const [javaChoice, setJavaChoice] = useState(manifest.javaRuntime || "auto");
  const [policy, setPolicy] = useState(manifest.restartPolicy);
  const [autostart, setAutostart] = useState(manifest.autostart);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    java
      .list()
      .then((r) => setRuntimes(r.installed))
      .catch(() => {});
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending(true);
    try {
      await instances.update(manifest.id, {
        name: String(fd.get("name")),
        memoryMb: Number(fd.get("memoryMb")),
        jvmFlagsPreset: preset,
        jvmFlags: preset === "custom" ? String(fd.get("jvmFlags")).split(/\s+/).filter(Boolean) : undefined,
        javaRuntime: javaChoice,
        autostart,
        restartPolicy: policy,
        stopTimeoutSeconds: Number(fd.get("stopTimeout")),
      });
      toast.success(running ? "Saved — applies on the next restart" : "Saved");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid max-w-2xl gap-5">
      <div className="grid gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={manifest.name} required />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="memoryMb">Memory (MB)</Label>
          <Input id="memoryMb" name="memoryMb" type="number" min={512} step={256} defaultValue={manifest.memoryMb} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="stopTimeout">Stop timeout (s)</Label>
          <Input
            id="stopTimeout"
            name="stopTimeout"
            type="number"
            min={5}
            max={600}
            defaultValue={manifest.stopTimeoutSeconds}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <Label>JVM flags</Label>
          <Select value={preset} onValueChange={(v) => v && setPreset(v as Manifest["jvmFlagsPreset"])}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="aikar">Aikar (recommended)</SelectItem>
              <SelectItem value="basic">Basic</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Java runtime</Label>
          <Select value={javaChoice} onValueChange={(v) => setJavaChoice(v ?? "auto")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automatic (by Minecraft version)</SelectItem>
              {runtimes.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.id} · Java {r.version}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {preset === "custom" && (
        <div className="grid gap-1.5">
          <Label htmlFor="jvmFlags">Custom JVM flags</Label>
          <Input
            id="jvmFlags"
            name="jvmFlags"
            defaultValue={(manifest.jvmFlags ?? []).join(" ")}
            className="font-[family-name:var(--font-console)]"
            placeholder="-XX:+UseG1GC …"
          />
          <p className="text-xs text-muted-foreground">-Xms/-Xmx and -jar are added automatically.</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <Label>Restart policy</Label>
          <Select value={policy} onValueChange={(v) => v && setPolicy(v as Manifest["restartPolicy"])}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="never">Never</SelectItem>
              <SelectItem value="on-crash">On crash (with backoff)</SelectItem>
              <SelectItem value="always">Always</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-3 pb-2">
          <Switch id="autostart" checked={autostart} onCheckedChange={setAutostart} />
          <Label htmlFor="autostart">Start with wardend</Label>
        </div>
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {running && (
          <span className="ml-3 text-xs text-muted-foreground">
            The server is running: memory, flags and Java apply on the next start.
          </span>
        )}
      </div>
    </form>
  );
}
