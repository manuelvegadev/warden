import { Badge } from "@warden/ui/components/badge";
import { BeaconMark } from "@warden/ui/components/brand";
import { Button } from "@warden/ui/components/button";
import { Card, CardContent } from "@warden/ui/components/card";
import { cn } from "@warden/ui/lib/utils";
import { ArrowDownUp, ChevronsUpDown, Coffee, Cpu, Gauge, MemoryStick, PanelLeft } from "lucide-react";
import { type SectionId, tone } from "./data";
import { AccessSection } from "./sections/access";
import { BackupsSection } from "./sections/backups";
import { ConsoleSection } from "./sections/console";
import { FilesSection } from "./sections/files";
import { MetricsSection } from "./sections/metrics";
import { PlayersSection } from "./sections/players";
import { PluginsSection } from "./sections/plugins";
import { PropertiesSection } from "./sections/properties";
import { SettingsSection } from "./sections/settings";
import { type Simulator, useSimulator } from "./simulator";
import { Sparkline } from "./sparkline";

/** Miniature Beacon opened on a running instance. Every value is simulated (see simulator.ts). */
export function BeaconDemo() {
  const sim = useSimulator();
  const { inst, s } = sim;

  return (
    <div
      ref={sim.rootRef}
      className="mx-auto grid h-[720px] w-full max-w-[1280px] grid-cols-[56px_minmax(0,1fr)] overflow-hidden rounded-2xl bg-sidebar shadow-[0_0_0_1px_rgba(255,255,255,0.10),0_40px_100px_-40px_rgba(0,0,0,0.6)] lg:grid-cols-[224px_minmax(0,1fr)]"
    >
      {/* Sidebar (inset variant, as in Beacon) */}
      <div className="flex flex-col gap-0.5 p-2">
        <div className="mb-1.5 flex h-9 items-center gap-2 px-2 font-semibold">
          <BeaconMark />
          <span className="hidden lg:inline">Beacon</span>
        </div>
        <button
          type="button"
          onClick={sim.nextInstance}
          aria-label="Switch instance"
          className="mb-1.5 hidden h-8 items-center justify-between rounded-lg border border-input bg-input/30 px-2.5 text-[13px] hover:bg-input/50 lg:flex"
        >
          <span className="flex items-center gap-1.5 truncate">
            {inst.name}
            <Badge variant="outline" className={tone[inst.tone]}>
              {inst.software}
            </Badge>
          </span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" aria-hidden />
        </button>
        <div className="hidden px-2 pt-2 pb-1 text-muted-foreground text-xs lg:block">Instance</div>
        {sim.sections.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant="ghost"
            size="sm"
            onClick={() => sim.setSection(id)}
            className={cn("h-8 justify-start gap-2 px-2 text-sm", s.section === id && "bg-sidebar-accent font-medium")}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="hidden lg:inline">{label}</span>
          </Button>
        ))}
        <div className="grow" />
        <Button variant="ghost" size="sm" className="h-8 justify-start gap-2 px-2 text-muted-foreground text-sm">
          <Coffee className="size-4 shrink-0" aria-hidden />
          <span className="hidden lg:inline">Java runtimes</span>
        </Button>
        <div className="mt-1 flex items-center gap-2.5 p-2">
          <div className="size-8 shrink-0 rounded-md bg-[#4b5563]" />
          <div className="hidden min-w-0 lg:block">
            <div className="font-medium text-[13px]">admin</div>
            <div className="truncate text-[11px] text-muted-foreground">admin@example.com</div>
          </div>
        </div>
      </div>

      {/* Inset content */}
      <div className="my-2 mr-2 flex min-w-0 flex-col overflow-hidden rounded-xl bg-background ring-1 ring-foreground/8">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4 text-sm">
          <PanelLeft className="size-4 text-muted-foreground" aria-hidden />
          <span className="text-muted-foreground">|</span>
          <span className="text-muted-foreground">Home</span>
          <span className="text-muted-foreground">›</span>
          <span className="text-muted-foreground">{inst.name}</span>
          <span className="text-muted-foreground">›</span>
          <span>{sim.title}</span>
        </div>

        <Header sim={sim} />

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="flex min-w-0 flex-col overflow-hidden p-5">
            <Section sim={sim} id={s.section} />
          </div>
          <Aside sim={sim} />
        </div>
      </div>
    </div>
  );
}

function StateBadge({ running }: { running: boolean }) {
  return (
    <Badge variant="outline" className={running ? tone.emerald : tone.muted}>
      {running ? "running" : "stopped"}
    </Badge>
  );
}

function Header({ sim }: { sim: Simulator }) {
  const { s, inst } = sim;
  const tiles = [
    { label: "CPU", icon: Cpu, value: sim.cpuNow, data: s.cpu },
    { label: "RAM", icon: MemoryStick, value: sim.memNow, data: s.mem },
    { label: "Network", icon: ArrowDownUp, value: sim.netNow, data: s.net },
    { label: "TPS", icon: Gauge, value: sim.tpsNow, data: s.tps },
  ];
  return (
    <div className="flex shrink-0 flex-col gap-3.5 border-b p-4 px-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-3 font-semibold text-[22px]">
          {inst.name} <StateBadge running={s.running} />
        </h2>
        <div className="flex gap-2">
          {s.running ? (
            <>
              <Button variant="secondary" onClick={sim.stop}>
                Stop
              </Button>
              <Button variant="outline" onClick={sim.restart}>
                Restart
              </Button>
            </>
          ) : (
            <Button onClick={sim.start}>Start</Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {tiles.map(({ label, icon: Icon, value, data }) => (
          <Card key={label} className="relative h-[84px] overflow-hidden py-0">
            <Sparkline data={data} className="absolute inset-x-0 bottom-0 h-12 w-full text-foreground" />
            <CardContent className="relative z-10 px-4 py-3">
              <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                <Icon className="size-3.5" aria-hidden />
                {label}
              </div>
              <div className="mt-0.5 truncate font-mono font-semibold text-base tabular-nums">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

const SECTION_VIEWS: Record<SectionId, React.ComponentType<{ sim: Simulator }>> = {
  console: ConsoleSection,
  metrics: MetricsSection,
  players: PlayersSection,
  properties: PropertiesSection,
  files: FilesSection,
  access: AccessSection,
  plugins: PluginsSection,
  backups: BackupsSection,
  settings: SettingsSection,
};

function Section({ sim, id }: { sim: Simulator; id: SectionId }) {
  const View = SECTION_VIEWS[id];
  return <View sim={sim} />;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono tabular-nums">{value}</span>
    </div>
  );
}

function Aside({ sim }: { sim: Simulator }) {
  const { inst, s, joined } = sim;
  return (
    <aside className="hidden flex-col gap-3 overflow-hidden border-l p-4 lg:flex">
      <Card className="py-0">
        <CardContent className="px-4 py-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-muted-foreground text-xs">Status</span>
            <StateBadge running={s.running} />
          </div>
          <Row label="Uptime" value={sim.uptime} />
          <Row label="PID" value={sim.pid} />
        </CardContent>
      </Card>
      <Card className="py-0">
        <CardContent className="px-4 py-3">
          <div className="mb-1 text-muted-foreground text-xs">Players · {joined.length}</div>
          {joined.length ? (
            <ul className="grid gap-0.5 font-mono text-sm">
              {joined.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">Nobody online.</p>
          )}
        </CardContent>
      </Card>
      <Card className="py-0">
        <CardContent className="px-4 py-3">
          <div className="mb-1 text-muted-foreground text-xs">Server</div>
          <Row label="Software" value={`${inst.software} ${inst.version}`} />
          <Row label="Build" value={inst.build} />
          <Row label="Port" value={inst.port} />
          <Row label="Size" value={inst.size} />
          <Row label="RAM" value={`${inst.memoryMb} MB`} />
          <Row label="Java" value="Temurin 21" />
        </CardContent>
      </Card>
    </aside>
  );
}
