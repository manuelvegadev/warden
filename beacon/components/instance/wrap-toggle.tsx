"use client";

import { Button } from "@warden/ui/components/button";
import { WrapText } from "lucide-react";

/** The editor's line-wrap switch, in a file's header next to its other actions. */
export function WrapToggle({ wrap, onChange }: { wrap: boolean; onChange: (wrap: boolean) => void }) {
  return (
    <Button
      variant={wrap ? "secondary" : "ghost"}
      size="icon-sm"
      aria-pressed={wrap}
      aria-label="Wrap long lines"
      title={wrap ? "Long lines wrap; turn off to scroll sideways" : "Long lines scroll sideways; turn on to wrap"}
      onClick={() => onChange(!wrap)}
    >
      <WrapText className="size-4" />
    </Button>
  );
}
