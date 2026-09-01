/**
 * How much is too much, for the settings that decide whether a server keeps up.
 *
 * `view-distance` and `simulation-distance` are valid up to 32, but 32 is a number almost no
 * server should use: the work grows with the square of the distance, so going from 10 to 20 is not
 * twice the cost, it is four times it. What "too much" means depends on the box — 10 chunks is
 * comfortable on 8 GB and eight cores, and hopeless on 1 GB and one — so the answer has to be
 * computed against the instance, not looked up in a table.
 *
 * Two things bound it, and they fail differently:
 *
 *   RAM   every loaded chunk is resident. A player at distance d holds (2d+1)² chunks, so this is
 *         what runs a server out of heap and into GC thrash.
 *   CPU   ticking is the part that costs frames. Only simulation-distance chunks tick, and the
 *         world tick is largely one thread, so this is what drops TPS.
 *
 * The constants below come from what hosting guides and the Paper optimization community publish
 * (see the block above each one). They are estimates, deliberately on the pessimistic side of the
 * published ranges: the point is to warn before a server stutters, not to predict its heap.
 */

/** The instance, as far as this model cares. */
export type Resources = {
  /** Heap the instance is started with, in MB. */
  memoryMb: number;
  /** Cores on the machine. wardend does not pin instances to cores, so this is shared. */
  cores: number;
  /** `max-players` — the model plans for a full server, since that is when it breaks. */
  players: number;
  /** The distances currently set, which is what decides how much a player costs. */
  viewDistance: number;
  simulationDistance: number;
};

export type Verdict = {
  level: "ok" | "caution" | "over";
  /** One sentence for the person about to drag the slider. Empty when there is nothing to say. */
  reason: string;
  /** Highest value that still lands on "ok", for a marker on the track. */
  recommended: number;
  /**
   * True when even the minimum is over budget. The distance is then not the thing to change —
   * the instance is undersized for the player count it advertises — so the message says so
   * instead of pointing at a slider that cannot fix it.
   */
  hopeless?: boolean;
};

/**
 * Resident memory per loaded chunk. Hosting guides put an empty chunk at 50–100 KB and note that
 * chunks with tile entities cost considerably more; we take the top of that range.
 */
const MB_PER_CHUNK = 0.1;

/** Per connected player, excluding their chunks: entities, inventory, connection. Guides say 50–100 MB. */
const MB_PER_PLAYER = 60;

/**
 * The process with nobody in it: JVM, spawn chunks, plugins. Not the 1–2 GB guides quote for a
 * small server — that figure is the total, players included, which is what this whole model adds up.
 */
const MB_BASE = 512;

/**
 * Ticked chunks one core sustains at 20 TPS. Calibrated so the thresholds land where the community
 * puts them: simulation-distance 4–5 is comfortable, the vanilla default of 10 is already heavy on
 * a single core with a busy server, and the top of the range is out of reach for anyone.
 */
const TICKED_CHUNKS_PER_CORE = 6000;

/**
 * What guides converge on regardless of hardware: view-distance 7–8, simulation-distance 4–5, and
 * "10+ only on a strong box with few players". Past these, the extra chunks buy very little that a
 * player notices, so we say so even when the resources are there.
 */
const DIMINISHING_RETURNS = { view: 12, simulation: 8 };

/**
 * How much of the budget a full server may use before we call it tight. Guides put it as "allocate
 * 1–2 GB more than steady-state": joins, saves and fresh chunk generation all spike above it.
 */
const HEADROOM = 0.8;

/** Chunks a player holds at distance d — the square that makes big distances expensive. */
export const chunksAt = (distance: number): number => (2 * distance + 1) ** 2;

/** Estimated heap for `players` at this view distance, in MB. */
export function memoryFor(distance: number, players: number): number {
  return Math.round(MB_BASE + players * (MB_PER_PLAYER + chunksAt(distance) * MB_PER_CHUNK));
}

/** Chunks the server ticks with everyone online at this simulation distance. */
export const tickedChunks = (distance: number, players: number): number => players * chunksAt(distance);

/** The largest distance whose cost still fits, found by walking down from the maximum. */
function largestThatFits(max: number, min: number, fits: (d: number) => boolean): number {
  for (let d = max; d > min; d--) if (fits(d)) return d;
  return min;
}

/**
 * Judge a view-distance against the box. Bounded by memory: every chunk in view is resident,
 * whether or not anything in it moves.
 */
export function judgeViewDistance(distance: number, r: Resources, min = 3, max = 32): Verdict {
  const fitsMemory = (d: number) => memoryFor(d, r.players) <= r.memoryMb;
  const withinBudget = largestThatFits(max, min, fitsMemory);
  const recommended = Math.min(withinBudget, DIMINISHING_RETURNS.view);

  if (!fitsMemory(min)) {
    return {
      level: "over",
      reason: `${gb(r.memoryMb)} does not hold ${r.players} players at any view distance — this needs more memory, or a lower max-players.`,
      recommended: min,
      hopeless: true,
    };
  }
  if (!fitsMemory(distance)) {
    const need = memoryFor(distance, r.players);
    return {
      level: "over",
      reason: `About ${gb(need)} of heap with ${r.players} players online, and this instance has ${gb(r.memoryMb)}. Around ${withinBudget} chunks is what fits.`,
      recommended,
    };
  }
  if (distance > DIMINISHING_RETURNS.view) {
    return {
      level: "caution",
      reason: `Past about ${DIMINISHING_RETURNS.view} chunks players barely notice the difference, and each one costs ${chunksAt(distance) - chunksAt(distance - 1)} more chunks per player.`,
      recommended,
    };
  }
  return { level: "ok", reason: "", recommended };
}

/**
 * Judge a simulation-distance. Bounded by CPU: these are the chunks that tick, and the world tick
 * is largely a single thread, so this is the setting that shows up as TPS.
 */
export function judgeSimulationDistance(distance: number, r: Resources, min = 3, max = 32): Verdict {
  const budget = Math.max(1, r.cores) * TICKED_CHUNKS_PER_CORE;
  const fitsCpu = (d: number) => tickedChunks(d, r.players) <= budget;
  const withinBudget = largestThatFits(max, min, fitsCpu);
  const recommended = Math.min(withinBudget, DIMINISHING_RETURNS.simulation);

  if (!fitsCpu(min)) {
    return {
      level: "over",
      reason: `${r.cores} core${r.cores === 1 ? "" : "s"} cannot tick ${r.players} players at any simulation distance — this needs more cores, or a lower max-players.`,
      recommended: min,
      hopeless: true,
    };
  }
  if (!fitsCpu(distance)) {
    return {
      level: "over",
      reason: `${tickedChunks(distance, r.players).toLocaleString()} ticking chunks with ${r.players} players, on ${r.cores} core${r.cores === 1 ? "" : "s"}. TPS will drop before the heap does; around ${withinBudget} chunks is what this box ticks.`,
      recommended,
    };
  }
  if (distance > DIMINISHING_RETURNS.simulation) {
    return {
      level: "caution",
      reason: `Mobs, crops and redstone all tick out to here. Most servers sit at 4–5 and let view-distance carry the view.`,
      recommended,
    };
  }
  return { level: "ok", reason: "", recommended };
}

/** Which judgement applies to a property, if any. */
export function judgeProperty(key: string, value: number, r: Resources, min = 3, max = 32): Verdict | null {
  if (key === "view-distance") return judgeViewDistance(value, r, min, max);
  if (key === "simulation-distance") return judgeSimulationDistance(value, r, min, max);
  if (key === "max-players") return judgeMaxPlayers(value, r);
  return null;
}

const gb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`);

/**
 * How many players the instance can actually serve — the same budget as above, solved for the
 * other unknown. A server that advertises 100 slots on 2 GB is not configured for 100 players; it
 * is configured to fill up and fall over, and the number in this box is the promise being made.
 *
 * Both limits apply, and whichever runs out first is the real one.
 */
export function judgeMaxPlayers(players: number, r: Resources): Verdict {
  const perPlayerMb = MB_PER_PLAYER + chunksAt(r.viewDistance) * MB_PER_CHUNK;
  const byMemory = Math.floor(Math.max(0, r.memoryMb - MB_BASE) / perPlayerMb);
  const byCpu = Math.floor((Math.max(1, r.cores) * TICKED_CHUNKS_PER_CORE) / chunksAt(r.simulationDistance));
  const ceiling = Math.min(byMemory, byCpu); // the hard wall
  const comfortable = Math.max(1, Math.floor(ceiling * HEADROOM)); // what it recommends, with room to spike
  const memoryIsTighter = byMemory <= byCpu;

  if (ceiling < 1) {
    return {
      level: "over",
      reason: `${gb(r.memoryMb)} on ${r.cores} core${r.cores === 1 ? "" : "s"} cannot serve one player at these distances. Lower view-distance and simulation-distance first.`,
      recommended: 1,
      hopeless: true,
    };
  }
  if (players > ceiling) {
    return {
      level: "over",
      reason: memoryIsTighter
        ? `${players} players at view-distance ${r.viewDistance} would want about ${gb(memoryFor(r.viewDistance, players))}, and this instance has ${gb(r.memoryMb)}. It comfortably serves about ${comfortable}.`
        : `${players} players at simulation-distance ${r.simulationDistance} is ${tickedChunks(r.simulationDistance, players).toLocaleString()} ticking chunks on ${r.cores} core${r.cores === 1 ? "" : "s"}. It comfortably ticks about ${comfortable}.`,
      recommended: comfortable,
    };
  }
  // Guides say to leave headroom over steady-state use: chunk generation, saves and joins all spike.
  if (players > ceiling * HEADROOM) {
    return {
      level: "caution",
      reason: `${ceiling} is the hard ceiling, so a full server leaves almost nothing for chunk generation or a busy evening. About ${comfortable} keeps a margin.`,
      recommended: comfortable,
    };
  }
  return { level: "ok", reason: "", recommended: comfortable };
}
