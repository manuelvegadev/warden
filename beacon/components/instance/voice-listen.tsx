"use client";

import { Badge } from "@warden/ui/components/badge";
import { Button } from "@warden/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@warden/ui/components/dropdown-menu";
import { cn } from "@warden/ui/lib/utils";
import { Headphones, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useInstance } from "@/components/instance/instance-context";
import { useWardendBaseUrl } from "@/components/wardend-config";
import { useStoredPreference } from "@/hooks/use-stored-preference";
import type { WsMessage } from "@/hooks/use-wardend-socket";
import { can } from "@/lib/access";
import { ApiError, instances, type VoiceStatus } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { type VoiceOptions, VoiceReceiver, type VoiceStage } from "@/lib/voice/receiver";
import { VoiceSocket, type VoiceSocketState, voiceSocketUrl } from "@/lib/voice/socket";
import { RENDERERS, type Renderer, ROOM_PRESETS, type RoomPreset } from "@/lib/voice/spatial";
import { VOICE_UNSUPPORTED, voiceSupported } from "@/lib/voice/support";

/**
 * The instance's voice status (ADR-019): fetched once, then kept current from the hub's
 * `voice.status` messages. `null` until known, or when the daemon has no voice for this instance.
 */
export function useVoiceStatus(id: string): VoiceStatus | null {
  const { subscribe } = useInstance();
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    instances
      .voice(id)
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch((e) => {
        if (cancelled || (e instanceof ApiError && e.status === 404)) return;
        console.warn("voice status:", e);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);
  useEffect(
    () =>
      subscribe((msg: WsMessage) => {
        if (msg.type === "voice.status") setStatus(msg.data as VoiceStatus);
      }),
    [subscribe],
  );
  return status;
}

export interface VoiceListen {
  /** The socket is open (or reconnecting) and the receiver is playing. */
  listening: boolean;
  state: VoiceSocketState;
  /** Starts from a click (the AudioContext needs the gesture) or stops. */
  toggle: () => void;
  /** UUIDs of the players heard in the last moments; empty when not listening. */
  speaking: () => Set<string>;
  /** Every rendered frame of the scene: moves the listener and the speakers. A no-op while not listening. */
  update: (stage: VoiceStage) => void;
  /** The viewer's renderer, room and elevation choices, kept in the browser and applied live. */
  options: VoiceOptions;
  setOptions: (next: VoiceOptions) => void;
}

const RENDERER_KEY = "beacon.voice.renderer";
const ROOM_KEY = "beacon.voice.room";
const ELEVATION_KEY = "beacon.voice.elevation";
const ON_OFF = ["on", "off"] as const;

/** The three stored preferences as one options object. */
function useVoiceOptions(): readonly [VoiceOptions, (next: VoiceOptions) => void] {
  const [renderer, setRenderer] = useStoredPreference<Renderer>(RENDERER_KEY, "resonance", RENDERERS);
  const [room, setRoom] = useStoredPreference<RoomPreset>(ROOM_KEY, "outdoors", ROOM_PRESETS);
  const [elevation, setElevation] = useStoredPreference(ELEVATION_KEY, "on", ON_OFF);
  const options = useMemo<VoiceOptions>(
    () => ({ renderer, room, elevation: elevation === "on" }),
    [renderer, room, elevation],
  );
  const set = useCallback(
    (next: VoiceOptions) => {
      setRenderer(next.renderer);
      setRoom(next.room);
      setElevation(next.elevation ? "on" : "off");
    },
    [setRenderer, setRoom, setElevation],
  );
  return [options, set];
}

/**
 * Owns the voice socket and the receiver for one instance; both go away with the component. The
 * status supplies the server's voice and whisper distances the 3D falloff follows.
 */
export function useVoiceListen(id: string, status: VoiceStatus | null): VoiceListen {
  const baseUrl = useWardendBaseUrl();
  const url = useMemo(() => voiceSocketUrl(baseUrl, id), [baseUrl, id]);
  // "closed" is the only state without a socket, so `listening` is derived rather than kept.
  const [state, setState] = useState<VoiceSocketState>("closed");
  const socketRef = useRef<VoiceSocket | null>(null);
  const receiverRef = useRef<VoiceReceiver | null>(null);
  // The server's distances, kept for a receiver started later; the effect keys on the two numbers,
  // not on the status object, which the hub replaces on every listener change.
  const distancesRef = useRef<{ distance: number; whisper: number } | null>(null);
  const distance = status?.distance;
  const whisper = status?.whisper;
  useEffect(() => {
    if (distance === undefined || whisper === undefined) return;
    distancesRef.current = { distance, whisper };
    receiverRef.current?.setDistances(distance, whisper);
  }, [distance, whisper]);

  const [options, setOptions] = useVoiceOptions();
  const optionsRef = useRef(options);
  // When the requested renderer could not be loaded the receiver runs the browser's; say so and
  // make the stored preference match what plays.
  const reflectRenderer = useCallback(
    (receiver: VoiceReceiver) => {
      const running = receiver.renderer;
      if (running && running !== optionsRef.current.renderer) {
        toast.warning("Resonance Audio could not be loaded; using the browser's spatial audio");
        setOptions({ ...optionsRef.current, renderer: running });
      }
    },
    [setOptions],
  );
  useEffect(() => {
    optionsRef.current = options;
    const receiver = receiverRef.current;
    if (receiver) void receiver.setOptions(options).then(() => reflectRenderer(receiver));
  }, [options, reflectRenderer]);

  const stop = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    receiverRef.current?.stop();
    receiverRef.current = null;
    setState("closed");
  }, []);

  const start = useCallback(async () => {
    const receiver = new VoiceReceiver(optionsRef.current);
    const d = distancesRef.current;
    if (d) receiver.setDistances(d.distance, d.whisper);
    receiverRef.current = receiver;
    // A handle for poking at the audio graph from the console while developing.
    if (process.env.NODE_ENV !== "production") (window as { __beaconVoice?: VoiceReceiver }).__beaconVoice = receiver;
    try {
      await receiver.start();
    } catch (e) {
      receiverRef.current = null;
      toast.error(e instanceof Error ? e.message : "Could not start audio");
      return;
    }
    reflectRenderer(receiver);
    const socket = new VoiceSocket(url, {
      onFrame: (f) => receiverRef.current?.push(f),
      onState: setState,
      onError: (message) => {
        toast.error(message);
        stop();
      },
    });
    socketRef.current = socket;
    socket.connect();
  }, [url, stop, reflectRenderer]);

  const toggle = useCallback(() => {
    if (socketRef.current) stop();
    else void start();
  }, [start, stop]);

  // The instance changed or the view went away: nothing keeps playing.
  useEffect(() => stop, [stop]);

  const speaking = useCallback(() => receiverRef.current?.speaking() ?? new Set<string>(), []);
  const update = useCallback((stage: VoiceStage) => receiverRef.current?.update(stage), []);
  return { listening: state !== "closed", state, toggle, speaking, update, options, setOptions };
}

/**
 * The voice controls for the live view's toolbar: the "Listen" toggle and the spatial-audio menu,
 * or the hint explaining why there are none: the browser lacks WebCodecs, or Simple Voice Chat is
 * not on the server. Nothing for viewers without the listen role.
 */
export function VoiceControls({ status, listen }: { status: VoiceStatus | null; listen: VoiceListen }) {
  const { role } = useInstance();
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => setSupported(voiceSupported()), []);
  if (!can(role, "voice.listen") || status === null || supported === null) return null;
  if (!supported) return <span className="text-xs text-muted-foreground">{VOICE_UNSUPPORTED}</span>;
  if (!status.available) {
    return <span className="text-xs text-muted-foreground">Install Simple Voice Chat to enable voice</span>;
  }
  const busy = listen.listening && listen.state !== "open";
  return (
    <>
      <Button
        size="sm"
        variant={listen.listening ? "secondary" : "outline"}
        onClick={listen.toggle}
        aria-pressed={listen.listening}
        title={
          listen.listening
            ? "Stop listening to the players' voice chat"
            : "Hear the players' voice chat; they are told you are listening"
        }
        className={cn(busy && "animate-pulse")}
      >
        <Headphones data-icon="inline-start" className={cn(listen.listening && "text-emerald-500")} />
        {listen.listening ? "Listening" : "Listen"}
      </Button>
      <VoiceSettingsMenu options={listen.options} onChange={listen.setOptions} />
    </>
  );
}

/** Who else is listening from Beacon right now, for every viewer of the instance; your own session is not news. */
export function VoiceListenersPill({ status, className }: { status: VoiceStatus | null; className?: string }) {
  const me = useSession().data?.user.name;
  const others = status?.listeners.filter((n) => n !== me) ?? [];
  if (others.length === 0) return null;
  const names = others.join(", ");
  return (
    <Badge
      variant="secondary"
      className={cn("gap-1 bg-background/80 backdrop-blur", className)}
      title={`${names} listening`}
    >
      <Headphones className="size-3" aria-hidden="true" />
      {names} listening
    </Badge>
  );
}

const RENDERER_LABELS: Record<Renderer, { label: string; hint: string }> = {
  resonance: { label: "Resonance Audio", hint: "Ambisonic HRTF with a room: reflections and reverb around the voices" },
  browser: { label: "Browser", hint: "The browser's own HRTF panner, no room; the fallback" },
};

const ROOM_LABELS: Record<RoomPreset, string> = {
  outdoors: "Outdoors",
  room: "Room",
  hall: "Hall",
  none: "No room",
};

/** Renderer, room and the elevation cue: the viewer's spatial-audio choices, kept in the browser. */
function VoiceSettingsMenu({ options, onChange }: { options: VoiceOptions; onChange: (next: VoiceOptions) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="icon-sm" variant="ghost" title="Spatial audio settings" aria-label="Spatial audio settings" />
        }
      >
        <SlidersHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuRadioGroup
          value={options.renderer}
          onValueChange={(v) => onChange({ ...options, renderer: v as Renderer })}
        >
          <DropdownMenuLabel>Renderer</DropdownMenuLabel>
          {RENDERERS.map((r) => (
            <DropdownMenuRadioItem key={r} value={r} title={RENDERER_LABELS[r].hint}>
              {RENDERER_LABELS[r].label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={options.room}
          onValueChange={(v) => onChange({ ...options, room: v as RoomPreset })}
        >
          <DropdownMenuLabel>Room</DropdownMenuLabel>
          {ROOM_PRESETS.map((r) => (
            <DropdownMenuRadioItem key={r} value={r} disabled={options.renderer !== "resonance"}>
              {ROOM_LABELS[r]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuCheckboxItem
            checked={options.elevation}
            onCheckedChange={(v) => onChange({ ...options, elevation: v })}
            title="Brightens voices above you and dulls those below; a generic HRTF cannot tell on its own"
          >
            Elevation cue
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
