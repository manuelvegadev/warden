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

export function StateBadge({ state }: { state: InstanceState }) {
  return (
    <Badge variant="outline" className={styles[state]}>
      {state}
    </Badge>
  );
}
