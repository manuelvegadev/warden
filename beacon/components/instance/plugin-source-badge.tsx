import { Badge } from "@/components/ui/badge";
import { badgeTone, cn } from "@/lib/utils";

/** Where a jar came from: display label and badge colour. Single place to extend when a source is added. */
export const PLUGIN_SOURCES: Record<string, { label: string; className: string }> = {
  hangar: { label: "Hangar", className: badgeTone.blue },
  modrinth: { label: "Modrinth", className: badgeTone.emerald },
  manual: { label: "Manual", className: badgeTone.muted },
};

/** Catalog sources only (searchable/installable); excludes "manual". */
export const CATALOG_SOURCES = Object.fromEntries(
  Object.entries(PLUGIN_SOURCES).filter(([k]) => k !== "manual"),
) as typeof PLUGIN_SOURCES;

export const sourceLabel = (source: string) => PLUGIN_SOURCES[source]?.label ?? source;

/** Colored, capitalized badge for a plugin's source. */
export function PluginSourceBadge({ source, className }: { source: string; className?: string }) {
  const s = PLUGIN_SOURCES[source] ?? { label: source, className: badgeTone.muted };
  return (
    <Badge variant="outline" className={cn(s.className, className)}>
      {s.label}
    </Badge>
  );
}
