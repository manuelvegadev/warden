"use client";

import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Logs } from "@/components/instance/logs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ConsoleLine } from "@/lib/api";
import { mono } from "@/lib/utils";
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

export function Console({
  instanceId,
  lines,
  onCommand,
  disabled,
}: {
  instanceId: string;
  lines: ConsoleLine[];
  onCommand: (cmd: string) => void;
  disabled: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const writtenRef = useRef(0);
  const linesRef = useRef(lines);
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);
  const [history, setHistory] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState(-1);
  const [value, setValue] = useState("");

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

  function submit(e: FormEvent) {
    e.preventDefault();
    const cmd = value.trim();
    if (!cmd) return;
    onCommand(cmd);
    setHistory((h) => [cmd, ...h.filter((x) => x !== cmd)].slice(0, 50));
    setHIdx(-1);
    setValue("");
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowUp" && history.length) {
      e.preventDefault();
      const i = Math.min(hIdx + 1, history.length - 1);
      setHIdx(i);
      setValue(history[i]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const i = Math.max(hIdx - 1, -1);
      setHIdx(i);
      setValue(i === -1 ? "" : history[i]);
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Live output · last {lines.length} lines in memory</span>
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
      </div>
      <div
        ref={frameRef}
        className="flex h-[420px] flex-col justify-center overflow-hidden rounded-md border bg-[#0a0a0a] p-2"
      >
        <div ref={hostRef} className="h-full" />
      </div>
      <form onSubmit={submit} className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          placeholder={disabled ? "Server is not running" : "Type a command (e.g. list, say hello)…"}
          disabled={disabled}
          className={mono}
          autoComplete="off"
        />
        <Button type="submit" disabled={disabled || !value.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
