"use client";

import { Button } from "@warden/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@warden/ui/components/dialog";
import { cn } from "@warden/ui/lib/utils";
import { AlignLeft, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CommandInput } from "@/components/instance/command-input";
import { CommandTemplates } from "@/components/instance/command-templates";
import { PrettyConsole } from "@/components/instance/console-pretty";
import { DetachControls } from "@/components/instance/detach-controls";
import { useConsoleLines, useInstance } from "@/components/instance/instance-context";
import { Logs } from "@/components/instance/logs";
import { useDetachable } from "@/hooks/use-detachable";
import { useKnownPlayers } from "@/hooks/use-known-players";
import { useStoredPreference } from "@/hooks/use-stored-preference";
import { useWakeLock } from "@/hooks/use-wake-lock";
import type { ConsoleLine } from "@/lib/api";
import "@xterm/xterm/css/xterm.css";

const colors: Record<ConsoleLine["level"], string> = {
  INFO: "",
  DEBUG: "\x1b[90m",
  WARN: "\x1b[33m",
  ERROR: "\x1b[31m",
  FATAL: "\x1b[31;1m",
  STDIN: "\x1b[36m",
  SYSTEM: "\x1b[35m",
};

// Newline *before* each line keeps the cursor on the last written row: no trailing blank row.
function writeLine(term: import("@xterm/xterm").Terminal, l: ConsoleLine) {
  if (!l.text.trim()) return;
  const prefix = term.buffer.active.length > 1 || term.buffer.active.getLine(0)?.translateToString(true) ? "\r\n" : "";
  term.write(`${prefix}${colors[l.level] ?? ""}${l.text}\x1b[0m`);
}

const CONSOLE_MODES = ["pretty", "raw"] as const;
type ConsoleMode = (typeof CONSOLE_MODES)[number];
const MODE_KEY = "beacon.console.mode";

/** The xterm view: mounted only in raw mode, replays the buffer on mount. */
function RawConsole({ lines, className }: { lines: ConsoleLine[]; className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const writtenRef = useRef(0);
  const linesRef = useRef(lines);
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | undefined;
    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (disposed || !hostRef.current) return;
      // Resolve the CSS font stack and make sure it is loaded before xterm measures glyphs.
      const styles = getComputedStyle(document.documentElement);
      const fontFamily = styles.getPropertyValue("--font-console").trim() || "monospace";
      const lineHeight = Number(styles.getPropertyValue("--console-line-height")) || 1.1;
      try {
        await document.fonts.load(`12px ${fontFamily.split(",")[0]}`);
      } catch {
        /* font may be unavailable; xterm falls back */
      }
      if (disposed || !hostRef.current) return;
      const term = new Terminal({
        convertEol: true,
        disableStdin: true,
        cursorBlink: false,
        fontFamily,
        fontSize: 12,
        lineHeight,
        scrollback: 3000,
        theme: { background: "#0a0a0a" },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      // fit() rounds rows down, which leaves a gap under the last row. Shrink the host to the exact
      // rendered height so the flex frame centers it and top/bottom padding stay equal.
      const refit = () => {
        const host = hostRef.current;
        if (!host) return;
        host.style.height = "";
        fit.fit();
        // xterm lays out its rows on the next frame; measure after that.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const screen = host.querySelector<HTMLElement>(".xterm-screen");
            if (screen && screen.clientHeight > 0) host.style.height = `${screen.clientHeight}px`;
          });
        });
      };
      refit();
      ro = new ResizeObserver(refit);
      if (frameRef.current) ro.observe(frameRef.current);
      termRef.current = term;
      // Replay everything already in memory (the component remounts when switching tabs).
      for (const l of linesRef.current) writeLine(term, l);
      writtenRef.current = linesRef.current.length;
    })();
    return () => {
      disposed = true;
      ro?.disconnect();
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, []);

  // Write only the lines not yet rendered; a shrink (history reset) clears the terminal.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (lines.length < writtenRef.current) {
      term.clear();
      writtenRef.current = 0;
    }
    for (const l of lines.slice(writtenRef.current)) writeLine(term, l);
    writtenRef.current = lines.length;
  }, [lines]);

  return (
    <div
      ref={frameRef}
      className={cn("flex flex-col justify-center overflow-hidden rounded-md border bg-[#0a0a0a] p-2", className)}
    >
      <div ref={hostRef} className="h-full" />
    </div>
  );
}

/**
 * Live console of the current instance (reads the instance context). `popout` is the pop-out
 * window variant: fills its container and has no pop-out button of its own.
 */
export function Console({ popout }: { popout?: boolean }) {
  const { manifest, status, sendCommand, canOperate } = useInstance();
  const lines = useConsoleLines();
  const instanceId = manifest.id;
  // A viewer reads the console but never writes to it; the daemon refuses the command either way.
  const disabled = !canOperate || (status.state !== "running" && status.state !== "starting");
  // Hold the screen awake only while there is output to watch; a stopped server should not keep a
  // phone lit up in someone's pocket.
  useWakeLock(status.state === "running" || status.state === "starting");
  const [history, setHistory] = useState<string[]>([]);
  const [value, setValue] = useState("");
  // Remaining commands of a multi-command template: each one is put in the input after the previous is sent.
  const [queue, setQueue] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Everyone who ever joined, for name completion when they are offline.
  const knownPlayers = useKnownPlayers(instanceId, status.players);
  const { rootRef, fullscreen, toggleFullscreen, openPopout, fillHeight, showPopout } = useDetachable(
    `/console/${instanceId}`,
    `beacon-console-${instanceId}`,
    popout,
  );
  const viewClass = fillHeight ? "min-h-0 flex-1" : "h-[min(60vh,640px)]";

  const [mode, pickMode] = useStoredPreference<ConsoleMode>(MODE_KEY, "pretty", CONSOLE_MODES);

  function submit(command: string) {
    const cmd = command.trim();
    if (!cmd || disabled) return;
    sendCommand(cmd);
    setHistory((h) => [cmd, ...h.filter((x) => x !== cmd)].slice(0, 50));
    setValue(queue[0] ?? "");
    setQueue((q) => q.slice(1));
  }

  /** A template puts its first command in the input to confirm; the rest wait their turn. */
  function pickTemplate(cmds: string[]) {
    setValue(cmds[0]);
    setQueue(cmds.slice(1));
    inputRef.current?.focus();
  }

  return (
    <div ref={rootRef} className={cn("flex flex-col gap-2", fillHeight && "h-full", fullscreen && "bg-background p-3")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="flex rounded-md border p-0.5">
            {(
              [
                ["pretty", Sparkles, "Pretty"],
                ["raw", AlignLeft, "Raw"],
              ] as const
            ).map(([m, Icon, label]) => (
              <Button
                key={m}
                size="sm"
                variant={mode === m ? "secondary" : "ghost"}
                className="h-7 gap-1.5 px-2"
                aria-pressed={mode === m}
                onClick={() => pickMode(m)}
              >
                <Icon className="size-3.5" /> {label}
              </Button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">Live output · last {lines.length} lines in memory</span>
        </div>
        <div className="flex items-center gap-1">
          <Dialog>
            <DialogTrigger render={<Button variant="outline" size="sm" />}>Log files</DialogTrigger>
            <DialogContent className="sm:max-w-5xl">
              <DialogHeader>
                <DialogTitle>Log files</DialogTitle>
                <DialogDescription>
                  Server logs on disk: tail the latest file or download rotated archives.
                </DialogDescription>
              </DialogHeader>
              <Logs id={instanceId} />
            </DialogContent>
          </Dialog>
          <DetachControls
            label="console"
            fullscreen={fullscreen}
            showPopout={showPopout}
            onPopout={openPopout}
            onToggleFullscreen={toggleFullscreen}
          />
        </div>
      </div>
      {mode === "pretty" ? (
        <PrettyConsole lines={lines} className={viewClass} />
      ) : (
        <RawConsole lines={lines} className={viewClass} />
      )}
      <div className="flex gap-2">
        <CommandInput
          inputRef={inputRef}
          value={value}
          onChange={(v) => {
            setValue(v);
            // Clearing the input abandons the rest of a template.
            if (!v) setQueue([]);
          }}
          onSubmit={submit}
          disabled={disabled}
          history={history}
          players={status.players}
          knownPlayers={knownPlayers}
          software={manifest.software}
          placeholder={
            !canOperate
              ? "You have read-only access to this server"
              : disabled
                ? "Server is not running"
                : "Type a command (e.g. list, say hello)… Tab completes"
          }
          className="min-w-0 flex-1"
        />
        <CommandTemplates software={manifest.software} onPick={pickTemplate} />
        <Button type="button" onClick={() => submit(value)} disabled={disabled || !value.trim()}>
          Send
        </Button>
      </div>
      {queue.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {queue.length} more command{queue.length > 1 ? "s" : ""} from the template will follow after you send this
          one.
        </p>
      )}
    </div>
  );
}
