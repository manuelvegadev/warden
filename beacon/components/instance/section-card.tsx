"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Titled card with divided rows — the shared "settings list" chrome used by the Properties and
 * Access tabs. Optional: status badges next to the title, an action on the right, a first row
 * (e.g. an add form) and collapsible body.
 */
export function SectionCard({
  id,
  title,
  subtitle,
  status,
  action,
  topRow,
  collapsible,
  defaultOpen = true,
  children,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  status?: React.ReactNode;
  action?: React.ReactNode;
  topRow?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const heading = (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold leading-tight">{title}</h3>
        {status}
      </div>
      {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );

  if (collapsible) {
    return (
      <Card className="gap-0 py-0">
        <div className={open ? "border-b" : ""}>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center gap-2 px-5 py-3 text-left"
          >
            <span className="flex-1">{heading}</span>
            {action}
            <ChevronDown
              className={`size-4 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
              aria-hidden
            />
          </button>
        </div>
        {open && (
          <CardContent id={panelId} className="divide-y px-0 py-0">
            {topRow}
            {children}
          </CardContent>
        )}
      </Card>
    );
  }

  return (
    <div id={id} className="grid gap-3">
      <div className="flex items-end justify-between gap-4">
        {heading}
        {action}
      </div>
      <Card className="gap-0 py-0">
        <CardContent className="divide-y px-0 py-0">
          {topRow}
          {children}
        </CardContent>
      </Card>
    </div>
  );
}

/** Small badge whose tooltip carries a title and an explanation (why something is off / where to fix it). */
export function StatusHint({
  label,
  title,
  tone = "warning",
  children,
}: {
  label: string;
  title: string;
  tone?: "warning" | "muted";
  children: React.ReactNode;
}) {
  const cls =
    tone === "muted"
      ? "cursor-help bg-muted text-muted-foreground"
      : "cursor-help border-amber-500/30 bg-amber-500/15 text-amber-500";
  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger render={<Badge variant="outline" className={cls} />}>{label}</TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <div className="grid gap-1 text-xs leading-relaxed">
            <p className="font-semibold">{title}</p>
            <p className="text-balance">{children}</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
