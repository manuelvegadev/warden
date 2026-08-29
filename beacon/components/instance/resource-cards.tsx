import { formatBytes, type InstanceState, type MetricSample } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";

function uptime(startedAt?: string) {
  if (!startedAt) return "—";
  const s = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

export function ResourceCards({
  metrics,
  players,
  state,
  startedAt,
}: {
  metrics: MetricSample | null;
  players: string[];
  state: InstanceState;
  startedAt?: string;
}) {
  const live = state === "running" || state === "starting" || state === "stopping";
  const m = live ? metrics : null;
  const cards = [
    { label: "CPU", value: m ? `${m.cpu.toFixed(1)} %` : "—" },
    { label: "Memory", value: m ? `${formatBytes(m.memRss)} / ${formatBytes(m.memMax)}` : "—" },
    { label: "Disk", value: metrics ? formatBytes(metrics.diskUsed) : "—" },
    { label: "Players", value: live ? String(players.length) : "—" },
    { label: "Uptime", value: live ? uptime(startedAt) : "—" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="py-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{c.label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{c.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
