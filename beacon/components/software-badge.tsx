import { Badge } from "@/components/ui/badge";
import { SOFTWARE, softwareName } from "@/lib/api";
import { badgeTone } from "@/lib/utils";

/** Colored badge naming the server software (Paper, Purpur, Fabric, Vanilla). */
export function SoftwareBadge({ software, className = "" }: { software: string; className?: string }) {
  const tone = SOFTWARE[software]?.tone ?? "muted";
  return (
    <Badge variant="outline" className={`${badgeTone[tone]} ${className}`}>
      {softwareName(software)}
    </Badge>
  );
}
