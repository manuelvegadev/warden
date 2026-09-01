"use client";

import { Alert, AlertDescription } from "@warden/ui/components/alert";
import { Button } from "@warden/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@warden/ui/components/dialog";
import { Label } from "@warden/ui/components/label";
import { Slider } from "@warden/ui/components/slider";
import { Bold, Italic, Shuffle, Strikethrough, TriangleAlert, Underline } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MotdText, ServerListPreview } from "@/components/instance/motd-preview";
import { CopyButton } from "@/components/instance/section-card";
import { useServerIcon } from "@/hooks/use-server-icon";
import { instances } from "@/lib/api";
import {
  blankStyle,
  COLORS,
  fromChars,
  lineWidth,
  MAX_LINE_PX,
  MAX_LINES,
  parseMotd,
  type Run,
  SECTION,
  type Style,
  type StyleKey,
  scrambleObfuscated,
  serializeMotd,
  shadowColor,
  toChars,
  wrapMotd,
} from "@/lib/motd";
import { locate, offsetIn, readAll } from "@/lib/motd-surface";

const ICON_PX = 64;

const PRESETS: [name: string, codes: string, lines: Run[][]][] = (
  [
    ["Clean", "§6§lA Minecraft Server\n§7survival §8· §fwhitelist §a✔"],
    ["Neon", "§x§0§0§d§4§f§f§lSERVER\n§d▸ §fseason 1 §d▸"],
    ["Rustic", "§2§lThe Old World\n§6hardcore §8| §evanilla+"],
  ] as const
).map(([name, codes]) => [name, codes, wrapMotd(parseMotd(codes))]);

/**
 * The message of the day, and the icon beside it — one dialog, because to the person looking at
 * their multiplayer list they are one thing.
 *
 * The editing surface is a contenteditable painted with the game's own faces rather than a
 * textarea under a mirror. A textarea lays out a single weight, and Minecraft's bold advances one
 * pixel more per glyph, so the selection would sit narrower than the text it was selecting. Here
 * the browser measures against the glyphs you can see.
 *
 * The message is handed back to the Properties form and saved with everything else; the icon is
 * not a property, so it goes straight to the daemon when you apply.
 */
export function MotdDialog({
  id,
  serverName,
  version,
  maxPlayers,
  value,
  open,
  onOpenChange,
  onApply,
}: {
  id: string;
  serverName: string;
  version: string;
  maxPlayers?: string;
  value: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (motd: string, iconChanged: boolean) => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const model = useRef<{ text: string; styles: Style[] }>({ text: "", styles: [] });
  const [lines, setLines] = useState<Run[][]>([]);

  const readSelection = (): [number, number] | null => {
    const el = surface.current;
    const sel = window.getSelection();
    if (!el || !sel?.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!el.contains(r.startContainer) || !el.contains(r.endContainer)) return null;
    return [offsetIn(el, r.startContainer, r.startOffset), offsetIn(el, r.endContainer, r.endOffset)];
  };

  /* ── painting ───────────────────────────────────────────────────────────── */

  /** Repaint the surface from the model, restoring `caret` once the DOM is rebuilt. */
  const repaint = useCallback((caret?: [number, number]) => {
    const el = surface.current;
    if (!el) return;
    const { text, styles } = model.current;
    const hard = fromChars(text, styles);

    el.textContent = "";
    hard.forEach((runs, i) => {
      if (i) el.appendChild(document.createTextNode("\n"));
      for (const r of runs) {
        const span = document.createElement("span");
        span.className = "mc-shadow";
        span.style.color = r.color;
        span.style.setProperty("--mc-shadow", shadowColor(r.color));
        span.style.fontWeight = r.bold ? "700" : "400";
        span.style.fontStyle = r.italic ? "italic" : "normal";
        const decoration = [r.under && "underline", r.strike && "line-through"].filter(Boolean).join(" ");
        if (decoration) span.style.textDecoration = decoration;
        span.textContent = r.text;
        if (r.obf) span.dataset.obf = r.text;
        el.appendChild(span);
      }
    });
    // pre-wrap gives a trailing newline no height of its own
    if (text.endsWith("\n")) {
      const pad = document.createElement("br");
      pad.dataset.pad = "1";
      el.appendChild(pad);
    }

    if (caret) {
      const range = document.createRange();
      const [n1, o1] = locate(el, caret[0]);
      const [n2, o2] = locate(el, caret[1]);
      range.setStart(n1, o1);
      range.setEnd(n2, o2);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }

    setLines(hard);
  }, []);

  const setModel = useCallback(
    (src: string) => {
      model.current = toChars(parseMotd(src));
      repaint();
    },
    [repaint],
  );

  // The surface only exists while the dialog is open, and Radix mounts it after our effects run,
  // so the model is loaded when the node itself arrives rather than when `open` flips.
  const attachSurface = useCallback(
    (el: HTMLDivElement | null) => {
      surface.current = el;
      if (el) setModel(value);
    },
    [setModel, value],
  );

  // Obfuscated runs scramble in place. Replacing the text node would take the caret with it, so
  // the run you are editing sits this tick out.
  const obfuscated = lines.some((runs) => runs.some((r) => r.obf));
  useEffect(() => {
    if (!open || !obfuscated) return;
    const t = setInterval(() => {
      const el = surface.current;
      if (!el) return;
      const anchor = window.getSelection()?.anchorNode ?? null;
      for (const node of Array.from(el.querySelectorAll<HTMLElement>("[data-obf]"))) {
        if (anchor && node.contains(anchor)) continue;
        node.textContent = scrambleObfuscated(node.dataset.obf ?? "");
      }
    }, 70);
    return () => clearInterval(t);
  }, [open, obfuscated]);

  /* ── editing ────────────────────────────────────────────────────────────── */

  /** The selection, or the word under the caret when nothing is selected. */
  const activeRange = (): [number, number] => {
    const { text } = model.current;
    let [s, e] = readSelection() ?? [0, text.length];
    if (s === e) {
      while (s > 0 && !/\s/.test(text[s - 1])) s--;
      while (e < text.length && !/\s/.test(text[e])) e++;
    }
    return [s, e];
  };

  const apply = (fn: (st: Style, i: number, from: number, to: number) => Style) => {
    const [s, e] = activeRange();
    const { styles } = model.current;
    for (let i = s; i < e; i++) styles[i] = fn({ ...(styles[i] ?? blankStyle()) }, i, s, e);
    surface.current?.focus();
    repaint([s, e]);
  };

  const toggleStyle = (key: StyleKey) => {
    const [s, e] = activeRange();
    const { styles } = model.current;
    const allOn = e > s && Array.from({ length: e - s }, (_, i) => styles[s + i]).every((st) => st?.[key]);
    apply((st) => ({ ...st, [key]: !allOn }));
  };

  /** Replace the selection with text, honouring any § codes that came with it. */
  const insertText = (raw: string) => {
    const [s, e] = readSelection() ?? [model.current.text.length, model.current.text.length];
    const { text, styles } = model.current;
    const inherit = { ...(styles[s - 1] ?? blankStyle()) };
    const styled = /[§&]/.test(raw);
    const { text: added, styles: addedStyles } = toChars(parseMotd(raw));
    model.current = {
      text: text.slice(0, s) + added + text.slice(e),
      styles: [...styles.slice(0, s), ...addedStyles.map((st) => (styled ? st : { ...inherit })), ...styles.slice(e)],
    };
    surface.current?.focus();
    repaint([s + added.length, s + added.length]);
  };

  /** Realign the styles against freshly typed text, with a common-affix diff. */
  const onInput = () => {
    const el = surface.current;
    if (!el) return;
    const caret = readSelection() ?? undefined;
    const next = readAll(el);
    const { text, styles } = model.current;
    if (next !== text) {
      let a = 0;
      while (a < text.length && a < next.length && text[a] === next[a]) a++;
      let b = 0;
      while (b < text.length - a && b < next.length - a && text[text.length - 1 - b] === next[next.length - 1 - b]) b++;
      const inserted = Math.max(0, next.length - a - b);
      const inherit = styles[a - 1] ?? styles[a] ?? blankStyle();
      styles.splice(a, text.length - a - b, ...Array.from({ length: inserted }, () => ({ ...inherit })));
      model.current = { text: next, styles };
    }
    repaint(caret);
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      insertText("\n");
      return;
    }
    if (!(ev.metaKey || ev.ctrlKey)) return;
    const key = ({ b: "bold", i: "italic", u: "under" } as Record<string, StyleKey>)[ev.key.toLowerCase()];
    if (!key) return;
    ev.preventDefault(); // the browser would run its own bold on a contenteditable
    toggleStyle(key);
  };

  /* ── icon ───────────────────────────────────────────────────────────────── */

  const iconCanvas = useRef<HTMLCanvasElement>(null);
  const iconSource = useRef<HTMLImageElement | null>(null);
  const iconFile = useRef<HTMLInputElement>(null);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [iconState, setIconState] = useState<"unchanged" | "replaced" | "removed">("unchanged");
  const [smooth, setSmooth] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [focus, setFocus] = useState({ x: 0.5, y: 0.5 }); // where in the source the crop is centred
  const [dragOver, setDragOver] = useState(false);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const drawIcon = useCallback(() => {
    const canvas = iconCanvas.current;
    const img = iconSource.current;
    if (!canvas) return;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, ICON_PX, ICON_PX);
    if (img) {
      const side = Math.min(img.width, img.height) / zoom;
      const sx = Math.min(Math.max(focus.x * img.width - side / 2, 0), img.width - side);
      const sy = Math.min(Math.max(focus.y * img.height - side / 2, 0), img.height - side);
      g.imageSmoothingEnabled = smooth;
      if (smooth) g.imageSmoothingQuality = "high";
      g.drawImage(img, sx, sy, side, side, 0, 0, ICON_PX, ICON_PX);
    }
    setIconUrl(img ? canvas.toDataURL("image/png") : null);
  }, [smooth, zoom, focus]);

  useEffect(() => {
    if (iconState === "replaced") drawIcon();
  }, [drawIcon, iconState]);

  // Whatever is on disk, until something is dropped in to replace it.
  const stored = useServerIcon(id, open ? 1 : 0);
  useEffect(() => {
    if (!open) return;
    setIconState("unchanged");
    setZoom(1);
    setFocus({ x: 0.5, y: 0.5 });
    setSmooth(false);
  }, [open]);
  useEffect(() => {
    // Only while nothing has replaced it: the probe can land after an image is dropped in.
    if (open && iconState === "unchanged") setIconUrl(stored);
  }, [open, stored, iconState]);

  const loadImage = (file: File | undefined) => {
    if (!file?.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      iconSource.current = img;
      setZoom(1);
      setFocus({ x: 0.5, y: 0.5 });
      setIconState("replaced");
      URL.revokeObjectURL(url);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };

  /* ── applying ───────────────────────────────────────────────────────────── */

  const [saving, setSaving] = useState(false);

  async function applyAll() {
    setSaving(true);
    try {
      if (iconState === "replaced") {
        const canvas = iconCanvas.current;
        const png = canvas && (await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png")));
        if (!png) throw new Error("Could not encode the icon");
        await instances.setServerIcon(id, png);
        toast.success("Icon saved — restart the server to apply");
      } else if (iconState === "removed") {
        await instances.removeServerIcon(id);
        toast.success("Icon removed — restart the server to apply");
      }
      onApply(codes, iconState !== "unchanged");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the icon");
    } finally {
      setSaving(false);
    }
  }

  const codes = serializeMotd(lines);
  const wrapped = wrapMotd(lines);
  const dropped = wrapped.length > MAX_LINES;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] gap-5 overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Server list appearance</DialogTitle>
          <DialogDescription>
            The message and the icon players see before they join. Both apply on the next restart.
          </DialogDescription>
        </DialogHeader>

        {/* ── message ─────────────────────────────────────────────────────── */}
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-muted/40 p-1.5">
            {/* No "Colour" label: the swatches say what they are, and the width it costs pushed
                Clear onto a second line. Each swatch still carries its name for a screen reader. */}
            <div className="flex flex-wrap gap-1">
              {COLORS.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  title={`§${c.code} · ${c.name}`}
                  aria-label={`${c.name}, section ${c.code}`}
                  className="size-[22px] rounded-[5px] border border-foreground/25 transition-transform hover:scale-110"
                  style={{ background: c.hex }}
                  onMouseDown={(e) => e.preventDefault()} // keep the selection
                  onClick={() => apply((st) => ({ ...st, color: c.hex }))}
                />
              ))}
            </div>
            <label
              className="grid size-[22px] cursor-pointer place-items-center rounded-[5px] border border-foreground/25 font-mono text-[11px]"
              title="Custom hex — Paper/Spigot 1.16+"
            >
              #
              <input
                type="color"
                className="sr-only"
                aria-label="Custom colour"
                onChange={(e) => apply((st) => ({ ...st, color: e.target.value.toUpperCase() }))}
              />
            </label>
            <div className="mx-1 h-5 w-px bg-border" />
            {(
              [
                ["bold", Bold, "Bold (⌘B)"],
                ["italic", Italic, "Italic (⌘I)"],
                ["under", Underline, "Underline (⌘U)"],
                ["strike", Strikethrough, "Strikethrough"],
                ["obf", Shuffle, "Obfuscated"],
              ] as [StyleKey, typeof Bold, string][]
            ).map(([key, Icon, label]) => (
              <Button
                key={key}
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                title={label}
                aria-label={label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => toggleStyle(key)}
              >
                {/* The italic icon leans and the underline icon is underlined; the bold one may as
                    well be bold. Lucide draws at stroke-width 2 by default. */}
                <Icon className="size-3.5" strokeWidth={key === "bold" ? 3.25 : undefined} />
              </Button>
            ))}
            <div className="mx-1 h-5 w-px bg-border" />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => apply(() => blankStyle())}
            >
              Clear
            </Button>
          </div>

          {/* The painted text is the editing surface — see the note on this component. */}
          {/* biome-ignore lint/a11y/useSemanticElements: a textarea lays out one weight, and
              Minecraft's bold advances a pixel more per glyph — the selection would not match the
              text. The painted text has to be the editing surface. */}
          <div
            ref={attachSurface}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            tabIndex={0}
            aria-multiline="true"
            aria-label="Message of the day"
            spellCheck={false}
            className="font-minecraft min-h-[92px] whitespace-pre-wrap break-words rounded-lg border bg-[#0d0d11] p-4 text-white caret-white outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onInput={onInput}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              const raw = e.clipboardData?.getData("text/plain");
              if (raw == null) return;
              e.preventDefault();
              insertText(raw);
            }}
          />

          <div className="grid gap-1">
            {wrapped.map((runs, i) => {
              const w = lineWidth(runs);
              const gone = i >= MAX_LINES;
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
                <div key={i} className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="w-16 shrink-0">{gone ? "Dropped" : `Line ${i + 1}`}</span>
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className={`block h-full ${gone ? "bg-destructive" : "bg-primary"}`}
                      style={{ width: `${Math.min(100, (w / MAX_LINE_PX) * 100)}%` }}
                    />
                  </span>
                  <span className="tabular-nums">
                    <b className="font-medium text-foreground">{w}</b> / {MAX_LINE_PX} px
                  </span>
                </div>
              );
            })}
          </div>

          {dropped && (
            <Alert>
              <TriangleAlert />
              <AlertDescription>
                The client draws two lines and wraps at {MAX_LINE_PX} pixels. Everything past the second line is dropped
                — greyed out below so you can see what you are losing.
              </AlertDescription>
            </Alert>
          )}
          {codes.includes(`${SECTION}x`) && (
            <Alert>
              <TriangleAlert />
              <AlertDescription>
                Hex colours need Paper or Spigot 1.16+. A vanilla server prints the <code>{SECTION}x</code> run as
                literal characters.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            {PRESETS.map(([name, src, preview]) => (
              <button
                key={name}
                type="button"
                title={name}
                className="rounded-lg border bg-[#0d0d11] p-2 text-left hover:border-ring"
                onClick={() => setModel(src)}
              >
                <MotdText lines={preview} className="!text-base !leading-[13px]" />
              </button>
            ))}
          </div>
        </div>

        {/* ── icon ────────────────────────────────────────────────────────── */}
        <div className="grid gap-3 border-t pt-4">
          <div className="flex items-baseline gap-2">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Icon</Label>
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">
              {iconUrl ? "server-icon.png · 64×64" : "no icon — the client draws its placeholder"}
            </span>
          </div>

          <div className="flex flex-wrap items-start gap-4">
            {/* One surface: the preview is the drop target, so there is no dead zone beside it. */}
            {/* biome-ignore lint/a11y/useSemanticElements: the preview is also the pan handle,
                so a press has to be told apart from a drag — a button would fire on both. */}
            <div
              role="button"
              tabIndex={0}
              aria-label="Server icon — drop, paste or click to replace"
              className={`group relative size-[140px] shrink-0 cursor-pointer rounded-xl border border-dashed p-[5px] ${dragOver ? "border-primary bg-primary/10" : "hover:border-ring"}`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  iconFile.current?.click();
                }
              }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = { x: e.clientX, y: e.clientY, moved: false };
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                const img = iconSource.current;
                if (!d) return;
                const dx = e.clientX - d.x;
                const dy = e.clientY - d.y;
                if (!d.moved && Math.hypot(dx, dy) < 4) return; // still a click
                if (!img || zoom <= 1) return; // nothing to pan
                d.moved = true;
                const side = Math.min(img.width, img.height) / zoom;
                const perPixel = side / 128; // the preview is 128 CSS px wide
                setFocus((f) => ({
                  x: Math.min(Math.max(f.x - (dx * perPixel) / img.width, 0), 1),
                  y: Math.min(Math.max(f.y - (dy * perPixel) / img.height, 0), 1),
                }));
                d.x = e.clientX;
                d.y = e.clientY;
              }}
              onPointerUp={() => {
                if (drag.current && !drag.current.moved) iconFile.current?.click();
                drag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                loadImage(e.dataTransfer?.files?.[0]);
              }}
            >
              {iconUrl ? (
                // biome-ignore lint/performance/noImgElement: a data URL produced right here
                <img
                  src={iconUrl}
                  alt=""
                  draggable={false}
                  className="size-32 rounded-md [image-rendering:pixelated]"
                />
              ) : (
                <div className="grid size-32 place-items-center rounded-md bg-[#1b1b20] text-xs text-muted-foreground">
                  No icon
                </div>
              )}
              <span className="pointer-events-none absolute inset-[5px] grid place-content-center rounded-md bg-black/70 px-2 text-center text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                {iconSource.current && zoom > 1 ? "Drag to reposition · click to replace" : "Drop or click"}
              </span>
            </div>
            <input
              ref={iconFile}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => loadImage(e.target.files?.[0])}
            />
            <canvas ref={iconCanvas} width={ICON_PX} height={ICON_PX} className="hidden" />

            <div className="grid min-w-56 flex-1 gap-3">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="w-14 shrink-0 uppercase tracking-wider">Zoom</span>
                <Slider
                  min={100}
                  max={400}
                  step={1}
                  value={[zoom * 100]}
                  disabled={iconState !== "replaced"}
                  onValueChange={(v) => setZoom((Array.isArray(v) ? v[0] : v) / 100)}
                  aria-label="Zoom"
                  className="flex-1"
                />
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="w-14 shrink-0 uppercase tracking-wider">Scaling</span>
                <div className="flex gap-1 rounded-md border p-0.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={smooth ? "ghost" : "secondary"}
                    className="h-6 px-2 text-xs"
                    onClick={() => setSmooth(false)}
                  >
                    Pixelated
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={smooth ? "secondary" : "ghost"}
                    className="h-6 px-2 text-xs"
                    onClick={() => setSmooth(true)}
                  >
                    Smooth
                  </Button>
                </div>
              </div>
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={!iconUrl}
                  onClick={() => {
                    iconSource.current = null;
                    setIconUrl(null);
                    setIconState("removed");
                  }}
                >
                  Remove icon
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Any size, any format — cropped square and written out as a 64×64 PNG, which is the only thing vanilla
                loads. Transparency is kept.
              </p>
            </div>
          </div>
        </div>

        {/* ── preview ─────────────────────────────────────────────────────── */}
        <div className="grid gap-2">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Preview · multiplayer list
          </Label>
          <ServerListPreview
            name={serverName}
            iconSrc={iconUrl}
            lines={wrapped}
            version={version}
            players={maxPlayers ? `0/${maxPlayers}` : undefined}
          />
        </div>

        <DialogFooter className="sm:justify-between">
          <p className="text-xs text-muted-foreground sm:max-w-sm">
            Only <code>§k</code> animates — the client scrambles those glyphs itself. A message that changes over time
            needs a plugin that answers each ping.
          </p>
          <div className="flex gap-2">
            <CopyButton value={codes} label="Copy § codes" showLabel />
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={applyAll} disabled={saving}>
              {saving ? "Applying…" : "Apply"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
