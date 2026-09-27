"use client";

import { Checkbox } from "@warden/ui/components/checkbox";
import { Label } from "@warden/ui/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@warden/ui/components/popover";
import { cn } from "@warden/ui/lib/utils";
import { Settings2 } from "lucide-react";
import { useId } from "react";

/**
 * An icon-only control of the edit bar: a visible ring on keyboard focus, none on a mouse click,
 * consistent with @warden/ui's Button.
 */
export const iconButton =
  "flex items-center justify-center rounded-md p-0.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30";

/**
 * The edit-mode chrome of anything on the Overview canvas — a module, the key figures (ADR-026): a
 * dashed outline and a slim bar naming it, with `leading` controls before the title (the drag grip,
 * or a phone's up/down buttons) and `trailing` ones at the end (settings, remove). On desktop the bar
 * sits in the 20 px gap above the item (`gap-5` in the canvas; `mb-1` + `h-4` here) and the outline
 * is drawn outside it, so editing adds no height and the canvas still fits the screen. On a phone,
 * where the page scrolls anyway, the bar takes its own line.
 */
export function EditChrome({
  title,
  leading,
  trailing,
  mobile,
  fill,
  className,
  children,
}: {
  title: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  mobile?: boolean;
  /** Fills the height it is given rather than being as tall as its content. */
  fill?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative rounded-xl outline-1 outline-offset-2 outline-muted-foreground/40 outline-dashed",
        mobile && "flex flex-col gap-2",
        fill && "flex h-full min-h-0 flex-col",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 text-muted-foreground",
          mobile ? "[&_svg]:size-4" : "absolute inset-x-0 bottom-full mb-1 h-4 [&_svg]:size-3.5",
        )}
      >
        {leading}
        <span className="truncate text-xs font-medium">{title}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">{trailing}</div>
      </div>
      {children}
    </div>
  );
}

/**
 * A gear opening a checkbox per kind — which charts a Metrics module draws, which key figures the
 * strip shows. `disabled` greys out a kind that may not be unchecked (the last chart left).
 */
export function KindPicker<K extends string>({
  label,
  kinds,
  labels,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  kinds: readonly K[];
  labels: Record<K, string>;
  checked: readonly K[];
  disabled?: (kind: K) => boolean;
  onToggle: (kind: K, checked: boolean) => void;
}) {
  const base = useId();
  return (
    <Popover>
      <PopoverTrigger
        title={label}
        aria-label={label}
        className={cn(iconButton, "hover:bg-muted data-[popup-open]:bg-muted")}
      >
        <Settings2 />
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" sideOffset={4} className="w-48">
        <div className="flex flex-col gap-2">
          {kinds.map((kind) => {
            const id = `${base}-${kind}`;
            return (
              <div key={kind} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={checked.includes(kind)}
                  disabled={disabled?.(kind)}
                  onCheckedChange={(next) => onToggle(kind, next === true)}
                />
                <Label htmlFor={id} className="font-normal">
                  {labels[kind]}
                </Label>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
