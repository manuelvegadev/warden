import { Card, CardContent } from "@warden/ui/components/card";
import { mono } from "@/lib/utils";

/**
 * Small metric card: icon + label on top, a mono value, optional detail line. `children` render
 * behind the text (ResourceCards puts a sparkline there); pass `className` for sizing.
 */
export function StatTile({
  label,
  icon: Icon,
  value,
  detail,
  className = "",
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: React.ReactNode;
  detail?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className={`relative overflow-hidden py-0 ${className}`}>
      {children}
      <CardContent className="relative z-10 px-4 py-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon className="size-3.5" aria-hidden />
          {label}
        </div>
        <div className={`mt-1 truncate text-base font-semibold tabular-nums ${mono}`}>{value}</div>
        {detail && <div className="truncate text-xs text-muted-foreground">{detail}</div>}
      </CardContent>
    </Card>
  );
}
