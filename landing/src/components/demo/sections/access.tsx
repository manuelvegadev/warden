import { Badge } from "@warden/ui/components/badge";
import { Card } from "@warden/ui/components/card";
import { cn } from "@warden/ui/lib/utils";
import { tone } from "../data";

function List({
  title,
  badge,
  children,
  className,
}: {
  title: string;
  badge?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-0 py-0", className)}>
      <div className="flex items-center gap-1.5 border-b px-3.5 py-2.5 font-semibold text-sm">
        {title}
        {badge && (
          <Badge variant="outline" className={tone.emerald}>
            {badge}
          </Badge>
        )}
      </div>
      <div className="px-3.5 py-2 text-[13px] leading-[1.9]">{children}</div>
    </Card>
  );
}

export function AccessSection(_: { sim?: unknown }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <List title="Whitelist" badge="on">
        <div className="font-mono">
          Steve
          <br />
          Alex
          <br />
          jeb_
        </div>
      </List>
      <List title="Operators">
        <div className="font-mono">
          Steve <span className="text-muted-foreground">· level 4</span>
        </div>
      </List>
      <List title="Bans" className="col-span-2">
        <span className="text-muted-foreground">
          Nobody banned. Bans issued from the player card land here with their reason.
        </span>
      </List>
    </div>
  );
}
