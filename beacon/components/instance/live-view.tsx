"use client";

import { Button } from "@warden/ui/components/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@warden/ui/components/select";
import { cn } from "@warden/ui/lib/utils";
import {
  CalendarDays,
  Camera,
  Clock,
  CloudLightning,
  CloudRain,
  Flashlight,
  FlashlightOff,
  RotateCcw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DetachControls } from "@/components/instance/detach-controls";
import { useInstance } from "@/components/instance/instance-context";
import {
  CAMERA_LABELS,
  CAMERA_MODES,
  CAMERAS,
  cameraDescription,
  cameraHint,
} from "@/components/instance/live-view-cameras";
import { Chip, OVERLAY } from "@/components/instance/live-view-chip";
import {
  BRIGHTNESS_DEFAULT,
  LEAVES_MODES,
  LiveViewSettings,
  PIXEL_SCALES,
  type PixelScale,
  type ViewSettings,
} from "@/components/instance/live-view-settings";
import { PlayerFace } from "@/components/instance/player-face";
import { SectionCard } from "@/components/instance/section-card";
import { useVoice, useVoiceStatus, VoiceControls, VoicePresencePill } from "@/components/instance/voice-listen";
import { useDetachable } from "@/hooks/use-detachable";
import { useStoredFlag, useStoredPreference } from "@/hooks/use-stored-preference";
import type { WsMessage } from "@/hooks/use-wardend-socket";
import { instances, type LiveViewInfo, type PlayerPos, skins, type WorldClock } from "@/lib/api";
import type { CameraMode } from "@/lib/liveview/camera-modes";
import {
  HANDOVER_FLASH_MS,
  HANDOVER_REVEAL_MS,
  HANDOVER_VEIL_MS,
  RADIUS_MAX,
  RADIUS_MIN,
} from "@/lib/liveview/constants";
import { playCue, preloadCue } from "@/lib/liveview/cues";
import { chunkKey, parseBatch } from "@/lib/liveview/format";
import type { IdleScene } from "@/lib/liveview/idle-scene";
import type { FaceTable, LeavesMode } from "@/lib/liveview/mesher";
import type { LiveViewScene, PlayerMarker } from "@/lib/liveview/scene";
import { clockParts, WEATHER_LABELS } from "@/lib/liveview/sky";
import { loadBlockTextures } from "@/lib/liveview/textures";
import type { WorkerRequest, WorkerResponse } from "@/lib/liveview/worker";

const RADIUS_KEY = "beacon.liveview.radius";
const CAMERA_KEY = "beacon.liveview.camera";
const GLOW_KEY = "beacon.liveview.glow";
const RELIEF_KEY = "beacon.liveview.relief";
const PIXEL_SCALE_KEY = "beacon.liveview.pixel-scale";
const LEAVES_KEY = "beacon.liveview.leaves";
const TEXTURES_KEY = "beacon.liveview.textures";
const NIGHT_VISION_KEY = "beacon.liveview.night-vision";
/** The game's brightness option, in percent. */
const BRIGHTNESS_KEY = "beacon.liveview.brightness";
/** The steps the brightness slider takes, as the stored preference's allow-list. */
const BRIGHTNESS_STEPS = Array.from({ length: 21 }, (_, i) => String(i * 5));
/** The renderer's pixel ratio for a stored scale; the device's is read when applied, so a window moved between screens follows. */
const pixelRatioOf = (scale: PixelScale) => (scale === "device" ? window.devicePixelRatio || 1 : Number(scale));
/** Chunk radii the slider can take, as the stored preference's allow-list. */
const RADII = Array.from({ length: RADIUS_MAX - RADIUS_MIN + 1 }, (_, i) => String(i + RADIUS_MIN));

const SUBTITLE = "The world around each player, as the agent streams it.";
/** How far inside the view's edges a name tag stays, in pixels. */
const TAG_MARGIN = 8;

function CameraIcon({ mode, className }: { mode: CameraMode; className?: string }) {
  const Icon = CAMERAS[mode].icon;
  return <Icon className={className} aria-hidden="true" />;
}

/** The world's clock as chips: the weather when there is any, then the day, then the time. */
function ClockChips({ clock }: { clock: WorldClock }) {
  const { day, time, weather } = clockParts(clock);
  return (
    <>
      {weather && (
        <Chip className="pointer-events-none">
          {weather === "thunder" ? <CloudLightning /> : <CloudRain />}
          {WEATHER_LABELS[weather]}
        </Chip>
      )}
      <Chip className="font-mono" title={`Day ${day}`}>
        <CalendarDays />
        {day}
      </Chip>
      <Chip className="pointer-events-none font-mono">
        <Clock />
        {time}
      </Chip>
    </>
  );
}

/** What the viewer is waiting on, when it is not showing the world. */
const PHASES = {
  stopped: { badge: "server stopped", title: "The server is stopped", hint: "Start the server to see the world." },
  connecting: {
    badge: "agent not connected",
    title: "Waiting for the agent",
    hint: "The plugin connects a few seconds after the server starts.",
  },
  ready: {
    badge: "agent connected",
    title: "Waiting for a player",
    hint: "The world appears around the first player to join.",
  },
} as const;

/**
 * The live world view (ADR-018): the terrain around each player as flat-coloured blocks, the players
 * themselves, updated as the agent streams. `popout` is the pop-out window variant.
 */
export function LiveView({ popout }: { popout?: boolean }) {
  const { manifest, status, subscribe } = useInstance();
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
  const [radius, setRadius] = useStoredPreference<string>(RADIUS_KEY, "8", RADII);
  const [cameraMode, setCameraMode] = useStoredPreference<CameraMode>(CAMERA_KEY, "orbit", CAMERA_MODES);
  const [debug, setDebug] = useState(false);
  const [glow, setGlow] = useStoredFlag(GLOW_KEY, true);
  const [relief, setRelief] = useStoredFlag(RELIEF_KEY, true);
  const [pixelScale, setPixelScale] = useStoredPreference<PixelScale>(PIXEL_SCALE_KEY, "1", PIXEL_SCALES);
  const [leaves, setLeaves] = useStoredPreference<LeavesMode>(LEAVES_KEY, "fancy", LEAVES_MODES);
  const [textures, setTextures] = useStoredFlag(TEXTURES_KEY, true);
  const [nightVision, setNightVision] = useStoredFlag(NIGHT_VISION_KEY, false);
  const [brightness, setBrightness] = useStoredPreference<string>(
    BRIGHTNESS_KEY,
    String(BRIGHTNESS_DEFAULT),
    BRIGHTNESS_STEPS,
  );
  /** The block face table once loaded, and a counter so the settings reach the worker with it. */
  const facesRef = useRef<FaceTable | null>(null);
  const [facesLoaded, setFacesLoaded] = useState(0);
  const [stats, setStats] = useState({ chunks: 0, pending: 0 });
  // Bumped to rebuild the scene and its worker from scratch: the debug overlay's way of dropping
  // every chunk the viewer holds when the daemon's copy has moved on and the meshes have not.
  const [rebuild, setRebuild] = useState(0);
  // Bumped once the scene and worker exist, so the settings effect below applies every value to
  // them: one list, whether the scene is new or a setting changed.
  const [sceneEpoch, setSceneEpoch] = useState(0);
  const [clock, setClock] = useState<WorldClock | null>(null);
  // Voice (ADR-019): the players' voices while "Listen" is on; the tags of those heard light up.
  const voiceStatus = useVoiceStatus(id);
  const voice = useVoice(id, voiceStatus);
  const voiceUpdate = voice.update;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const idleCanvasRef = useRef<HTMLCanvasElement>(null);
  // Name tags: an HTML layer over the canvas, moved every frame without going through React. A tag
  // whose player is out of view is kept whole at the nearest edge.
  const tagLayerRef = useRef<HTMLDivElement>(null);
  const markerEls = useRef(new Map<string, HTMLDivElement>());
  // A tag's size never changes (its text is the name): measured once, not every frame.
  const tagSizes = useRef(new WeakMap<HTMLDivElement, { w: number; h: number }>());
  const placeMarkers = useCallback((markers: PlayerMarker[]) => {
    const layer = tagLayerRef.current;
    if (!layer) return;
    const w = layer.clientWidth;
    const h = layer.clientHeight;
    const placed = new Set<string>();
    for (const m of markers) {
      const el = markerEls.current.get(m.name);
      if (!el) continue;
      placed.add(m.name);
      el.hidden = false;
      let size = tagSizes.current.get(el);
      if (!size) {
        size = { w: el.offsetWidth, h: el.offsetHeight };
        tagSizes.current.set(el, size);
      }
      const halfWidth = size.w / 2;
      const height = size.h;
      const x = Math.min(Math.max(m.x, TAG_MARGIN + halfWidth), w - TAG_MARGIN - halfWidth);
      const y = Math.min(Math.max(m.y, TAG_MARGIN + height), h - TAG_MARGIN);
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    }
    for (const [name, el] of markerEls.current) if (!placed.has(name)) el.hidden = true;
  }, []);
  const sceneRef = useRef<LiveViewScene | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const worldRef = useRef(world);
  worldRef.current = world;
  const clocksRef = useRef<Record<string, WorldClock>>({});
  const radiusRef = useRef(Number(radius));

  const { rootRef, fullscreen, toggleFullscreen, openPopout, showPopout } = useDetachable(
    `/map/${id}`,
    `beacon-map-${id}`,
    popout,
  );

  const receivePlayers = useCallback((next: PlayerPos[], now: number, clocks?: Record<string, WorldClock>) => {
    const prev = playersRef.current;
    playersRef.current = next;
    if (clocks) {
      clocksRef.current = clocks;
      sceneRef.current?.setClocks(clocks);
    }
    sceneRef.current?.setPlayers(next, now);
    const changed =
      prev.length !== next.length ||
      prev.some((p, i) => p.name !== next[i].name || p.world !== next[i].world || p.voice !== next[i].voice);
    if (changed) setPlayers(next);
  }, []);

  const refresh = useCallback(() => {
    instances
      .map(id)
      .then((i) => {
        setInfo(i);
        setError(null);
        setAgentConnected(i.agent.connected);
        receivePlayers(i.players, performance.now(), i.clocks);
        // Only the overworld for now: the Nether needs its own surface rule and both need their own sky.
        setWorld(
          (w) =>
            w ||
            i.worlds.find((x) => x.dimension === "normal" || x.dimension === "overworld")?.name ||
            i.worlds[0]?.name ||
            "",
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
          case "world.players": {
            const d = msg.data as { players: PlayerPos[]; worlds?: Record<string, WorldClock> };
            receivePlayers(d.players, performance.now(), d.worlds);
            break;
          }
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

  // The scene and its worker live as long as the canvas does; later state reaches them through the
  // settings effect below.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rebuild` is the point of the dependency, not a value the body reads — bumping it tears the scene and the worker down and builds them again.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !info?.supported) return;
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
        onMarkers: placeMarkers,
        onFrame: () => {
          if (scene) voiceUpdate(scene);
        },
        skinUrl: skins.full,
      });
      sceneRef.current = scene;
      setSceneEpoch((n) => n + 1);
      // A handle for measuring the renderer from the console while developing.
      if (process.env.NODE_ENV !== "production") (window as { __beaconScene?: LiveViewScene }).__beaconScene = scene;
      worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const msg = ev.data;
        if (msg.type === "meshes")
          for (const m of msg.items) scene?.setChunkMesh(m.world, m.cx, m.cz, m.hash, m.mesh, m.sky);
        else console.warn("live view:", msg.message);
      };
      // The block textures: the game's art, if the server fetched it; flat colours until then, or by choice.
      void loadBlockTextures().then((t) => {
        if (disposed || !t || !scene) return;
        scene.setBlockTextures(t.texture);
        facesRef.current = t.faces;
        setFacesLoaded((n) => n + 1);
      });
      scene.setRadius(radiusRef.current);
      scene.setClocks(clocksRef.current);
      applyWorld(worldRef.current);
    });
    const ro = new ResizeObserver(() => scene?.resize());
    ro.observe(canvas);
    const timer = setInterval(() => {
      if (!scene) return;
      setStats(scene.stats());
      setPlayers(playersRef.current); // refreshes the coordinates in the overlay tooltips
      setClock(scene.currentClock());
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
  }, [id, info?.supported, applyWorld, placeMarkers, voiceUpdate, rebuild]);

  useEffect(() => applyWorld(world), [world, applyWorld]);

  // Who is being heard, a few times a second while listening. The tags are an imperative layer
  // (moved every frame without React), so the highlight is a data attribute on them, not state.
  useEffect(() => {
    const mark = (heard: Set<string>) => {
      for (const p of playersRef.current) {
        const el = markerEls.current.get(p.name);
        if (el) el.dataset.speaking = heard.has(p.uuid) ? "true" : "false";
      }
    };
    if (!voice.listening) {
      mark(new Set());
      return;
    }
    const timer = setInterval(() => mark(voice.speaking()), 150);
    return () => {
      clearInterval(timer);
      mark(new Set());
    };
  }, [voice.listening, voice.speaking]);
  // Every setting the scene and the worker hold, applied together: on a change, and again whenever
  // the scene is rebuilt, so a new scene never starts with a setting the user cannot see is missing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `sceneEpoch` and `facesLoaded` are what makes this run again once the scene, the worker and the block faces exist; they are counters, not values the body reads.
  useEffect(() => {
    const scene = sceneRef.current;
    const worker = workerRef.current;
    if (!scene || !worker) return;
    scene.setCameraMode(cameraMode);
    scene.setDebug(debug);
    scene.setGlow(glow);
    scene.setRelief(relief);
    scene.setNightVision(nightVision);
    scene.setBrightness(Number(brightness) / 100);
    scene.setPixelRatio(pixelRatioOf(pixelScale));
    worker.postMessage({ type: "leaves", mode: leaves } satisfies WorkerRequest);
    worker.postMessage({ type: "textures", faces: textures ? facesRef.current : null } satisfies WorkerRequest);
  }, [sceneEpoch, facesLoaded, cameraMode, debug, glow, relief, nightVision, brightness, pixelScale, leaves, textures]);

  // A screenshot of the scene (F2, the game's key, or the camera button): saved as a PNG and put on
  // the clipboard where the browser allows it. The name tags are HTML and are not in it.
  const screenshot = useCallback(async () => {
    const scene = sceneRef.current;
    if (!scene) return;
    try {
      const blob = await scene.snapshot();
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `beacon-${id}-${stamp}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      let copied = false;
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).then(
          () => {
            copied = true;
          },
          () => {},
        );
      }
      toast.success(copied ? "Screenshot saved and copied" : "Screenshot saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not take the screenshot");
    }
  }, [id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F2" || e.repeat) return;
      e.preventDefault();
      void screenshot();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screenshot]);

  const worldPlayers = useMemo(() => players.filter((p) => p.world === world), [players, world]);
  const idle = worldPlayers.length === 0;
  const idleSceneRef = useRef<IdleScene | null>(null);
  // Arriving: "charging", the waiting scene runs up to white, then "revealing", the world fades in
  // under the veil. Leaving: "leaving", the world flashes to white, then "returning", the waiting
  // scene fades in under it. Each pair lasts exactly as long as its beacon sound.
  const [transition, setTransition] = useState<"none" | "charging" | "revealing" | "leaving" | "returning">("none");
  // The lengths of the current transition's steps, fixed when it starts from the sound's length.
  const steps = useRef({
    charge: 0,
    veil: HANDOVER_VEIL_MS,
    reveal: HANDOVER_REVEAL_MS,
    flash: HANDOVER_FLASH_MS,
    fade: 0,
  });
  const wasIdle = useRef(idle);

  // The waiting scene lives on its own canvas, shown in place of the world while nobody is in it.
  useEffect(() => {
    const canvas = idleCanvasRef.current;
    if (!canvas || !info?.supported) return;
    let scene: IdleScene | null = null;
    let disposed = false;
    void import("@/lib/liveview/idle-scene").then(({ IdleScene }) => {
      if (disposed) return;
      scene = new IdleScene(canvas);
      idleSceneRef.current = scene;
    });
    void preloadCue("activate");
    void preloadCue("deactivate");
    const ro = new ResizeObserver(() => scene?.resize());
    ro.observe(canvas);
    return () => {
      disposed = true;
      ro.disconnect();
      scene?.dispose();
      idleSceneRef.current = null;
    };
  }, [info?.supported]);

  // The first player arriving while the waiting scene is up: the beacon activates — charge, white
  // out, reveal the world. The last one leaving: it deactivates — flash to white, the waiting room
  // fades in. Both are paced by their sound.
  useEffect(() => {
    const was = wasIdle.current;
    wasIdle.current = idle;
    const scene = idleSceneRef.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (was === idle || !scene || reduced) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const st = steps.current;
    if (!idle) {
      const total = playCue("activate");
      st.reveal = Math.min(HANDOVER_REVEAL_MS, total / 3);
      st.charge = total - st.reveal;
      st.veil = Math.min(HANDOVER_VEIL_MS, st.charge / 2);
      setTransition("charging");
      void scene.charge(st.charge).then(() => {
        if (cancelled) return;
        setTransition("revealing");
        scene.reset();
        timer = setTimeout(() => setTransition("none"), st.reveal);
      });
    } else {
      const total = playCue("deactivate");
      st.flash = Math.min(HANDOVER_FLASH_MS, total / 4);
      st.fade = total - st.flash;
      setTransition("leaving");
      timer = setTimeout(() => {
        if (cancelled) return;
        setTransition("returning");
        timer = setTimeout(() => setTransition("none"), st.fade);
      }, st.flash);
    }
    return () => {
      cancelled = true;
      clearTimeout(timer);
      scene.reset();
      setTransition("none");
    };
  }, [idle]);
  const worldVisible = (!idle && transition !== "charging") || transition === "leaving";
  const maxRadius = Math.max(
    RADIUS_MIN,
    Math.min(RADIUS_MAX, info?.worlds.find((w) => w.name === world)?.viewDistance ?? 16),
  );
  const effectiveRadius = Math.min(Number(radius), maxRadius);
  radiusRef.current = effectiveRadius;
  useEffect(() => sceneRef.current?.setRadius(effectiveRadius), [effectiveRadius]);

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
  const running = status.state === "running";
  const phase = PHASES[agentConnected ? "ready" : running ? "connecting" : "stopped"];
  const view: ViewSettings = {
    cameraMode,
    setCameraMode,
    radius: effectiveRadius,
    maxRadius,
    setRadius: (r) => setRadius(String(r)),
    glow,
    setGlow,
    relief,
    setRelief,
    pixelScale,
    setPixelScale,
    leaves,
    setLeaves,
    textures,
    setTextures,
    brightness: Number(brightness),
    setBrightness: (percent: number) => setBrightness(String(percent)),
    debug,
    setDebug,
  };
  // The viewer takes whatever height it is given: the page (the shell stretches this section), the pop-out, fullscreen.
  const viewClass = "min-h-0 flex-1";
  return (
    <div ref={rootRef} className={cn("flex h-full min-h-0 flex-1 flex-col gap-2", fullscreen && "bg-background p-3")}>
      {/* Above the scene only what is about the panel itself: its state and where it is shown. */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex h-8 items-center gap-2 text-sm leading-none">
          <span
            className={cn(
              "inline-block size-2.5 rounded-full",
              agentConnected ? "bg-emerald-500" : running ? "bg-amber-500" : "bg-muted-foreground/40",
            )}
            role="status"
            aria-label={phase.badge}
            title={phase.badge}
          />
          <span>Live view</span>
        </div>
        <div className="flex items-center gap-2">
          <DetachControls
            fullscreen={fullscreen}
            showPopout={showPopout}
            onPopout={openPopout}
            onToggleFullscreen={toggleFullscreen}
            label="live view"
          />
        </div>
      </div>
      <div className={cn("relative overflow-hidden rounded-xl border bg-muted shadow-sm", viewClass)}>
        {/* The world canvas keeps its size while the waiting scene covers it (invisible, not hidden), so
            the chunks that arrive during the hand-over are meshed, uploaded and drawn before it is shown. */}
        <canvas ref={canvasRef} className={cn("block h-full w-full touch-none", !worldVisible && "invisible")} />
        <canvas
          ref={idleCanvasRef}
          className={cn("absolute inset-0 block h-full w-full touch-none", worldVisible && "hidden")}
        />
        {/* Top left: the players; top centre: the camera; top right: the clock and the settings;
            bottom centre: the camera's hint. */}
        {/* A pressed button slides down a pixel (the shared button's active state); the extra pixel
            of padding keeps that inside the list, or a scrollbar would flash while it is held. */}
        <div className="absolute top-2 left-2 flex max-h-[calc(100%-1rem)] flex-col gap-1 overflow-y-auto pb-px">
          {worldPlayers.map((p) => (
            <Button
              key={p.name}
              variant="outline"
              onClick={() => sceneRef.current?.toggleFollow(p.name)}
              className={cn(
                "justify-start gap-2 font-mono",
                OVERLAY,
                following === p.name && "border-primary font-bold",
              )}
              title={`${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}`}
            >
              <PlayerFace name={p.name} className="size-4" />
              {p.name}
            </Button>
          ))}
        </div>
        {worldVisible && (
          <div className="pointer-events-none absolute inset-x-0 top-2 flex items-start justify-center gap-1">
            <Select items={CAMERA_LABELS} value={cameraMode} onValueChange={(v) => v && setCameraMode(v as CameraMode)}>
              <SelectTrigger className={cn("pointer-events-auto", OVERLAY)} aria-label="Camera">
                <CameraIcon mode={cameraMode} className="size-4" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent fit="content">
                {CAMERA_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode} title={cameraDescription(mode)} className="items-start py-1.5">
                    {/* The icon is centred on the name's line, not on the two lines together. */}
                    <span className="flex h-5 items-center">
                      <CameraIcon mode={mode} className="size-4" />
                    </span>
                    <span className="flex flex-col">
                      <span>{CAMERAS[mode].label}</span>
                      <span className="text-xs text-muted-foreground">{CAMERAS[mode].short}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="icon"
              variant="outline"
              className={cn(
                "pointer-events-auto",
                OVERLAY,
                nightVision && "border-primary bg-primary/20 text-primary dark:bg-primary/20",
              )}
              aria-pressed={nightVision}
              onClick={() => setNightVision(!nightVision)}
              title={
                nightVision
                  ? "Night vision on: everything lit as full daylight, like the game's potion · click for the server's light"
                  : "Night vision: everything lit as full daylight, like the game's potion, so caves and nights stay readable"
              }
              aria-label="Night vision"
            >
              {nightVision ? <Flashlight className="fill-current" /> : <FlashlightOff />}
            </Button>
          </div>
        )}
        <div className="absolute top-2 right-2 flex items-center gap-1">
          {clock && worldVisible && <ClockChips clock={clock} />}
          <LiveViewSettings view={view} voice={voice} status={voiceStatus} />
        </div>
        {/* Name tags, the game's look: over each head, or at the nearest edge when the player is out of view. */}
        <div
          ref={tagLayerRef}
          className={cn("pointer-events-none absolute inset-0 z-10 overflow-hidden", !worldVisible && "hidden")}
        >
          {worldPlayers.map((p) => (
            <div
              key={p.name}
              hidden
              className="group absolute top-0 left-0"
              data-voice={p.voice ?? ""}
              ref={(el) => {
                if (el) markerEls.current.set(p.name, el);
                else markerEls.current.delete(p.name);
              }}
            >
              <button
                type="button"
                className="font-minecraft pointer-events-auto bg-black/30 px-1 py-0.5 text-[17px] leading-none whitespace-nowrap text-white group-data-[speaking=true]:bg-emerald-500/50 group-data-[speaking=true]:shadow-[0_0_0_2px_rgb(52_211_153/0.9)]"
                onClick={() => sceneRef.current?.follow(p.name)}
                title="Go to this player"
              >
                {p.name}
                {/* Consent (ADR-019 phase 3): shown only when the server reports it. */}
                <span aria-hidden="true" className="ml-1 hidden text-emerald-300 group-data-[voice=allowed]:inline">
                  ✓
                </span>
                <span aria-hidden="true" className="ml-1 hidden text-red-300 group-data-[voice=denied]:inline">
                  ✕
                </span>
                <span aria-hidden="true" className="ml-1 hidden text-white/50 group-data-[voice=unset]:inline">
                  ?
                </span>
              </button>
            </div>
          ))}
        </div>
        {/* Bottom right: a screenshot, and the debug figures when asked. */}
        {worldVisible && (
          <Button
            size="icon"
            variant="outline"
            className={cn("absolute right-2 bottom-2", OVERLAY, debug && "bottom-12")}
            onClick={() => void screenshot()}
            title="Screenshot (F2): saves the scene as a PNG and copies it"
            aria-label="Screenshot"
          >
            <Camera />
          </Button>
        )}
        {/* Bottom left: voice; bottom right: the debug figures. */}
        <div className="absolute bottom-2 left-2 z-10 flex flex-col items-start gap-1">
          <VoicePresencePill status={voiceStatus} />
          {worldVisible && <VoiceControls status={voiceStatus} voice={voice} />}
        </div>
        {worldVisible && cameraMode !== "orbit" && (
          <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-sm font-medium text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.8),0_0_6px_rgb(0_0_0/0.5)]">
            {cameraHint(cameraMode, following)}
          </p>
        )}
        {debug && worldVisible && (
          <div className="absolute right-2 bottom-2 flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className={cn("pointer-events-auto", OVERLAY)}
              onClick={() => setRebuild((n) => n + 1)}
              title="Drops every chunk the viewer holds, builds a new mesher and fetches the world again from the daemon. The camera returns to the opening shot."
            >
              <RotateCcw data-icon="inline-start" />
              Reload world
            </Button>
            <Chip
              className="tabular-nums"
              title="Chunks in the 3D view out of what the radius allows; the daemon keeps every chunk it has ever seen"
            >
              {stats.chunks} / {(2 * effectiveRadius + 1) ** 2} chunks
              {stats.pending ? ` · ${stats.pending} loading` : ""}
            </Chip>
          </div>
        )}
        {((idle && transition !== "leaving") || transition === "charging") && (
          <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center">
            <div className="rounded-lg border bg-background/80 px-4 py-3 text-center backdrop-blur">
              {transition === "charging" ? (
                <p className="text-sm font-medium">Loading…</p>
              ) : (
                <>
                  <p className="text-sm font-medium">{phase.title}</p>
                  <p className="text-xs text-muted-foreground">{phase.hint}</p>
                </>
              )}
            </div>
          </div>
        )}
        {/* The white-out: fades in over the end of the charge (or flashes in as the last player leaves), then out over what comes next. */}
        <div
          className="pointer-events-none absolute inset-0 z-20 bg-white"
          style={{
            opacity: transition === "charging" || transition === "leaving" ? 1 : 0,
            transition:
              transition === "charging"
                ? `opacity ${steps.current.veil}ms ease-in ${steps.current.charge - steps.current.veil}ms`
                : transition === "leaving"
                  ? `opacity ${steps.current.flash}ms ease-out`
                  : transition === "returning"
                    ? `opacity ${steps.current.fade}ms ease-out`
                    : `opacity ${steps.current.reveal}ms ease-out`,
          }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
