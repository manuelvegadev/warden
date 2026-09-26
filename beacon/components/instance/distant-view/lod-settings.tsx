"use client";

import { Button } from "@warden/ui/components/button";
import { Input } from "@warden/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@warden/ui/components/select";
import { Switch } from "@warden/ui/components/switch";
import { ExternalLink, Save } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useInstance } from "@/components/instance/instance-context";
import { SettingRow } from "@/components/instance/section-card";
import { can } from "@/lib/access";
import { type LodConfig, type LodKey, type LodKind, lod } from "@/lib/api";
import { instanceHref } from "@/lib/instance-routes";
import { parseSetting } from "@/lib/lod";

/** "Default 1024 · 1–4096" (int, one or both bounds), "Default on" (bool), "Default high" (enum). */
function defaultHint(k: LodKey): string {
  if (k.type === "bool") return `Default ${k.default ? "on" : "off"}`;
  if (k.type === "enum") return `Default ${k.default}`;
  const range =
    k.min !== undefined && k.max !== undefined
      ? `${k.min}–${k.max}`
      : k.min !== undefined
        ? `≥ ${k.min}`
        : k.max !== undefined
          ? `≤ ${k.max}`
          : undefined;
  return range ? `Default ${k.default} · ${range}` : `Default ${k.default}`;
}

/** The plugin's main settings; what applies live is applied, the rest waits for "Restart to apply". */
export function LodSettings({ kind, configPath }: { kind: LodKind; configPath: string }) {
  const { manifest, role, restartToApply } = useInstance();
  const id = manifest.id;
  const allowed = can(role, "config.write");
  const [cfg, setCfg] = useState<LodConfig | null>(null);
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    lod
      .config(id, kind)
      .then((c) => {
        setCfg(c);
        setDraft({});
      })
      .catch(() => setCfg(null));
  }, [id, kind, allowed]);

  if (!allowed || !cfg) return null;
  const errors = Object.fromEntries(
    Object.entries(draft).map(([name, v]) => {
      const key = cfg.keys.find((k) => k.name === name);
      return [name, key ? parseSetting(key, v).error : "Unknown"];
    }),
  );
  const dirty = Object.keys(draft).length > 0;
  const valid = Object.values(errors).every((e) => !e);

  async function save() {
    if (!cfg) return;
    const values: Record<string, number | boolean | string> = {};
    for (const [name, v] of Object.entries(draft)) {
      const key = cfg.keys.find((k) => k.name === name);
      const parsed = key && parseSetting(key, v);
      if (parsed?.value !== undefined) values[name] = parsed.value;
    }
    setSaving(true);
    try {
      const r = await lod.saveConfig(id, kind, values);
      if (r.restart.length) restartToApply("distant view");
      toast.success(
        r.applied.length
          ? `Applied ${r.applied.length} now${r.restart.length ? `, ${r.restart.length} on restart` : ""}`
          : "Saved",
      );
      setCfg({ ...cfg, values: { ...cfg.values, ...values } });
      setDraft({});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between px-5 py-3">
        <span className="text-sm font-medium">Settings</span>
        <Link
          href={`${instanceHref(id, "config")}?file=${encodeURIComponent(configPath)}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Edit file <ExternalLink className="size-3" />
        </Link>
      </div>
      {!cfg.exists && (
        <p className="px-5 py-3 text-xs text-muted-foreground">
          Start the server once so the plugin writes its configuration.
        </p>
      )}
      {cfg.keys.map((k) => {
        const current = cfg.values[k.name];
        const value = draft[k.name] ?? (k.type === "bool" ? Boolean(current) : String(current));
        const set = (v: string | boolean) =>
          setDraft((d) => {
            const next = { ...d, [k.name]: v };
            if (String(v) === String(current)) delete next[k.name];
            return next;
          });
        return (
          <SettingRow
            key={k.name}
            id={`lod-${k.name}`}
            label={k.label}
            description={[k.help, defaultHint(k), errors[k.name]].filter(Boolean).join(" · ") || undefined}
            dirty={k.name in draft}
            badges={
              <span className="text-[10px] text-muted-foreground uppercase">{k.live ? "live" : "on restart"}</span>
            }
          >
            {k.type === "bool" ? (
              <Switch id={`lod-${k.name}`} checked={value === true} disabled={!cfg.exists} onCheckedChange={set} />
            ) : k.type === "enum" ? (
              <Select value={String(value)} onValueChange={(v) => v !== null && set(v)} disabled={!cfg.exists}>
                <SelectTrigger id={`lod-${k.name}`} className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {k.options?.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={`lod-${k.name}`}
                className="w-32"
                inputMode="numeric"
                value={String(value)}
                disabled={!cfg.exists}
                onChange={(e) => set(e.target.value)}
              />
            )}
          </SettingRow>
        );
      })}
      {dirty && (
        <div className="flex justify-end gap-2 px-5 py-3">
          <Button variant="outline" size="sm" onClick={() => setDraft({})}>
            Discard
          </Button>
          <Button size="sm" disabled={!valid || saving} onClick={save}>
            <Save className="size-4" /> Save
          </Button>
        </div>
      )}
    </>
  );
}
