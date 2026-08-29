"use client";

import { Badge } from "@warden/ui/components/badge";
import { Button } from "@warden/ui/components/button";
import { Card, CardContent } from "@warden/ui/components/card";
import { Label } from "@warden/ui/components/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@warden/ui/components/tooltip";
import { Check, ChevronDown, Copy } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

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

/**
 * One setting inside a SectionCard: label + description on the left, the control on the right.
 * `dirty` paints the changed-row highlight; `trailing` sits after the control (badges, copy button).
 */
export function SettingRow({
  id,
  label,
  description,
  dirty,
  wide,
  badges,
  trailing,
  children,
}: {
  id?: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  dirty?: boolean;
  wide?: boolean;
  badges?: React.ReactNode;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`group flex items-center gap-4 px-5 py-3 ${dirty ? "bg-primary/5 shadow-[inset_2px_0_0_0_var(--primary)]" : ""}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Label htmlFor={id} className="text-sm">
            {label}
          </Label>
          {badges}
        </div>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className={wide ? "w-full max-w-md shrink-0" : "w-56 shrink-0"}>{children}</div>
      {trailing}
    </div>
  );
}

/** Copies `value` to the clipboard and flashes a check for a moment. */
export function CopyButton({
  value,
  label = "Copy",
  showLabel,
  className,
}: {
  value: string;
  label?: string;
  showLabel?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size={showLabel ? "sm" : "icon"}
      aria-label={label}
      title={label}
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          toast.error("Clipboard unavailable");
        }
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {showLabel && label}
    </Button>
  );
}

/** Sticky footer for editors: Discard while dirty, optional extra buttons, and Save. */
export function SaveBar({
  dirty,
  pending,
  count,
  hint,
  onDiscard,
  onSave,
  children,
}: {
  dirty: boolean;
  pending: boolean;
  count?: number;
  hint?: React.ReactNode;
  onDiscard: () => void;
  onSave: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur">
      {hint && <span className="mr-auto text-xs text-muted-foreground">{hint}</span>}
      {dirty && (
        <Button variant="ghost" onClick={onDiscard}>
          Discard
        </Button>
      )}
      {children}
      <Button onClick={onSave} disabled={!dirty || pending}>
        {pending ? "Saving…" : dirty && count ? `Save (${count})` : "Save"}
      </Button>
    </div>
  );
}
