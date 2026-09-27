"use client";

import { cn } from "@warden/ui/lib/utils";
import { ChevronDown, ChevronUp, GripVertical, X } from "lucide-react";
import type { Ref } from "react";
import { EditChrome, iconButton } from "@/components/dashboard/edit-chrome";
import { ModuleErrorBoundary } from "@/components/dashboard/error-boundary";
import type { DashboardModule } from "@/lib/dashboard-layout";
import { moduleMeta } from "@/lib/dashboard-modules";

/**
 * Where a dashboard module sits (ADR-026). Outside edit mode it adds nothing: the module's own cards
 * are the whole of it, with no title or box of the dashboard's around them. While editing, the edit
 * chrome marks it, with a grip to drag it (up/down buttons on phones, where there is no drag), its
 * settings (the Metrics gear) and a remove button. Either way, a module that throws takes only itself
 * down.
 */
export function ModuleFrame({
  module,
  editing,
  mobile,
  fill,
  handleRef,
  onRemove,
  onMoveUp,
  onMoveDown,
  settings,
  children,
}: {
  module: DashboardModule;
  editing?: boolean;
  /** Phones have no drag: up/down buttons replace the grip. */
  mobile?: boolean;
  /** Fills the height it is given (Console, Metrics, Live view) rather than being as tall as its content. */
  fill?: boolean;
  handleRef?: Ref<HTMLButtonElement>;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** The module's settings control for the edit bar (the Metrics gear). */
  settings?: React.ReactNode;
  children: React.ReactNode;
}) {
  const title = moduleMeta(module.kind)?.title ?? "Module unavailable";
  const body = (
    <div className={cn("@container", fill && "flex min-h-0 flex-1 flex-col")}>
      <ModuleErrorBoundary>{children}</ModuleErrorBoundary>
    </div>
  );
  if (!editing) return fill ? <div className="flex h-full min-h-0 flex-col">{body}</div> : body;

  return (
    <EditChrome
      title={title}
      mobile={mobile}
      fill={fill}
      leading={
        mobile ? (
          <>
            <button
              type="button"
              aria-label={`Move ${title} up`}
              disabled={!onMoveUp}
              onClick={onMoveUp}
              className={iconButton}
            >
              <ChevronUp />
            </button>
            <button
              type="button"
              aria-label={`Move ${title} down`}
              disabled={!onMoveDown}
              onClick={onMoveDown}
              className={iconButton}
            >
              <ChevronDown />
            </button>
          </>
        ) : (
          <button
            ref={handleRef}
            type="button"
            aria-label={`Move ${title}`}
            className={cn(iconButton, "cursor-grab touch-none")}
          >
            <GripVertical />
          </button>
        )
      }
      trailing={
        <>
          {settings}
          <button type="button" aria-label={`Remove ${title}`} onClick={onRemove} className={iconButton}>
            <X />
          </button>
        </>
      }
    >
      {body}
    </EditChrome>
  );
}
