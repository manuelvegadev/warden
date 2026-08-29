"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { SaveBar, SectionCard, SettingRow } from "@/components/instance/section-card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { instances, type JavaRuntime, java, type Manifest } from "@/lib/api";
import { mono } from "@/lib/utils";

/** The editable subset of the manifest, as form state. */
interface Draft {
  name: string;
  memoryMb: number;
  stopTimeoutSeconds: number;
  jvmFlagsPreset: Manifest["jvmFlagsPreset"];
  jvmFlags: string;
  javaRuntime: string;
  restartPolicy: Manifest["restartPolicy"];
  autostart: boolean;
}

const fromManifest = (m: Manifest): Draft => ({
  name: m.name,
  memoryMb: m.memoryMb,
  stopTimeoutSeconds: m.stopTimeoutSeconds,
  jvmFlagsPreset: m.jvmFlagsPreset,
  jvmFlags: (m.jvmFlags ?? []).join(" "),
  javaRuntime: m.javaRuntime || "auto",
  restartPolicy: m.restartPolicy,
  autostart: m.autostart,
});

const PRESETS = { aikar: "Aikar (recommended)", basic: "Basic", custom: "Custom" };
const POLICIES = { never: "Never", "on-crash": "On crash", always: "Always" };

/** Instance settings (PATCH /instances/{id}), laid out like Properties: sectioned cards of rows. */
export function SettingsForm({ manifest, running }: { manifest: Manifest; running: boolean }) {
  const router = useRouter();
  const [runtimes, setRuntimes] = useState<JavaRuntime[]>([]);
  // Only edits are state: the baseline is derived from the manifest, so an upgrade or another
  // session changing it resyncs automatically without touching what the user is typing.
  const saved = useMemo(() => fromManifest(manifest), [manifest]);
  const [edits, setEdits] = useState<Partial<Draft>>({});
  const draft: Draft = { ...saved, ...edits };
  const [pending, setPending] = useState(false);

  useEffect(() => {
    java
      .list()
      .then((r) => setRuntimes(r.installed))
      .catch(() => {});
  }, []);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setEdits((e) => ({ ...e, [key]: value }));
  const changed = (Object.keys(edits) as (keyof Draft)[]).filter((k) => edits[k] !== saved[k]);
  const dirty = changed.length > 0;

  async function save() {
    setPending(true);
    try {
      await instances.update(manifest.id, {
        name: draft.name,
        memoryMb: draft.memoryMb,
        jvmFlagsPreset: draft.jvmFlagsPreset,
        jvmFlags: draft.jvmFlagsPreset === "custom" ? draft.jvmFlags.split(/\s+/).filter(Boolean) : undefined,
        javaRuntime: draft.javaRuntime,
        autostart: draft.autostart,
        restartPolicy: draft.restartPolicy,
        stopTimeoutSeconds: draft.stopTimeoutSeconds,
      });
      toast.success(running ? "Saved — applies on the next restart" : "Saved");
      setEdits({});
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPending(false);
    }
  }

  const row = (key: keyof Draft, label: string, description: string, control: React.ReactNode, wide = false) => (
    <SettingRow
      key={key}
      id={`setting-${key}`}
      label={label}
      description={description}
      dirty={draft[key] !== saved[key]}
      wide={wide}
    >
      {control}
    </SettingRow>
  );

  return (
    <div className="grid gap-8">
      <SectionCard title="General" subtitle="Identity and resources of this server.">
        {row(
          "name",
          "Name",
          "Shown in the sidebar and breadcrumbs.",
          <Input id="setting-name" value={draft.name} onChange={(e) => set("name", e.target.value)} required />,
        )}
        {row(
          "memoryMb",
          "Memory (MB)",
          "Heap size: -Xms and -Xmx are both set to this value.",
          <Input
            id="setting-memoryMb"
            type="number"
            min={512}
            step={256}
            value={draft.memoryMb}
            onChange={(e) => set("memoryMb", Number(e.target.value))}
            className={mono}
          />,
        )}
        {row(
          "stopTimeoutSeconds",
          "Stop timeout (s)",
          "How long to wait after `stop` before sending SIGTERM.",
          <Input
            id="setting-stopTimeoutSeconds"
            type="number"
            min={5}
            max={600}
            value={draft.stopTimeoutSeconds}
            onChange={(e) => set("stopTimeoutSeconds", Number(e.target.value))}
            className={mono}
          />,
        )}
      </SectionCard>

      <SectionCard title="Java" subtitle="Runtime and JVM flags used to launch the server.">
        {row(
          "javaRuntime",
          "Java runtime",
          "Automatic picks the Temurin release Minecraft requires.",
          <Select
            items={{
              auto: "Automatic",
              ...Object.fromEntries(runtimes.map((r) => [r.id, `${r.id} · Java ${r.version}`])),
            }}
            value={draft.javaRuntime}
            onValueChange={(v) => set("javaRuntime", v ?? "auto")}
          >
            <SelectTrigger id="setting-javaRuntime" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automatic</SelectItem>
              {runtimes.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.id} · Java {r.version}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>,
        )}
        {row(
          "jvmFlagsPreset",
          "JVM flags",
          "Aikar's flags are the community-tuned G1GC set for Paper.",
          <Select
            items={PRESETS}
            value={draft.jvmFlagsPreset}
            onValueChange={(v) => v && set("jvmFlagsPreset", v as Manifest["jvmFlagsPreset"])}
          >
            <SelectTrigger id="setting-jvmFlagsPreset" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PRESETS).map(([v, label]) => (
                <SelectItem key={v} value={v}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>,
        )}
        {draft.jvmFlagsPreset === "custom" &&
          row(
            "jvmFlags",
            "Custom JVM flags",
            "-Xms/-Xmx and -jar are added automatically.",
            <Input
              id="setting-jvmFlags"
              value={draft.jvmFlags}
              onChange={(e) => set("jvmFlags", e.target.value)}
              className={mono}
              placeholder="-XX:+UseG1GC …"
            />,
            true,
          )}
      </SectionCard>

      <SectionCard title="Lifecycle" subtitle="What wardend does when the server exits or the daemon starts.">
        {row(
          "restartPolicy",
          "Restart policy",
          "On crash retries with backoff; Always also restarts after a clean stop from the game.",
          <Select
            items={POLICIES}
            value={draft.restartPolicy}
            onValueChange={(v) => v && set("restartPolicy", v as Manifest["restartPolicy"])}
          >
            <SelectTrigger id="setting-restartPolicy" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(POLICIES).map(([v, label]) => (
                <SelectItem key={v} value={v}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>,
        )}
        {row(
          "autostart",
          "Start with wardend",
          "Launch this server when the daemon boots.",
          <div className="flex h-9 items-center justify-end">
            <Switch id="setting-autostart" checked={draft.autostart} onCheckedChange={(c) => set("autostart", c)} />
          </div>,
        )}
      </SectionCard>

      <SaveBar
        dirty={dirty}
        pending={pending}
        count={changed.length}
        hint={running && dirty ? "Applies on the next restart." : undefined}
        onDiscard={() => setEdits({})}
        onSave={save}
      />
    </div>
  );
}
