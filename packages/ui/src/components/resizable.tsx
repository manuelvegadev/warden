"use client";

import { cn } from "@warden/ui/lib/utils";
import { GripVertical } from "lucide-react";
import { Group, type Layout, type LayoutChangedMeta, Panel, Separator } from "react-resizable-panels";

/** Panel sizes by panel id, in percent — what `onLayoutChanged` reports. */
export type ResizableLayout = Layout;
/** `isUserInteraction` tells a drag or key press from the group's own mount-time report. */
export type ResizableLayoutMeta = LayoutChangedMeta;

// react-resizable-panels clips by default (`overflow: hidden` on a group, `auto` on a panel's
// content), which cuts off a card's border — a `ring`, drawn outside the box — at a panel's edge.
// Content that should scroll does so inside itself; the panels never clip.
const UNCLIPPED = { overflow: "visible" } as const;

/** A row or column of panels whose sizes are changed by dragging the separators between them. */
function ResizablePanelGroup({ className, style, ...props }: React.ComponentProps<typeof Group>) {
  return (
    // Group sets display: flex and flexDirection via inline style based on orientation
    <Group
      data-slot="resizable-panel-group"
      className={cn("h-full w-full", className)}
      style={{ ...UNCLIPPED, ...style }}
      {...props}
    />
  );
}

function ResizablePanel({ style, ...props }: React.ComponentProps<typeof Panel>) {
  return <Panel data-slot="resizable-panel" style={{ ...UNCLIPPED, ...style }} {...props} />;
}

/** The draggable separator; `withHandle` shows a grip in its middle. */
function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof Separator> & { withHandle?: boolean }) {
  return (
    <Separator
      data-slot="resizable-handle"
      className={cn(
        "relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-2 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2",
        className,
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-xs border bg-border">
          <GripVertical className="size-2.5" />
        </div>
      )}
    </Separator>
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
