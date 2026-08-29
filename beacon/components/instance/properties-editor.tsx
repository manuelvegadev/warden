"use client";

import { Check, Copy, FileCode2, ListChecks } from "lucide-react";
import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { SectionCard } from "@/components/instance/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { instances, type ServerProperty } from "@/lib/api";
import { mono } from "@/lib/utils";

// CodeMirror is heavy; only load it when the user switches to text mode.
const PropertiesRawEditor = dynamic(() => import("./properties-raw-editor").then((m) => m.PropertiesRawEditor), {
  ssr: false,
  loading: () => <p className="py-4 text-sm text-muted-foreground">Loading editor…</p>,
});

type Mode = "form" | "text";

/** server.properties editor driven by the daemon's schema; saves only changed keys. */
export function PropertiesEditor({ id, running }: { id: string; running: boolean }) {
  const [props, setProps] = useState<ServerProperty[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("form");

  const load = useCallback(
    () =>
      instances
        .properties(id)
        .then((p) => {
          setProps(p);
          setDraft({});
        })
        .catch((e) => toast.error(e.message)),
    [id],
  );
  useEffect(() => {
    load();
  }, [load]);

  // Group order follows the schema order returned by the daemon; "Other" (unknown keys) starts collapsed.
  const { common, advanced, visible } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (p: ServerProperty) =>
      !q || p.key.includes(q) || p.description.toLowerCase().includes(q) || p.value.toLowerCase().includes(q);
    const list = (props ?? []).filter(match);
    const advanced = new Map<string, ServerProperty[]>();
    for (const p of list) {
      if (p.common) continue;
      const group = advanced.get(p.group);
      if (group) group.push(p);
      else advanced.set(p.group, [p]);
    }
    return { common: list.filter((p) => p.common), advanced, visible: list.length };
  }, [props, query]);

  const dirty = Object.keys(draft).length > 0;
  const setValue = useCallback((p: ServerProperty, v: string) => {
    setDraft((d) => {
      const next = { ...d };
      if (v === p.value) delete next[p.key];
      else next[p.key] = v;
      return next;
    });
  }, []);

  async function save() {
    setPending(true);
    try {
      const { restartRequired } = await instances.updateProperties(id, draft);
      toast.success(restartRequired ? "Saved — restart the server to apply" : "Saved");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setPending(false);
    }
  }

  if (!props) return <p className="py-4 text-sm text-muted-foreground">Loading…</p>;

  const row = (p: ServerProperty) => (
    <PropertyRow key={p.key} p={p} value={draft[p.key] ?? p.value} running={running} onChange={setValue} />
  );

  return (
    <div className="grid gap-8">
      <div className="mt-2 flex items-center gap-3">
        <ModeToggle mode={mode} onChange={setMode} />
        {mode === "form" ? (
          <>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search properties (key, description or value)…"
              className="max-w-md"
              type="search"
            />
            <span className="text-xs text-muted-foreground">
              {visible} of {props.length}
            </span>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">Editing server.properties as text</span>
        )}
      </div>

      {mode === "text" && <PropertiesRawEditor id={id} running={running} onSaved={load} />}

      {mode === "form" && (
        <>
          {visible === 0 && <p className="text-sm text-muted-foreground">No property matches “{query}”.</p>}
          {running && (
            <p className="text-xs text-muted-foreground">
              The server is running: most keys apply on the next start. wardend keeps edits saved now even though the
              server rewrites this file when it stops.
            </p>
          )}
          {common.length > 0 && (
            <SectionCard title="Common" subtitle="The settings most servers change.">
              {common.map(row)}
            </SectionCard>
          )}
          {advanced.size > 0 && (
            <div className="grid gap-3">
              <div>
                <h3 className="text-base font-semibold">Advanced</h3>
                <p className="text-xs text-muted-foreground">Everything else, by area.</p>
              </div>
              {[...advanced].map(([group, items]) => (
                <SectionCard key={group} title={group} collapsible defaultOpen={group !== "Other"}>
                  {items.map(row)}
                </SectionCard>
              ))}
            </div>
          )}
          <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur">
            {dirty && (
              <Button variant="ghost" onClick={() => setDraft({})}>
                Discard
              </Button>
            )}
            <Button onClick={save} disabled={!dirty || pending}>
              {pending ? "Saving…" : `Save ${dirty ? `(${Object.keys(draft).length})` : ""}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const item = (value: Mode, Icon: typeof ListChecks, label: string) => (
    <Button
      size="sm"
      variant={mode === value ? "secondary" : "ghost"}
      className="h-7 gap-1.5 px-2"
      aria-pressed={mode === value}
      onClick={() => onChange(value)}
    >
      <Icon className="size-3.5" /> {label}
    </Button>
  );
  return (
    <div className="flex rounded-md border p-0.5">
      {item("form", ListChecks, "Form")}
      {item("text", FileCode2, "Text")}
    </div>
  );
}

const PropertyRow = memo(function PropertyRow({
  p,
  value,
  running,
  onChange,
}: {
  p: ServerProperty;
  value: string;
  running: boolean;
  onChange: (p: ServerProperty, v: string) => void;
}) {
  const dirty = value !== p.value;
  return (
    <div
      className={`group flex items-center gap-4 px-5 py-3 ${dirty ? "bg-primary/5 shadow-[inset_2px_0_0_0_var(--primary)]" : ""}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Label htmlFor={`prop-${p.key}`} className={`${mono} text-xs`}>
            {p.key}
          </Label>
          {p.requiresRestart && running && (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">restart</span>
          )}
          {p.managed && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">managed</span>}
        </div>
        {p.description && <p className="mt-0.5 text-xs text-muted-foreground">{p.description}</p>}
      </div>
      <div className="w-56 shrink-0">
        <Field p={p} value={value} onChange={(v) => onChange(p, v)} />
      </div>
      <CopyButton value={value} />
    </div>
  );
});

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Copy value"
      title="Copy value"
      className="size-7 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          toast.error("Clipboard unavailable");
        }
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

function Field({ p, value, onChange }: { p: ServerProperty; value: string; onChange: (v: string) => void }) {
  const disabled = p.managed;
  const id = `prop-${p.key}`;
  switch (p.type) {
    case "bool":
      return (
        <div className="flex h-9 items-center justify-end">
          <Switch
            id={id}
            checked={value === "true"}
            disabled={disabled}
            onCheckedChange={(c) => onChange(c ? "true" : "false")}
          />
        </div>
      );
    case "enum":
      return (
        <Select value={value} onValueChange={(v) => v && onChange(v)} disabled={disabled}>
          <SelectTrigger id={id}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {p.enum?.map((e) => (
              <SelectItem key={e} value={e}>
                {e}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "int":
      return (
        <Input
          id={id}
          type="number"
          value={value}
          min={p.min}
          max={p.max}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={mono}
        />
      );
    default:
      return (
        <Input id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={mono} />
      );
  }
}
