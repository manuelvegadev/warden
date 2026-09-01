"use client";

import { Badge } from "@warden/ui/components/badge";
import { Button } from "@warden/ui/components/button";
import { badgeTone } from "@warden/ui/lib/badge-tone";
import { cn } from "@warden/ui/lib/utils";
import {
  AlertTriangle,
  Award,
  Info,
  LogIn,
  LogOut,
  type LucideIcon,
  MessageSquare,
  OctagonX,
  Puzzle,
  Server,
  Skull,
  Terminal,
  TriangleAlert,
  WrapText,
  Wrench,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlayerFace } from "@/components/instance/player-face";
import { CopyButton } from "@/components/instance/section-card";
import { useStoredPreference } from "@/hooks/use-stored-preference";
import type { ConsoleLine } from "@/lib/api";
import { type Kind, type ParsedLine, parseConsoleLine } from "@/lib/console-parse";

const PAGE = 1000;

const WRAP_KEY = "beacon.console.wrap";
const WRAP_MODES = ["wrap", "nowrap"] as const;

/** Label, chip tone and icon per line kind (order = filter bar order). */
const KIND_META: Record<Kind, { label: string; tone: string; icon: LucideIcon; text?: string }> = {
  chat: { label: "Chat", tone: badgeTone.emerald, icon: MessageSquare },
  join: { label: "Join", tone: badgeTone.emerald, icon: LogIn },
  leave: { label: "Leave", tone: badgeTone.muted, icon: LogOut },
  advancement: { label: "Advancement", tone: badgeTone.amber, icon: Award },
  death: { label: "Death", tone: badgeTone.red, icon: Skull },
  command: { label: "Command", tone: badgeTone.violet, icon: Terminal },
  stdin: { label: "Sent", tone: badgeTone.sky, icon: Terminal, text: "text-cyan-400" },
  system: { label: "wardend", tone: badgeTone.violet, icon: Wrench, text: "text-fuchsia-400" },
  server: { label: "Server", tone: badgeTone.blue, icon: Server },
  overload: { label: "Overload", tone: badgeTone.amber, icon: TriangleAlert, text: "text-amber-500" },
  warn: { label: "Warning", tone: badgeTone.amber, icon: AlertTriangle, text: "text-amber-500" },
  error: { label: "Error", tone: badgeTone.red, icon: OctagonX, text: "text-red-500" },
  plugin: { label: "Plugin", tone: badgeTone.lime, icon: Puzzle },
  info: { label: "Info", tone: badgeTone.muted, icon: Info },
};

const KINDS = Object.keys(KIND_META) as Kind[];
const PLAYER_KINDS = new Set<Kind>(["join", "leave", "chat", "advancement", "death", "command"]);

// Parsed once per line object: the buffer is a sliding window, so lines keep their identity across
// updates and the WeakMap forgets them when they scroll out. Ids give the rows stable keys.
const parsedCache = new WeakMap<ConsoleLine, ParsedLine & { id: number }>();
let nextId = 0;
function useParsed(lines: ConsoleLine[]) {
  return useMemo(
    () =>
      lines.map((l) => {
        let p = parsedCache.get(l);
        if (!p) {
          p = { ...parseConsoleLine(l), id: nextId++ };
          parsedCache.set(l, p);
        }
        return p;
      }),
    [lines],
  );
}

export function PrettyConsole({ lines, className }: { lines: ConsoleLine[]; className?: string }) {
  const parsed = useParsed(lines);
  const [hidden, setHidden] = useState<Set<Kind>>(() => new Set());
  const [pages, setPages] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [wrapMode, setWrapMode] = useStoredPreference(WRAP_KEY, "wrap", WRAP_MODES);
  const wrap = wrapMode === "wrap";

  const counts = useMemo(() => {
    const c = new Map<Kind, number>();
    for (const p of parsed) c.set(p.kind, (c.get(p.kind) ?? 0) + 1);
    return c;
  }, [parsed]);
  const visible = useMemo(() => parsed.filter((p) => !hidden.has(p.kind)), [parsed, hidden]);
  const shown = useMemo(() => visible.slice(Math.max(0, visible.length - PAGE * pages)), [visible, pages]);

  // Follow the tail while the user is at the bottom; keep their place otherwise.
  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  const pinToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, []);

  // Keyed on the newest row, not on how many rows are shown: `shown` is a fixed-size window over a
  // capped buffer, so its length freezes at PAGE and the tail stopped being followed after the
  // first thousand lines.
  const lastId = shown.at(-1)?.id;
  // Re-pin when the newest row changes, and when wrapping flips: that reflows every row without
  // resizing the container the ResizeObserver watches, so nothing else would notice.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are triggers, not values read
  useEffect(pinToBottom, [pinToBottom, lastId, wrap]);

  // The viewport can also change without any new row — entering full screen, rotating the phone,
  // the on-screen keyboard opening. Re-pin on resize rather than special-casing each of them.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(pinToBottom);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pinToBottom]);

  const toggle = (k: Kind) =>
    setHidden((h) => {
      const n = new Set(h);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-md border bg-[#0a0a0a]", className)}>
      <div className="flex flex-wrap items-center gap-1 border-b border-white/10 px-2 py-1.5">
        {KINDS.filter((k) => counts.has(k)).map((k) => {
          const { label, tone, icon: Icon } = KIND_META[k];
          const off = hidden.has(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggle(k)}
              aria-pressed={!off}
              className={cn("rounded-full transition-opacity", off && "opacity-40")}
              title={off ? `Show ${label.toLowerCase()} lines` : `Hide ${label.toLowerCase()} lines`}
            >
              <Badge variant="outline" className={cn("gap-1", tone)}>
                <Icon className="size-3" /> {label} · {counts.get(k)}
              </Badge>
            </button>
          );
        })}
        <Button
          size="sm"
          variant={wrap ? "secondary" : "ghost"}
          aria-pressed={wrap}
          className="ml-auto h-[22px] gap-1.5 px-2 text-[11px]"
          onClick={() => setWrapMode(wrap ? "nowrap" : "wrap")}
          title={wrap ? "Long lines wrap; turn off to scroll sideways" : "Long lines scroll sideways; turn on to wrap"}
        >
          <WrapText className="size-3" /> Wrap
        </Button>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={cn("font-console min-h-0 flex-1 overflow-y-auto text-[13px]", !wrap && "overflow-x-auto")}
      >
        {visible.length > shown.length && (
          <div className="pb-2 text-center">
            <Button variant="ghost" size="sm" onClick={() => setPages((p) => p + 1)}>
              Show earlier lines ({visible.length - shown.length} more)
            </Button>
          </div>
        )}
        {shown.length === 0 && <div className="px-2 py-4 text-muted-foreground">No lines yet.</div>}
        <div className={cn("divide-y divide-white/[0.07]", !wrap && "w-max min-w-full")}>
          {shown.map((p) => (
            <Row key={p.id} line={p} wrap={wrap} />
          ))}
        </div>
      </div>
    </div>
  );
}

const Row = memo(function Row({ line, wrap }: { line: ParsedLine; wrap: boolean }) {
  const meta = KIND_META[line.kind];
  const Icon = meta.icon;
  const isPlayer = PLAYER_KINDS.has(line.kind) && line.player;
  return (
    <div
      className={cn(
        "group flex items-start gap-2 px-2 py-1",
        // Without wrapping the row is far wider than the viewport, so the sticky cells below need an
        // opaque backdrop to occlude the text sliding under them; a translucent hover would not.
        wrap ? "hover:bg-white/5" : "bg-[#0a0a0a] hover:bg-[#161616]",
      )}
    >
      <span
        className={cn(
          "shrink-0 text-muted-foreground tabular-nums",
          // Frozen column: keeps the row identifiable while reading the far end of a long line. The
          // width carries the gutter, because w-[8ch] is the whole box and padding alone would eat
          // into the timestamp rather than widen it.
          wrap ? "w-[8ch]" : "sticky left-0 w-[calc(8ch+0.5rem)] border-white/10 border-r bg-inherit pr-2",
        )}
      >
        {line.time}
      </span>
      <Badge
        variant="outline"
        className={cn("h-[18px] shrink-0 gap-1 px-1.5 text-[11px]", meta.tone)}
        title={meta.label}
      >
        <Icon className="size-3" />
        {meta.label}
      </Badge>
      {line.source && (
        <Badge variant="outline" className="h-[18px] shrink-0 px-1.5 text-[11px]" title={line.thread ?? line.source}>
          {line.source}
        </Badge>
      )}
      <span
        className={cn(
          "min-w-0 flex-1 text-[#d4d4d4]",
          wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
          meta.text,
        )}
      >
        {isPlayer && (
          <span className="mr-1.5 inline-flex items-center gap-1 align-middle font-medium text-foreground">
            <PlayerFace name={line.player as string} className="size-4" />
            {line.player}
          </span>
        )}
        {line.kind === "chat" ? (
          <span className="text-foreground">{line.message}</span>
        ) : line.kind === "command" || line.kind === "stdin" ? (
          <code>{line.message}</code>
        ) : isPlayer && line.message.startsWith(`${line.player} `) ? (
          line.message.slice((line.player as string).length + 1)
        ) : (
          line.message
        )}
      </span>
      <CopyButton
        value={line.raw}
        label="Copy line"
        className={cn(
          "-my-1 size-6 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          // Otherwise it sits at the end of the widest line, thousands of pixels off screen.
          !wrap && "sticky right-0 border-white/10 border-l bg-inherit",
        )}
      />
    </div>
  );
});
