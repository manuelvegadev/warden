import { Badge } from "@warden/ui/components/badge";
import { badgeTone } from "@warden/ui/lib/badge-tone";
import { SOFTWARE, softwareName } from "@/lib/api";

/** Colored badge naming the server software (Paper, Purpur, Fabric, Vanilla). */
export function SoftwareBadge({ software, className = "" }: { software: string; className?: string }) {
  const tone = SOFTWARE[software]?.tone ?? "muted";
  return (
    <Badge variant="outline" className={`${badgeTone[tone]} ${className}`}>
      {softwareName(software)}
    </Badge>
  );
}
