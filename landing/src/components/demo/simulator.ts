import { useCallback, useEffect, useRef, useState } from "react";
import {
  BACKUPS,
  type DemoBackup,
  type DemoPlugin,
  type DemoProperty,
  INSTANCES,
  LOG,
  LOG_COLOR,
  type LogLine,
  PLUGINS,
  PROPERTIES,
  SECTIONS,
  type SectionId,
} from "./data";

/** Everything the demo shows, driven by a 1.5 s tick while the fake server "runs". */
export interface SimState {
  instance: number;
  section: SectionId;
  running: boolean;
  lines: LogLine[];
  fed: number; // how many LOG entries have been streamed so far
  uptime: number; // seconds
  dirty: boolean;
  file: string;
  cpu: number[];
  mem: number[];
  net: number[];
  tps: number[];
  props: DemoProperty[];
  plugins: DemoPlugin[];
  backups: DemoBackup[];
}

const POINTS = 30;
const series = (f: (i: number) => number) => Array.from({ length: POINTS }, (_, i) => f(i));
const jitter = (a: number[], k: number, lo: number, hi: number) =>
  a.slice(1).concat([Math.min(hi, Math.max(lo, a[a.length - 1] + (Math.random() - 0.5) * k))]);
const stamp = () => `[${new Date().toTimeString().slice(0, 8)} INFO]: `;
let seq = 0;
/** Lines get a unique id so React keys stay stable while the buffer scrolls. */
const keep = (lines: LogLine[], line: LogLine) => lines.slice(-11).concat([{ ...line, id: ++seq }]);
const seed = (lines: LogLine[]) => lines.map((l) => ({ ...l, id: ++seq }));

const initial = (): SimState => ({
  instance: 0,
  section: "console",
  running: true,
  lines: seed(LOG.slice(0, 5)),
  fed: 5,
  uptime: 3 * 3600 + 22 * 60 + 8,
  dirty: false,
  file: "server.properties",
  cpu: series((i) => 0.3 + 0.12 * Math.sin(i / 3)),
  mem: series((i) => 0.5 + i * 0.006),
  net: series((i) => 0.2 + 0.15 * Math.abs(Math.sin(i / 2))),
  tps: series(() => 0.98),
  props: PROPERTIES,
  plugins: PLUGINS,
  backups: BACKUPS,
});

export function useSimulator() {
  const [s, set] = useState<SimState>(initial);
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  // Tick only while the demo is on screen and the fake server runs.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !s.running) return;
    const id = setInterval(() => {
      set((st) => {
        const next: SimState = {
          ...st,
          cpu: jitter(st.cpu, 0.14, 0.08, 0.9),
          mem: jitter(st.mem, 0.03, 0.35, 0.85),
          net: jitter(st.net, 0.2, 0.05, 0.9),
          tps: jitter(st.tps, 0.03, 0.9, 1),
          uptime: st.uptime + 1.5,
        };
        if (st.fed < LOG.length) {
          next.lines = keep(st.lines, LOG[st.fed]);
          next.fed = st.fed + 1;
        }
        return next;
      });
    }, 1500);
    return () => clearInterval(id);
  }, [visible, s.running]);

  const push = useCallback((text: string, color: string = LOG_COLOR.info) => {
    set((st) => ({ ...st, lines: keep(st.lines, { text, color }) }));
  }, []);

  const inst = INSTANCES[s.instance];
  const joined = s.running ? LOG.slice(0, s.fed).flatMap((l) => (l.joins ? [l.joins] : [])) : [];
  // Plugins only exist on Paper/Purpur.
  const sections = SECTIONS.filter((x) => x.id !== "plugins" || inst.software !== "Fabric");
  const last = (a: number[]) => a[a.length - 1];

  const actions = {
    setSection: (section: SectionId) => set((st) => ({ ...st, section })),
    nextInstance: () =>
      set((st) => {
        const instance = (st.instance + 1) % INSTANCES.length;
        // Fall back to the console when switching to Fabric while on Plugins (see `sections`).
        const section = st.section === "plugins" && INSTANCES[instance].software === "Fabric" ? "console" : st.section;
        return { ...st, instance, section };
      }),
    stop: () => {
      push(`[wardend]: Stopping ${inst.name} (save-all → stop → 30 s grace)`, LOG_COLOR.daemon);
      set((st) => ({ ...st, running: false }));
    },
    start: () => set((st) => ({ ...st, running: true, lines: [], fed: 0, uptime: 0 })),
    restart: () =>
      set((st) => ({
        ...st,
        running: true,
        dirty: false,
        fed: 0,
        uptime: 0,
        lines: seed([{ text: `[wardend]: Restarting ${inst.name}`, color: LOG_COLOR.daemon }]),
      })),
    runList: () =>
      push(
        `${stamp()}There are ${joined.length} of a max of 40 players online${joined.length ? `: ${joined.join(", ")}` : ""}`,
      ),
    runSay: () => {
      push("> say Backup in 5 minutes", LOG_COLOR.stdin);
      push(`${stamp()}[Server] Backup in 5 minutes`);
    },
    runTps: () => push(`${stamp()}TPS from last 1m, 5m, 15m: ${(last(s.tps) * 20).toFixed(2)}, 19.98, 20.0`),
    flipProp: (i: number) =>
      set((st) => ({ ...st, dirty: true, props: st.props.map((p, k) => (k === i ? { ...p, on: !p.on } : p)) })),
    pickFile: (file: string) => set((st) => ({ ...st, file })),
    cyclePlugin: (i: number) =>
      set((st) => ({
        ...st,
        plugins: st.plugins.map((p, k) =>
          k === i ? { ...p, status: p.status === "available" ? "queued" : "available" } : p,
        ),
      })),
    installQueue: () => {
      set((st) => ({
        ...st,
        plugins: st.plugins.map((p) => (p.status === "queued" ? { ...p, status: "installed" } : p)),
      }));
      push("[wardend]: Installed queued plugins (sha256 verified)", LOG_COLOR.daemon);
    },
    backupNow: () => {
      const name = `${new Date().toISOString().slice(0, 16).replace(":", "-")}.tar.zst`;
      set((st) => ({ ...st, backups: [{ name, size: "1.9 GB", kind: "manual" as const }, ...st.backups] }));
      push(`[wardend]: backup ${inst.name} → ${name} (1.9 GB) in 41 s`, LOG_COLOR.daemon);
    },
  };

  const h = Math.floor(s.uptime / 3600);
  const m = Math.floor((s.uptime % 3600) / 60);
  const sec = Math.floor(s.uptime % 60);
  const derived = {
    rootRef,
    inst,
    joined,
    sections,
    title: SECTIONS.find((x) => x.id === s.section)?.label ?? "Console",
    cpuNow: s.running ? `${(last(s.cpu) * 100).toFixed(1)} %` : "—",
    memNow: s.running ? `${((last(s.mem) * inst.memoryMb) / 1024).toFixed(1)}G/${inst.memoryMb / 1024}G` : "—",
    netNow: s.running ? `↓${Math.round(last(s.net) * 900)}K ↑${Math.round(last(s.net) * 2400)}K/s` : "—",
    tpsNow: s.running ? (last(s.tps) * 20).toFixed(1) : "—",
    uptime: s.running ? `${h}h ${m}m ${sec}s` : "—",
    pid: s.running ? "41872" : "—",
  };

  return { s, ...derived, ...actions };
}

export type Simulator = ReturnType<typeof useSimulator>;
