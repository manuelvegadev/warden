import { Badge } from "@warden/ui/components/badge";
import { badgeTone } from "@warden/ui/lib/badge-tone";
import { cn } from "@warden/ui/lib/utils";

/**
 * Where a jar came from: display label, badge colour and whether the source is a catalog one can
 * search and install from (as opposed to an upload, or a jar wardend manages itself).
 */
export const PLUGIN_SOURCES: Record<string, { label: string; className: string; catalog?: boolean }> = {
  hangar: { label: "Hangar", className: badgeTone.blue, catalog: true },
  modrinth: { label: "Modrinth", className: badgeTone.emerald, catalog: true },
  manual: { label: "Manual", className: badgeTone.muted },
  warden: { label: "Warden", className: badgeTone.violet }, // the live-view agent, installed by wardend
};

/** Catalog sources only (searchable/installable). */
export const CATALOG_SOURCES = Object.fromEntries(
  Object.entries(PLUGIN_SOURCES).filter(([, v]) => v.catalog),
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
