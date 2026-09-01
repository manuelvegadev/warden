"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The "give me the whole screen" pair a live panel needs: browser full screen on its own element,
 * and a pop-out window so it can sit on a second monitor while you work elsewhere in Beacon.
 *
 * `popout` is set by the panel's own pop-out route, where both affordances are pointless: it is
 * already its own window, and it should fill it.
 */
export function useDetachable(popoutPath: string, windowName: string, popout?: boolean) {
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
    /** The panel should fill its container rather than take a fixed height. */
    fillHeight: Boolean(popout) || fullscreen,
    /** Neither affordance belongs in a window that is already popped out. */
    showPopout: !popout && !fullscreen,
  };
}
