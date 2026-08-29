import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Catalog sources: display label and badge colour. Single place to extend when a source is added. */
export const PLUGIN_SOURCES: Record<string, { label: string; className: string }> = {
  hangar: { label: "Hangar", className: "border-blue-500/30 bg-blue-500/15 text-blue-500" },
  modrinth: { label: "Modrinth", className: "border-emerald-500/30 bg-emerald-500/15 text-emerald-500" },
};

export const sourceLabel = (source: string) => PLUGIN_SOURCES[source]?.label ?? source;

/** Colored, capitalized badge for a plugin catalog source. */
export function PluginSourceBadge({ source, className }: { source: string; className?: string }) {
  const s = PLUGIN_SOURCES[source] ?? { label: source, className: "bg-muted text-muted-foreground" };
  return (
    <Badge variant="outline" className={cn(s.className, className)}>
      {s.label}
    </Badge>
  );
}
