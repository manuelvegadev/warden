import { Badge } from "@warden/ui/components/badge";
import { badgeTone } from "@warden/ui/lib/badge-tone";
import type { InstanceState } from "@/lib/api";

const styles: Record<InstanceState, string> = {
  running: badgeTone.emerald,
  starting: badgeTone.amber,
  stopping: badgeTone.amber,
  stopped: badgeTone.muted,
  crashed: badgeTone.red,
  installing: badgeTone.sky,
};

/** The same states as a dot's fill, for places too small for the badge (the status strip). */
export const stateDot: Record<InstanceState, string> = {
  running: "bg-emerald-500",
  starting: "bg-amber-500",
  stopping: "bg-amber-500",
  stopped: "bg-muted-foreground/60",
  crashed: "bg-red-500",
  installing: "bg-sky-500",
};

export function StateBadge({ state }: { state: InstanceState }) {
  return (
    <Badge variant="outline" className={styles[state]}>
      {state}
    </Badge>
  );
}
