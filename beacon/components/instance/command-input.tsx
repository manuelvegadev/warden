"use client";

import { Input } from "@warden/ui/components/input";
import { cn } from "@warden/ui/lib/utils";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { PlayerFace } from "@/components/instance/player-face";
import { type CompletionState, useCommandCompletion } from "@/hooks/use-command-completion";
import { arrowTarget, type HistoryNav, NOT_NAVIGATING, navigate } from "@/lib/command-history";
import { mono } from "@/lib/utils";

export interface CommandInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called on Enter with the trimmed command; the caller clears the value and records history. */
  onSubmit: (command: string) => void;
  /** Most recent first; navigated with ↑/↓ on an empty line, or searched by prefix with the list closed. */
  history?: readonly string[];
  players?: readonly string[];
  knownPlayers?: readonly string[];
  software?: string;
  placeholder?: string;
  /** Read-only viewers and stopped servers get an inert input rather than one that silently ignores Enter. */
  disabled?: boolean;
  /** The underlying <input>, so the parent can focus it (e.g. after inserting a template). */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  className?: string;
}

/**
 * Console command line with shell-style completion: Tab inserts the first match and repeated Tab
 * (Shift+Tab) walks the matches like Warp or zsh — the list of matches is frozen while cycling, so
 * the inserted text does not narrow it. The list opens as you type, not on an empty line. ↑/↓ walk
 * the list while it is open over typed text; otherwise they walk the history — every command on an
 * empty line, those starting with the typed text on a line with the list closed — and ↓ past the
 * newest brings back what was being typed. Escape closes the list, or leaves the history; Enter
 * submits (or accepts a suggestion chosen with the arrows).
 */
export function CommandInput({
  value,
  onChange,
  onSubmit,
  history = [],
  players,
  knownPlayers,
  software,
  placeholder = "Type a command…",
  disabled,
  inputRef: externalRef,
  className,
}: CommandInputProps) {
  const ownRef = useRef<HTMLInputElement | null>(null);
  const ref = externalRef ?? ownRef;
  const listId = useId();

  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [nav, setNav] = useState<HistoryNav>(NOT_NAVIGATING);
  const navigating = nav.index !== -1;
  const pendingCaret = useRef<number | null>(null);
  // Frozen at the first Tab: the matches, the token they were matched against and how to replace it.
  const [cycle, setCycle] = useState<Pick<CompletionState, "suggestions" | "current" | "apply"> | null>(null);

  const completion = useCommandCompletion({ value, caret, players, knownPlayers, software });
  const { suggestions, current, apply } = cycle ?? completion;
  const selectable = useMemo(() => suggestions.filter((s) => !s.hint), [suggestions]);

  // A value set by the parent (a template, a cleared input) moves the caret to the end and closes the list.
  const seen = useRef(value);
  useEffect(() => {
    if (seen.current === value) return;
    seen.current = value;
    setCaret(value.length);
    setOpen(false);
    setCycle(null);
    setActive(-1);
  }, [value]);

  // Keep the caret where a completion left it (React re-renders reset it to the end).
  useEffect(() => {
    if (pendingCaret.current === null || !ref.current) return;
    ref.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  });

  function set(next: { value: string; caret: number }) {
    seen.current = next.value;
    onChange(next.value);
    setCaret(next.caret);
    pendingCaret.current = next.caret;
  }

  function accept(text: string) {
    set(apply(`${text} `));
    setCycle(null);
    setActive(-1);
    setOpen(true);
  }

  function reset() {
    setCycle(null);
    setActive(-1);
  }

  /** Highlight the next/previous match; while cycling, also put it in the input. */
  function step(dir: 1 | -1) {
    const n = selectable.length;
    const next = dir < 0 ? (active <= 0 ? n - 1 : active - 1) : (active + 1) % n;
    setActive(next);
    if (cycle) set(apply(selectable[next].value));
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    // An input method composing a character owns the keys until it commits.
    if (e.nativeEvent.isComposing) return;
    const listOpen = open && selectable.length > 0;
    switch (e.key) {
      case "Tab": {
        if (selectable.length === 0) return;
        e.preventDefault();
        if (cycle) return step(e.shiftKey ? -1 : 1);
        if (selectable.length === 1) return accept(selectable[0].value);
        // Freeze the matches and insert the first one; the next Tabs walk the rest.
        setCycle({ suggestions: selectable, current, apply });
        setOpen(true);
        setActive(0);
        set(apply(selectable[0].value));
        return;
      }
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        const up = e.key === "ArrowUp";
        if (arrowTarget({ listOpen, value, navigating }) === "list") return step(up ? -1 : 1);
        const next = navigate(nav, up ? "up" : "down", history, value);
        if (!next) return;
        setNav(next.nav);
        set({ value: next.value, caret: next.value.length });
        setOpen(false);
        reset();
        return;
      }
      case "Escape":
        if (listOpen) {
          e.preventDefault();
          setOpen(false);
          reset();
        } else if (navigating) {
          e.preventDefault();
          set({ value: nav.draft, caret: nav.draft.length });
          setNav(NOT_NAVIGATING);
        }
        return;
      case "Enter": {
        e.preventDefault();
        if (listOpen && active >= 0) return accept(selectable[active].value);
        const cmd = value.trim();
        if (!cmd) return;
        onSubmit(cmd);
        setNav(NOT_NAVIGATING);
        setOpen(false);
        reset();
        return;
      }
      default:
        return;
    }
  }

  const visible = open && suggestions.length > 0;

  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      <Input
        ref={ref}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          set({ value: e.target.value, caret: e.target.selectionStart ?? e.target.value.length });
          // Suggestions follow what is typed; an emptied line leaves the arrows to history. Editing a
          // recalled command makes it the new draft.
          setOpen(e.target.value !== "");
          reset();
          setNav(NOT_NAVIGATING);
        }}
        onKeyDown={onKey}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onFocus={() => setOpen(value !== "")}
        onBlur={() => {
          setOpen(false);
          reset();
        }}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={visible}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        className={mono}
      />
      {visible && (
        <div
          id={listId}
          role="listbox"
          className={cn(
            "absolute bottom-full left-0 z-20 mb-1 max-h-64 w-full max-w-xs overflow-y-auto rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md",
            mono,
          )}
        >
          {suggestions.map((s, i) =>
            s.hint ? (
              <div key={`hint-${s.hint}`} className="px-2 py-1 text-muted-foreground">
                {s.hint}
              </div>
            ) : (
              <div
                key={`${s.kind}-${s.value}`}
                id={`${listId}-${i}`}
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                className={cn(
                  "flex cursor-default items-center justify-between gap-3 rounded-md px-2 py-1",
                  i === active && "bg-accent text-accent-foreground",
                )}
                // onMouseDown so the input keeps focus (blur would close the list first).
                onMouseDown={(e) => {
                  e.preventDefault();
                  accept(s.value);
                }}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {(s.kind === "online" || s.kind === "player") && (
                    <PlayerFace name={s.value} className="size-4 shrink-0" />
                  )}
                  <span className="text-foreground">{s.value.slice(0, current.length)}</span>
                  <span className="text-muted-foreground">{s.value.slice(current.length)}</span>
                </span>
                {s.kind && <span className="text-[10px] tracking-wide text-muted-foreground uppercase">{s.kind}</span>}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
