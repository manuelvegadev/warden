import { cn } from "@warden/ui/lib/utils";
import { FILES } from "../data";
import type { Simulator } from "../simulator";

export function FilesSection({ sim }: { sim: Simulator }) {
  return (
    <div className="grid flex-1 grid-cols-[200px_minmax(0,1fr)] overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <div className="flex flex-col gap-0.5 border-r p-2">
        {Object.keys(FILES).map((name) => (
          <button
            type="button"
            key={name}
            onClick={() => sim.pickFile(name)}
            className={cn(
              "h-7 truncate rounded-md px-2 text-left font-mono text-[13px] hover:bg-muted",
              sim.s.file === name && "bg-muted",
            )}
          >
            {name}
          </button>
        ))}
      </div>
      <pre className="font-console m-0 whitespace-pre-wrap bg-[#1c1c1c] p-3.5 text-[12.5px] text-[#d4d4d4]">
        {FILES[sim.s.file]}
      </pre>
    </div>
  );
}
