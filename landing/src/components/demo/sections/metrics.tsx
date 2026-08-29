import { Card, CardContent } from "@warden/ui/components/card";
import type { Simulator } from "../simulator";
import { linePath } from "../sparkline";

export function MetricsSection({ sim }: { sim: Simulator }) {
  // Mirror the series to fill an hour-wide chart with the 30 live points.
  const tps = sim.s.tps.concat(sim.s.tps.slice().reverse());
  const cpu = sim.s.cpu.concat(sim.s.cpu.slice().reverse());
  return (
    <Card className="flex-1 py-0">
      <CardContent className="flex flex-col gap-2.5 p-4">
        <div className="flex items-baseline justify-between">
          <div className="font-semibold text-[15px]">Last hour</div>
          <div className="text-muted-foreground text-xs">2 s samples · persisted 7 days</div>
        </div>
        <svg viewBox="0 0 600 160" preserveAspectRatio="none" className="h-[180px] w-full" aria-hidden>
          {[40, 80, 120].map((y) => (
            <line key={y} x1="0" y1={y} x2="600" y2={y} stroke="currentColor" strokeOpacity="0.08" />
          ))}
          <path d={linePath(tps, 600, 160)} fill="none" stroke="#fcfcfc" strokeWidth="2" />
          <path d={linePath(cpu, 600, 160)} fill="none" stroke="#8a8a8a" strokeWidth="1.5" />
        </svg>
        <div className="flex gap-4 text-muted-foreground text-xs">
          <span>— TPS (white)</span>
          <span>— CPU % (gray)</span>
          <span className="font-mono">12:10 → 13:10</span>
        </div>
      </CardContent>
    </Card>
  );
}
