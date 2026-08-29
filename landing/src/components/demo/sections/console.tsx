import { Input } from "@warden/ui/components/input";
import type { Simulator } from "../simulator";

const CHIPS: { label: string; run: (sim: Simulator) => void }[] = [
  { label: "list", run: (sim) => sim.runList() },
  { label: "say Backup in 5 minutes", run: (sim) => sim.runSay() },
  { label: "tps", run: (sim) => sim.runTps() },
];

export function ConsoleSection({ sim }: { sim: Simulator }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-[#1c1c1c] ring-1 ring-foreground/10">
      <div className="font-console flex flex-1 flex-col justify-end gap-[3px] overflow-hidden p-3.5 text-[12.5px] text-[#d4d4d4]">
        {sim.s.lines.map((l) => (
          <div key={l.id} className="whitespace-pre-wrap" style={{ color: l.color }}>
            {l.text}
          </div>
        ))}
        <div className="animate-pulse text-muted-foreground">█</div>
      </div>
      <div className="flex items-center gap-2 border-t p-2.5 px-3.5">
        <Input readOnly placeholder="Type a command…" className="font-console h-8 flex-1 text-[12.5px]" />
        {CHIPS.map((c) => (
          <button
            type="button"
            key={c.label}
            onClick={() => c.run(sim)}
            className="h-6 shrink-0 rounded-md bg-foreground/8 px-2.5 font-mono text-xs text-[#d4d4d4] hover:bg-foreground/16"
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
