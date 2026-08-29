import { Badge } from "@/components/ui/badge";
import type { InstanceState } from "@/lib/api";

const styles: Record<InstanceState, string> = {
  running: "bg-emerald-600/15 text-emerald-500 border-emerald-600/30",
  starting: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  stopping: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  stopped: "bg-muted text-muted-foreground",
  crashed: "bg-red-600/15 text-red-500 border-red-600/30",
  installing: "bg-sky-500/15 text-sky-500 border-sky-500/30",
};

export function StateBadge({ state }: { state: InstanceState }) {
  return (
    <Badge variant="outline" className={styles[state]}>
      {state}
    </Badge>
  );
}
