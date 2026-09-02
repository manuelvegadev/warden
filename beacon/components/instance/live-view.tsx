"use client";

import { Badge } from "@warden/ui/components/badge";
import { Button } from "@warden/ui/components/button";
import { badgeTone } from "@warden/ui/lib/badge-tone";
import { cn } from "@warden/ui/lib/utils";
import { LocateFixed } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DetachControls } from "@/components/instance/detach-controls";
import { useInstance } from "@/components/instance/instance-context";
import { PlayerFace } from "@/components/instance/player-face";
import { SectionCard } from "@/components/instance/section-card";
import { useAction } from "@/hooks/use-action";
import { useDetachable } from "@/hooks/use-detachable";
import { useStoredPreference } from "@/hooks/use-stored-preference";
import type { WsMessage } from "@/hooks/use-wardend-socket";
import { instances, type LiveViewInfo, type PlayerPos, skins } from "@/lib/api";
import { chunkKey, parseBatch } from "@/lib/liveview/format";
import type { LiveViewScene } from "@/lib/liveview/scene";
import type { WorkerRequest, WorkerResponse } from "@/lib/liveview/worker";

const RADIUS_KEY = "beacon.liveview.radius";
const RADII = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16"] as const;
type Radius = (typeof RADII)[number];

const SUBTITLE = "The world around each player, as the agent streams it.";

/**
 * The live world view (ADR-018): the terrain around each player as flat-coloured blocks, the players
 * themselves, updated as the agent streams. `popout` is the pop-out window variant.
 */
export function LiveView({ popout }: { popout?: boolean }) {
  const { manifest, status, canManage, subscribe } = useInstance();
  const id = manifest.id;
  const [info, setInfo] = useState<LiveViewInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Positions arrive at 5 Hz and go straight to the scene; React only learns about them once a
  // second (the overlay list), or at once when the set of players changes.
  const playersRef = useRef<PlayerPos[]>([]);
  const [players, setPlayers] = useState<PlayerPos[]>([]);
  const [agentConnected, setAgentConnected] = useState(false);
  const [world, setWorld] = useState("");
  const [following, setFollowing] = useState<string | null>(null);
  const [radius, setRadius] = useStoredPreference<Radius>(RADIUS_KEY, "8", RADII);
  const [stats, setStats] = useState({ chunks: 0, pending: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<LiveViewScene | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const worldRef = useRef(world);
  worldRef.current = world;
  const radiusRef = useRef(radius);
  radiusRef.current = radius;

  const { rootRef, fullscreen, toggleFullscreen, openPopout, fillHeight, showPopout } = useDetachable(
    `/map/${id}`,
    `beacon-map-${id}`,
    popout,
  );

  const receivePlayers = useCallback((next: PlayerPos[], now: number) => {
    const prev = playersRef.current;
    playersRef.current = next;
    sceneRef.current?.setPlayers(next, now);
    const changed =
      prev.length !== next.length || prev.some((p, i) => p.name !== next[i].name || p.world !== next[i].world);
    if (changed) setPlayers(next);
  }, []);

  const refresh = useCallback(() => {
    instances
      .map(id)
      .then((i) => {
        setInfo(i);
        setError(null);
        setAgentConnected(i.agent.connected);
        receivePlayers(i.players, performance.now());
        setWorld(
          (w) => w || i.players[0]?.world || i.worlds.find((x) => x.chunks > 0)?.name || i.worlds[0]?.name || "",
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the live view"));
  }, [id, receivePlayers]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live stream: positions, chunk changes, agent state.
  useEffect(
    () =>
      subscribe((msg: WsMessage) => {
        switch (msg.type) {
          case "world.players":
            receivePlayers((msg.data as { players: PlayerPos[] }).players, performance.now());
            break;
          case "world.chunks": {
            const d = msg.data as { world: string; chunks: [number, number, string][] };
            sceneRef.current?.invalidate(d.world, d.chunks);
            break;
          }
          case "world.agent": {
            const d = msg.data as { connected: boolean };
            setAgentConnected(d.connected);
            if (d.connected) refresh();
            break;
          }
        }
      }),
    [subscribe, refresh, receivePlayers],
  );

  /** Points the scene and the mesher at a world and follows the first player there. */
  const applyWorld = useCallback((w: string) => {
    const scene = sceneRef.current;
    if (!scene || !w) return;
    scene.setWorld(w);
    workerRef.current?.postMessage({ type: "clear" } satisfies WorkerRequest);
    scene.setPlayers(playersRef.current, performance.now());
    scene.follow(playersRef.current.find((p) => p.world === w)?.name ?? null);
  }, []);

  // The scene and its worker live as long as the canvas does; later state reaches them through refs.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !info?.enabled) return;
    let scene: LiveViewScene | null = null;
    let worker: Worker | null = null;
    let disposed = false;
    const fetchChunks = (w: string, keys: [number, number][]) => {
      instances
        .mapChunks(id, w, keys)
        .then((buf) => {
          if (disposed || w !== worldRef.current) return;
          const records = parseBatch(buf);
          const got = new Set(records.map((r) => chunkKey(r.cx, r.cz)));
          scene?.markAbsent(keys.filter(([cx, cz]) => !got.has(chunkKey(cx, cz))));
          if (!records.length) return;
          // The whole batch moves to the worker in one transfer; records point into it.
          const msg: WorkerRequest = {
            type: "load",
            world: w,
            buffer: buf,
            records: records.map(({ cx, cz, hash, offset, length }) => ({ cx, cz, hash, offset, length })),
          };
          worker?.postMessage(msg, [buf]);
        })
        .catch((e) => {
          if (!disposed) toast.error(e instanceof Error ? e.message : "Could not load chunks");
        });
    };
    void import("@/lib/liveview/scene").then(({ LiveViewScene }) => {
      if (disposed) return;
      worker = new Worker(new URL("../../lib/liveview/worker.ts", import.meta.url));
      workerRef.current = worker;
      scene = new LiveViewScene(canvas, {
        onNeed: fetchChunks,
        onUnload: (w, keys) => worker?.postMessage({ type: "unload", world: w, keys } satisfies WorkerRequest),
        onFollow: setFollowing,
        skinUrl: skins.full,
      });
      sceneRef.current = scene;
      worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const msg = ev.data;
        if (msg.type === "mesh") scene?.setChunkMesh(msg.world, msg.cx, msg.cz, msg.hash, msg.mesh);
        else console.warn("live view:", msg.message);
      };
      scene.setRadius(Number(radiusRef.current));
      applyWorld(worldRef.current);
    });
    const ro = new ResizeObserver(() => scene?.resize());
    ro.observe(canvas);
    const timer = setInterval(() => {
      if (!scene) return;
      setStats(scene.stats());
      setPlayers(playersRef.current); // refreshes the coordinates in the overlay tooltips
    }, 1000);
    return () => {
      disposed = true;
      clearInterval(timer);
      ro.disconnect();
      worker?.terminate();
      scene?.dispose();
      sceneRef.current = null;
      workerRef.current = null;
    };
  }, [id, info?.enabled, applyWorld]);

  useEffect(() => applyWorld(world), [world, applyWorld]);
  useEffect(() => sceneRef.current?.setRadius(Number(radius)), [radius]);

  const run = useAction(refresh);
  const toggle = (enabled: boolean) =>
    run(async () => {
      await instances.setLiveView(id, enabled);
      return enabled ? "Live view enabled. Restart the server to load the agent." : "Live view disabled.";
    });

  const worldPlayers = useMemo(() => players.filter((p) => p.world === world), [players, world]);
  const worlds = info?.worlds ?? [];

  if (error) {
    return (
      <SectionCard title="Live view" subtitle={SUBTITLE}>
        <p className="px-5 pb-5 text-sm text-destructive">{error}</p>
      </SectionCard>
    );
  }
  if (!info) return null;
  if (!info.supported) {
    return (
      <SectionCard title="Live view" subtitle={SUBTITLE}>
        <p className="px-5 pb-5 text-sm text-muted-foreground">
          The live view needs the Warden Agent, a Paper plugin. This server runs {manifest.software}, which cannot load
          Bukkit plugins.
        </p>
      </SectionCard>
    );
  }
  if (!info.enabled) {
    return (
      <SectionCard title="Live view" subtitle={SUBTITLE}>
        <div className="grid gap-3 px-5 pb-5 text-sm">
          <p className="text-muted-foreground">
            Enabling it installs the Warden Agent into <code className="font-mono">plugins/</code>. The agent sends
            player positions and the terrain around them to the daemon; nothing is rendered on the server and no region
            file is read.
          </p>
          {canManage ? (
            <Button className="w-fit" onClick={() => toggle(true)}>
              Enable live view
            </Button>
          ) : (
            <p className="text-muted-foreground">A manager can enable it.</p>
          )}
        </div>
      </SectionCard>
    );
  }

  const running = status.state === "running";
  const viewClass = fillHeight ? "min-h-0 flex-1" : "h-[min(70vh,760px)]";
  return (
    <div ref={rootRef} className={cn("flex flex-col gap-2", fillHeight && "h-full", fullscreen && "bg-background p-3")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {worlds.length > 1 && (
            <div className="flex rounded-md border p-0.5">
              {worlds.map((w) => (
                <Button
                  key={w.name}
                  size="sm"
                  variant={w.name === world ? "secondary" : "ghost"}
                  onClick={() => setWorld(w.name)}
                  title={`${w.chunks} chunks cached`}
                >
                  {w.dimension ? w.dimension.replace("the_", "") : w.name}
                </Button>
              ))}
            </div>
          )}
          <Badge variant="outline" className={agentConnected ? badgeTone.emerald : badgeTone.muted}>
            {agentConnected ? "agent connected" : running ? "agent not connected" : "server stopped"}
          </Badge>
          <span className="text-xs text-muted-foreground tabular-nums">
            {stats.chunks} chunks{stats.pending ? ` · ${stats.pending} loading` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Radius
            <input
              type="range"
              min={2}
              max={16}
              value={radius}
              onChange={(e) => setRadius(e.target.value as Radius)}
              className="w-24"
              aria-label="Chunk radius"
            />
            <span className="w-4 tabular-nums">{radius}</span>
          </label>
          {canManage && (
            <Button size="sm" variant="ghost" onClick={() => toggle(false)}>
              Disable
            </Button>
          )}
          <DetachControls
            fullscreen={fullscreen}
            showPopout={showPopout}
            onPopout={openPopout}
            onToggleFullscreen={toggleFullscreen}
            label="live view"
          />
        </div>
      </div>
      <div className={cn("relative overflow-hidden rounded-md border bg-sky-200", viewClass)}>
        <canvas ref={canvasRef} className="block h-full w-full touch-none" />
        <div className="absolute top-2 left-2 flex max-h-[calc(100%-1rem)] flex-col gap-1 overflow-auto">
          {worldPlayers.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => sceneRef.current?.follow(following === p.name ? null : p.name)}
              className={cn(
                "flex items-center gap-2 rounded-md border bg-background/85 px-2 py-1 text-left text-xs backdrop-blur",
                following === p.name && "border-primary",
              )}
              title={`${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}`}
            >
              <PlayerFace name={p.name} className="size-5" />
              <span className="font-medium">{p.name}</span>
              {following === p.name && <LocateFixed className="size-3 text-primary" />}
            </button>
          ))}
          {worldPlayers.length === 0 && (
            <span className="rounded-md bg-background/85 px-2 py-1 text-xs text-muted-foreground backdrop-blur">
              {agentConnected ? "Nobody online in this world" : "Waiting for the agent"}
            </span>
          )}
        </div>
        {agentConnected && worlds.every((w) => w.chunks === 0) && (
          <div className="absolute inset-x-0 bottom-3 text-center text-xs text-muted-foreground">
            Terrain appears as players load chunks around them.
          </div>
        )}
      </div>
    </div>
  );
}
