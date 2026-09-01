"use client";

import { Button } from "@warden/ui/components/button";
import { Input } from "@warden/ui/components/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@warden/ui/components/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@warden/ui/components/select";
import { Slider } from "@warden/ui/components/slider";
import { Switch } from "@warden/ui/components/switch";
import { Check, Copy, FileCode2, ListChecks, OctagonAlert, Pencil, TriangleAlert } from "lucide-react";
import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { MotdDialog } from "@/components/instance/motd-dialog";
import { ServerListPreview } from "@/components/instance/motd-preview";
import { SaveBar, SectionCard, SettingRow, useCopy } from "@/components/instance/section-card";
import { useHostCores } from "@/hooks/use-host-cores";
import { useServerIcon } from "@/hooks/use-server-icon";
import { instances, type ServerProperty } from "@/lib/api";
import { enumHelp } from "@/lib/mc/enum-values";
import { parseMotd, wrapMotd } from "@/lib/motd";
import { judgeProperty, type Resources, type Verdict } from "@/lib/server-budget";
import { mono } from "@/lib/utils";

// CodeMirror is heavy; only load it when the user switches to text mode.
const PropertiesRawEditor = dynamic(() => import("./properties-raw-editor").then((m) => m.PropertiesRawEditor), {
  ssr: false,
  loading: () => <p className="py-4 text-sm text-muted-foreground">Loading editor…</p>,
});

type Mode = "form" | "text";

/**
 * Properties worth dragging rather than typing, and what the two ends of the track are trading.
 *
 * A slider only helps when the range is short enough to cross by hand and the number matters less
 * than where it sits between two costs. Everything else keeps its number field: a port, a world
 * border or a watchdog timeout spans thousands or millions, or uses -1 and 0 as "off", and a track
 * cannot say that honestly.
 */
const SLIDER_INTS: Record<string, { low: string; high: string }> = {
  "view-distance": { low: "Lighter server", high: "Players see further" },
  "simulation-distance": { low: "Higher TPS", high: "Mobs and crops tick further out" },
  // 1–4 is a scale as much as a range, and both permission keys read the same way.
  "op-permission-level": { low: "Fewest powers", high: "Full control" },
  "function-permission-level": { low: "Fewest powers", high: "Full control" },
};

/** Enums whose values are a scale, low to high — a slider reads them better than a dropdown. */
const SCALES: Record<string, { low: string; high: string }> = {
  difficulty: { low: "Calmest", high: "Hardest" },
};

export function PropertiesEditor({
  id,
  name,
  mcVersion,
  memoryMb,
  running,
}: {
  id: string;
  name: string;
  mcVersion: string;
  memoryMb: number;
  running: boolean;
}) {
  const [props, setProps] = useState<ServerProperty[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("form");
  const [motdOpen, setMotdOpen] = useState(false);
  // Bumped when the dialog writes a new icon, so the row's <img> refetches it.
  const [iconVersion, setIconVersion] = useState(0);
  // The machine's cores, not this instance's: wardend does not pin one to the other, so the CPU
  // budget is optimistic when several instances run at once. Null until the fetch lands — the
  // budget then reports nothing rather than guessing one core and flashing a red slider.
  const cores = useHostCores();

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
  const { identity, common, advanced, visible } = useMemo(() => {
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
    return {
      identity: list.find((p) => p.key === "motd"),
      common: list.filter((p) => p.common && p.key !== "motd"),
      advanced,
      visible: list.length,
    };
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

  const byKey = useMemo(() => new Map((props ?? []).map((p) => [p.key, p])), [props]);
  const motd = byKey.get("motd"); // the record, whatever the search filter shows
  const currentValue = (key: string) => draft[key] ?? byKey.get(key)?.value;
  const maxPlayers = currentValue("max-players");

  // What the performance settings are judged against. max-players is the planning number: a server
  // only falls over when it is full, so that is the load the budget assumes. Memoised because it
  // reaches every row, and a fresh object each render would defeat PropertyRow's memo.
  const viewDistance = Number(currentValue("view-distance"));
  const simulationDistance = Number(currentValue("simulation-distance"));
  const players = Number(maxPlayers);
  const resources: Resources | null = useMemo(() => {
    const known = [cores, players, viewDistance, simulationDistance].every((n) => Number.isFinite(n));
    return known && cores ? { memoryMb, cores, players, viewDistance, simulationDistance } : null;
  }, [memoryMb, cores, players, viewDistance, simulationDistance]);

  if (!props) return <p className="py-4 text-sm text-muted-foreground">Loading…</p>;

  const row = (p: ServerProperty) => (
    <PropertyRow
      key={p.key}
      p={p}
      value={draft[p.key] ?? p.value}
      running={running}
      onChange={setValue}
      resources={resources}
    />
  );

  return (
    <div className="grid gap-8">
      {motd && (
        <MotdDialog
          id={id}
          serverName={name}
          version={mcVersion}
          maxPlayers={maxPlayers}
          value={draft.motd ?? motd.value}
          open={motdOpen}
          onOpenChange={setMotdOpen}
          onApply={(v, iconChanged) => {
            setValue(motd, v);
            if (iconChanged) setIconVersion((n) => n + 1);
          }}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <ModeToggle mode={mode} onChange={setMode} />
        {mode === "form" ? (
          <>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search properties (key, description or value)…"
              className="min-w-0 flex-1 basis-full sm:max-w-md sm:basis-auto"
              type="search"
            />
            <span className="whitespace-nowrap text-xs text-muted-foreground">
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
          {identity && (
            <div className="grid min-w-0 gap-3">
              <div>
                <h3 className="text-base font-semibold leading-tight">Identity</h3>
                <p className="text-xs text-muted-foreground">
                  How the server introduces itself in the multiplayer list.
                </p>
              </div>
              <MotdRowPreview
                id={id}
                name={name}
                version={mcVersion}
                players={maxPlayers ? `0/${maxPlayers}` : undefined}
                value={draft.motd ?? identity.value}
                dirty={draft.motd !== undefined}
                iconVersion={iconVersion}
                onEdit={() => setMotdOpen(true)}
              />
            </div>
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
          <SaveBar
            dirty={dirty}
            pending={pending}
            count={Object.keys(draft).length}
            onDiscard={() => setDraft({})}
            onSave={save}
          />
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
  resources,
}: {
  p: ServerProperty;
  value: string;
  running: boolean;
  onChange: (p: ServerProperty, v: string) => void;
  resources: Resources | null;
}) {
  const hint = (text: string) => (
    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{text}</span>
  );
  return (
    <SettingRow
      id={`prop-${p.key}`}
      label={<span className={`${mono} text-xs`}>{p.key}</span>}
      description={p.description}
      dirty={value !== p.value}
      // A scale reads as a whole: full width under the label, with the chosen value explained
      // beneath it, rather than squeezed into the control column.
      stack={p.type === "enum" && !!SCALES[p.key]}
      badges={
        <>
          {p.requiresRestart && running && hint("restart")}
          {p.managed && hint("managed")}
        </>
      }
    >
      <Field p={p} value={value} onChange={(v) => onChange(p, v)} resources={resources} />
    </SettingRow>
  );
});

/**
 * The Identity section's whole body: the multiplayer list entry at GUI scale 1, which is exactly
 * what the client draws — and the button that opens the editor.
 */
function MotdRowPreview({
  id,
  value,
  name,
  version,
  players,
  dirty,
  iconVersion,
  onEdit,
}: {
  id: string;
  value: string;
  name: string;
  version: string;
  players?: string;
  dirty: boolean;
  iconVersion: number;
  onEdit: () => void;
}) {
  const icon = useServerIcon(id, iconVersion);

  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label="Edit the message of the day and the server icon"
      className={`group/motd relative block w-full min-w-0 cursor-pointer rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${dirty ? "ring-2 ring-primary" : ""}`}
    >
      {/* Scale 2, the GUI scale most people play at; the preview shrinks itself if the column is
          narrower than that needs. */}
      <ServerListPreview
        scale={2}
        name={name}
        iconSrc={icon}
        lines={wrapMotd(parseMotd(value))}
        version={version}
        players={players}
      />
      <span className="pointer-events-none absolute inset-0 grid place-content-center rounded-lg bg-background/80 opacity-0 transition-opacity group-hover/motd:opacity-100">
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <Pencil className="size-3.5" /> {dirty ? "Unsaved — edit again" : "Edit"}
        </span>
      </span>
    </button>
  );
}

function Field({
  p,
  value,
  onChange,
  resources,
}: {
  p: ServerProperty;
  value: string;
  onChange: (v: string) => void;
  resources: Resources | null;
}) {
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
    case "enum": {
      const scale = SCALES[p.key];
      if (scale && p.enum) {
        return (
          <ScaleField
            id={id}
            propertyKey={p.key}
            value={value}
            options={p.enum}
            disabled={disabled}
            onChange={onChange}
            {...scale}
          />
        );
      }
      return (
        <Select value={value} onValueChange={(v) => v && onChange(v)} disabled={disabled}>
          {/* The trigger sizes to its content by default; full width keeps the column of controls
              lined up with the text and number fields beside it. */}
          <SelectTrigger id={id} className="w-full">
            {/* Render the value ourselves: the items carry a description, and it must not end up
                in the trigger. */}
            <SelectValue>{(v) => <span className="truncate">{String(v)}</span>}</SelectValue>
          </SelectTrigger>
          <SelectContent
            fit={p.enum?.some((e) => enumHelp(p.key, e)) ? "content" : "trigger"}
            className="max-w-[min(26rem,calc(100vw-2rem))]"
          >
            {p.enum?.map((e) => {
              const help = enumHelp(p.key, e);
              return (
                <SelectItem key={e} value={e} className={help ? "items-start py-1.5" : undefined}>
                  <span className="flex flex-col gap-0.5 whitespace-normal">
                    <span>{e}</span>
                    {help && <span className="text-xs leading-snug text-muted-foreground">{help}</span>}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      );
    }
    case "int": {
      const ends = SLIDER_INTS[p.key];
      if (ends && p.min !== undefined && p.max !== undefined) {
        return (
          <RangeField
            id={id}
            value={value}
            min={p.min}
            max={p.max}
            disabled={disabled}
            onChange={onChange}
            verdict={resources && judgeProperty(p.key, Number(value), resources, p.min, p.max)}
            {...ends}
          />
        );
      }
      const verdict = resources && judgeProperty(p.key, Number(value), resources, p.min, p.max);
      return (
        <div className="grid gap-1.5">
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
          {verdict?.reason && <Warning verdict={verdict} />}
        </div>
      );
    }
    default:
      return <TextField id={id} value={value} disabled={disabled} onChange={onChange} />;
  }
}

/**
 * A string property. Only these are worth copying — a switch or a dropdown has nothing to put on
 * the clipboard — so the button lives inside the field rather than beside every row. The addon is
 * a flex sibling of the input, so it takes its own width and never sits on top of the text.
 */
function TextField({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const { copied, copy } = useCopy(value);
  return (
    <InputGroup className="h-9">
      <InputGroupInput
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={mono}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label="Copy value"
          title="Copy value"
          onClick={copy}
          className="opacity-0 transition-opacity group-focus-within/input-group:opacity-100 group-hover/input-group:opacity-100 focus-visible:opacity-100"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

/** The two ends of a slider, saying what each direction costs. */
function Ends({ low, high }: { low: string; high: string }) {
  return (
    <div className="flex justify-between gap-2 text-[10px] leading-tight text-muted-foreground">
      <span>{low}</span>
      <span className="text-right">{high}</span>
    </div>
  );
}

/** A bounded number: drag it, or type the exact value in the box beside it. */
function RangeField({
  id,
  value,
  min,
  max,
  low,
  high,
  disabled,
  onChange,
  verdict,
}: {
  id: string;
  value: string;
  min: number;
  max: number;
  low: string;
  high: string;
  disabled?: boolean;
  onChange: (v: string) => void;
  verdict?: Verdict | null;
}) {
  const n = Number(value);
  const current = Number.isFinite(n) ? Math.min(Math.max(n, min), max) : min;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-3">
        <Slider
          id={id}
          value={[current]}
          min={min}
          max={max}
          step={1}
          disabled={disabled}
          // The slider is a shortcut, not the source of truth: typing still wins, and a value
          // already outside the range is clamped for the thumb but left alone in the field.
          onValueChange={(v) => onChange(String(Array.isArray(v) ? v[0] : v))}
          className={`flex-1 ${RANGE_TINT[verdict?.level ?? "ok"]}`}
        />
        <span className={`${mono} w-8 shrink-0 text-right text-sm tabular-nums ${VALUE_TINT[verdict?.level ?? "ok"]}`}>
          {value}
        </span>
      </div>
      {verdict?.reason ? <Warning verdict={verdict} /> : <Ends low={low} high={high} />}
    </div>
  );
}

/** The filled part of the track carries the verdict — green while it fits, amber past the point
    guides call useful, red once the instance cannot afford it. */
const RANGE_TINT: Record<Verdict["level"], string> = {
  ok: "[&_[data-slot=slider-range]]:bg-emerald-500",
  caution: "[&_[data-slot=slider-range]]:bg-amber-500",
  over: "[&_[data-slot=slider-range]]:bg-destructive",
};

/** A triangle for "this is more than you want", an octagon for "this will not run". */
function Warning({ verdict }: { verdict: Verdict }) {
  const Icon = verdict.level === "over" ? OctagonAlert : TriangleAlert;
  return (
    <p className={`flex gap-1.5 text-[11px] leading-snug ${VALUE_TINT[verdict.level]}`}>
      <Icon className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>{verdict.reason}</span>
    </p>
  );
}

const VALUE_TINT: Record<Verdict["level"], string> = {
  ok: "text-foreground",
  caution: "text-amber-500",
  over: "text-destructive",
};

/**
 * An enum whose values are a scale. The track has one stop per value and the labels sit under it,
 * so the order is visible instead of hidden behind a dropdown.
 */
function ScaleField({
  id,
  propertyKey,
  value,
  options,
  low,
  high,
  disabled,
  onChange,
}: {
  id: string;
  propertyKey: string;
  value: string;
  options: string[];
  low: string;
  high: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const index = Math.max(0, options.indexOf(value));
  const help = enumHelp(propertyKey, value);
  return (
    <div className="grid gap-2.5 py-2">
      <Slider
        id={id}
        value={[index]}
        min={0}
        max={options.length - 1}
        step={1}
        disabled={disabled}
        onValueChange={(v) => onChange(options[Array.isArray(v) ? v[0] : v])}
        aria-valuetext={value}
      />
      <div className="flex justify-between gap-1 text-[10px] leading-tight">
        {options.map((o, i) => (
          <span key={o} className={i === index ? "font-medium text-foreground" : "text-muted-foreground"}>
            {o}
          </span>
        ))}
      </div>
      {help ? <p className="text-[11px] leading-snug text-muted-foreground">{help}</p> : <Ends low={low} high={high} />}
    </div>
  );
}
