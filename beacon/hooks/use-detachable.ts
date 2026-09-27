"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * How a detachable pane is shown (ADR-026):
 * - `section` — the pane as its section page shows it: stretches to the bottom of the section from
 *   `lg`/`sm` up, or keeps its own fixed height stacked below that.
 * - `fill` — fills the container it is given, at any width and height (a dashboard module).
 * - `popout` — its own window (the `(popout)` routes): fills it; no pop-out button.
 *
 * Fullscreen is an overlay on any of them.
 */
export type DisplayMode = "section" | "fill" | "popout";

/**
 * The "give me the whole screen" pair a live panel needs: browser full screen on its own element,
 * and a pop-out window so it can sit on a second monitor while you work elsewhere in Beacon.
 *
 * `mode` is set by the panel's caller; `popout` is set by the panel's own pop-out route, where both
 * affordances are pointless: it is already its own window, and it should fill it.
 */
export function useDetachable(popoutPath: string, windowName: string, mode: DisplayMode = "section") {
  const rootRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.();
  }, []);

  const openPopout = useCallback(
    () => window.open(popoutPath, windowName, "popup,width=1100,height=720"),
    [popoutPath, windowName],
  );

  return {
    rootRef,
    fullscreen,
    toggleFullscreen,
    openPopout,
    /** The pane fills its container rather than taking the height its section gives it. */
    fillHeight: mode !== "section" || fullscreen,
    /** A pane already in its own window has no pop-out button; nor has one in full screen. */
    showPopout: mode !== "popout" && !fullscreen,
  };
}
