"use client";

import { Button } from "@warden/ui/components/button";
import { ExternalLink, Maximize2, Minimize2 } from "lucide-react";

/** The pop-out and full-screen buttons a detachable panel puts at the end of its toolbar. */
export function DetachControls({
  fullscreen,
  showPopout,
  onPopout,
  onToggleFullscreen,
  label,
}: {
  fullscreen: boolean;
  showPopout: boolean;
  onPopout: () => void;
  onToggleFullscreen: () => void;
  /** What is being detached, for the accessible names ("Open the console in a new window"). */
  label: string;
}) {
  return (
    <>
      {showPopout && (
        <Button variant="ghost" size="icon-sm" title="Open in a new window" onClick={onPopout}>
          <ExternalLink />
          <span className="sr-only">Open the {label} in a new window</span>
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        title={fullscreen ? "Exit full screen" : "Full screen"}
        onClick={onToggleFullscreen}
      >
        {fullscreen ? <Minimize2 /> : <Maximize2 />}
        <span className="sr-only">{fullscreen ? "Exit full screen" : `Show the ${label} full screen`}</span>
      </Button>
    </>
  );
}
