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
import { HeadphoneOff, Headphones, Mic, MicOff, PhoneOff, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useInstance } from "@/components/instance/instance-context";
import { useWardendBaseUrl } from "@/components/wardend-config";
import { useStoredPreference } from "@/hooks/use-stored-preference";
import type { WsMessage } from "@/hooks/use-wardend-socket";
import { can } from "@/lib/access";
import { ApiError, instances, type VoiceStatus } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { type Aim, aim, RADII, type Radius, type SpeakStage, TARGETS, type Target } from "@/lib/voice/aim";
import { encodeSpeakBody } from "@/lib/voice/frames";
import { type VoiceOptions, VoiceReceiver, type VoiceStage } from "@/lib/voice/receiver";
import { VoiceSocket, type VoiceSocketState, voiceSocketUrl } from "@/lib/voice/socket";
import { RENDERERS, type Renderer, ROOM_PRESETS, type RoomPreset } from "@/lib/voice/spatial";
import { VOICE_UNSUPPORTED, voiceSupported } from "@/lib/voice/support";
import { VoiceTransmitter } from "@/lib/voice/transmitter";
import { playUiCue } from "@/lib/voice/ui-cues";

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

// --- preferences ---

const MIC_MODES = ["ptt", "open"] as const;
type MicMode = (typeof MIC_MODES)[number];

/** The viewer's voice choices, kept in the browser: the receiver's, and where and how the admin's voice goes. */
interface VoicePrefs extends VoiceOptions {
  target: Target;
  radius: Radius;
  /** Push-to-talk (hold V or the microphone button) or open mic (the microphone stays on until muted). */
  mic: MicMode;
  /** Draw the emission point and the reach globe in the scene while talking. */
  reach: boolean;
}

const RENDERER_KEY = "beacon.voice.renderer";
const ROOM_KEY = "beacon.voice.room";
const ELEVATION_KEY = "beacon.voice.elevation";
const TARGET_KEY = "beacon.voice.target";
const RADIUS_KEY = "beacon.voice.radius";
const MIC_KEY = "beacon.voice.mic";
const REACH_KEY = "beacon.voice.reach";
const ON_OFF = ["on", "off"] as const;

/** The stored preferences as one object. */
function useVoicePrefs(): readonly [VoicePrefs, (next: VoicePrefs) => void] {
  const [renderer, setRenderer] = useStoredPreference<Renderer>(RENDERER_KEY, "resonance", RENDERERS);
  const [room, setRoom] = useStoredPreference<RoomPreset>(ROOM_KEY, "outdoors", ROOM_PRESETS);
  const [elevation, setElevation] = useStoredPreference(ELEVATION_KEY, "on", ON_OFF);
  const [target, setTarget] = useStoredPreference<Target>(TARGET_KEY, "auto", TARGETS);
  const [radius, setRadius] = useStoredPreference<Radius>(RADIUS_KEY, "max", RADII);
  const [mic, setMic] = useStoredPreference<MicMode>(MIC_KEY, "ptt", MIC_MODES);
  const [reach, setReach] = useStoredPreference(REACH_KEY, "on", ON_OFF);
  const prefs = useMemo<VoicePrefs>(
    () => ({ renderer, room, elevation: elevation === "on", target, radius, mic, reach: reach === "on" }),
    [renderer, room, elevation, target, radius, mic, reach],
  );
  const set = useCallback(
    (next: VoicePrefs) => {
      setRenderer(next.renderer);
      setRoom(next.room);
      setElevation(next.elevation ? "on" : "off");
      setTarget(next.target);
      setRadius(next.radius);
      setMic(next.mic);
      setReach(next.reach ? "on" : "off");
    },
    [setRenderer, setRoom, setElevation, setTarget, setRadius, setMic, setReach],
  );
  return [prefs, set];
}

// --- the session ---

export interface Voice {
  /** The session is open: the socket is up, the receiver plays unless deafened, the microphone is ready unless muted. */
  joined: boolean;
  state: VoiceSocketState;
  canListen: boolean;
  canSpeak: boolean;
  /** Hearing the players right now. */
  listening: boolean;
  /** The microphone is off by choice; deafening implies it. */
  muted: boolean;
  /** Hearing nobody; the microphone is off with it, as in Discord. */
  deafened: boolean;
  /** Frames are leaving the microphone right now. */
  transmitting: boolean;
  /** Starts from a click (audio needs the gesture) or ends the session. */
  join: () => void;
  leave: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  /** Push-to-talk: the key or the microphone button held. Ignored in open-mic mode. */
  pressTalk: () => void;
  releaseTalk: () => void;
  /** Microphone level 0..1 while transmitting, for the button. */
  level: () => number;
  /** UUIDs of the players heard in the last moments; empty when not listening. */
  speaking: () => Set<string>;
  /** Every rendered frame of the scene: moves the listener and the speakers, aims the admin's voice. */
  update: (stage: VoiceStage & SpeakStage) => void;
  prefs: VoicePrefs;
  setPrefs: (next: VoicePrefs) => void;
}

/** What the session should be doing, from the switches; `reconcile` makes the socket, receiver and microphone match it. */
interface Desired {
  joined: boolean;
  muted: boolean;
  deafened: boolean;
  held: boolean;
}

interface Caps {
  canListen: boolean;
  canSpeak: boolean;
}

/** The switches, the mode and the roles, resolved: what should be listening, open and transmitting. */
function derive(d: Desired, prefs: VoicePrefs, caps: Caps) {
  const listen = d.joined && caps.canListen && !d.deafened;
  const mic = d.joined && caps.canSpeak && !d.deafened;
  const transmitting = mic && !d.muted && (prefs.mic === "open" || d.held);
  return { listen, mic, transmitting };
}

/**
 * One voice session per instance, with Discord's switches: join, mute (the microphone off, still
 * hearing), deafen (hearing nobody, which mutes too), leave. Listening and speaking share one
 * socket; the receiver plays while listening; the microphone opens on join and transmits while
 * unmuted in open-mic mode or while push-to-talk is held. Everything goes away with the component.
 * The status supplies the server's voice and whisper distances the 3D falloff and the reach follow.
 */
export function useVoice(id: string, status: VoiceStatus | null): Voice {
  const { role } = useInstance();
  const canListen = can(role, "voice.listen");
  const canSpeak = can(role, "voice.speak");
  const baseUrl = useWardendBaseUrl();
  const url = useMemo(() => voiceSocketUrl(baseUrl, id), [baseUrl, id]);
  const [state, setState] = useState<VoiceSocketState>("closed");
  const [desired, setDesired] = useState<Desired>({ joined: false, muted: false, deafened: false, held: false });
  const socketRef = useRef<VoiceSocket | null>(null);
  const receiverRef = useRef<VoiceReceiver | null>(null);
  const transmitterRef = useRef<VoiceTransmitter | null>(null);
  /** What the next speak packet says, refreshed every rendered frame while talking. */
  const target = useRef<Aim | null>(null);
  const point = useRef(new Float32Array(3));

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

  const [prefs, setPrefs] = useVoicePrefs();
  const prefsRef = useRef(prefs);
  // When the requested renderer could not be loaded the receiver runs the browser's; say so and
  // make the stored preference match what plays.
  const reflectRenderer = useCallback(
    (receiver: VoiceReceiver) => {
      const running = receiver.renderer;
      if (running && running !== prefsRef.current.renderer) {
        toast.warning("Resonance Audio could not be loaded; using the browser's spatial audio");
        setPrefs({ ...prefsRef.current, renderer: running });
      }
    },
    [setPrefs],
  );
  useEffect(() => {
    prefsRef.current = prefs;
    const receiver = receiverRef.current;
    if (receiver) void receiver.setOptions(prefs).then(() => reflectRenderer(receiver));
  }, [prefs, reflectRenderer]);

  /** One encoded packet from the microphone: wrapped in the current aim and sent. */
  const onOpus = useCallback((opus: Uint8Array, seq: number) => {
    const a = target.current;
    if (a) socketRef.current?.sendBody(encodeSpeakBody({ ...a.head, seq, opus }));
  }, []);

  // The switches are state; what runs is made to match them here, one reconcile at a time (the
  // receiver and the microphone open asynchronously, and a switch may flip meanwhile).
  const desiredRef = useRef(desired);
  desiredRef.current = desired;
  const queue = useRef(Promise.resolve());
  const reconcile = useCallback(async () => {
    const caps = { canListen, canSpeak };
    const d = desiredRef.current;
    const want = derive(d, prefsRef.current, caps);
    // The socket.
    if (d.joined && !socketRef.current) {
      const socket = new VoiceSocket(
        url,
        { listen: want.listen, speak: canSpeak },
        {
          onFrame: (f) => receiverRef.current?.push(f),
          onState: setState,
          onError: (message) => {
            toast.error(message);
            setDesired((x) => ({ ...x, joined: false }));
          },
        },
      );
      socketRef.current = socket;
      socket.connect();
      if (process.env.NODE_ENV !== "production")
        (window as { __beaconVoiceSocket?: VoiceSocket }).__beaconVoiceSocket = socket;
    }
    // The receiver and the microphone open side by side: the microphone on join, so the first word
    // is not lost to the permission prompt.
    const starts: Promise<void>[] = [];
    if (want.listen && !receiverRef.current) {
      const receiver = new VoiceReceiver(prefsRef.current);
      const dist = distancesRef.current;
      if (dist) receiver.setDistances(dist.distance, dist.whisper);
      receiverRef.current = receiver;
      // A handle for poking at the audio graph from the console while developing.
      if (process.env.NODE_ENV !== "production") (window as { __beaconVoice?: VoiceReceiver }).__beaconVoice = receiver;
      starts.push(
        receiver.start().then(
          () => reflectRenderer(receiver),
          (e) => {
            receiverRef.current = null;
            toast.error(e instanceof Error ? e.message : "Could not start audio");
            setDesired((x) => ({ ...x, deafened: true, muted: true }));
          },
        ),
      );
    } else if (!want.listen && receiverRef.current) {
      receiverRef.current.stop();
      receiverRef.current = null;
    }
    if (want.mic && !transmitterRef.current) {
      const tx = new VoiceTransmitter({ onOpus });
      transmitterRef.current = tx;
      if (process.env.NODE_ENV !== "production")
        (window as { __beaconVoiceTx?: VoiceTransmitter }).__beaconVoiceTx = tx;
      starts.push(
        tx.start().catch((e) => {
          transmitterRef.current = null;
          toast.error(
            e instanceof Error && e.name === "NotAllowedError"
              ? "Microphone access was refused; you can listen but not talk"
              : "Could not open the microphone",
          );
          setDesired((x) => ({ ...x, muted: true }));
        }),
      );
    } else if (!want.mic && transmitterRef.current) {
      transmitterRef.current.stop();
      transmitterRef.current = null;
    }
    await Promise.allSettled(starts);
    // Where things stand now, after the awaits, applied to the devices that did open.
    const now = derive(desiredRef.current, prefsRef.current, caps);
    const listen = now.listen && receiverRef.current !== null;
    const tx = now.transmitting && transmitterRef.current !== null;
    socketRef.current?.setListening(listen);
    socketRef.current?.setSpeaking(tx);
    transmitterRef.current?.setTransmitting(tx);
    if (!desiredRef.current.joined && socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
  }, [url, canListen, canSpeak, onOpus, reflectRenderer]);
  const micMode = prefs.mic;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the mic mode changes what "transmitting" means; the rest is read from refs
  useEffect(() => {
    queue.current = queue.current.then(reconcile, reconcile);
  }, [desired, micMode, reconcile]);

  // The switches, each answered by its sound; they run from the click, so audio may start.
  const join = useCallback(() => {
    playUiCue("join");
    setDesired((x) => ({ ...x, joined: true }));
  }, []);
  const leave = useCallback(() => {
    playUiCue("leave");
    setDesired((x) => ({ ...x, joined: false, held: false }));
  }, []);
  const toggleMute = useCallback(() => {
    if (desiredRef.current.deafened) return;
    playUiCue("mute");
    setDesired((x) => ({ ...x, muted: !x.muted, held: false }));
  }, []);
  const toggleDeafen = useCallback(() => {
    playUiCue(desiredRef.current.deafened ? "mute" : "deafen");
    setDesired((x) =>
      x.deafened ? { ...x, deafened: false, muted: false } : { ...x, deafened: true, muted: true, held: false },
    );
  }, []);
  const pressTalk = useCallback(
    () => setDesired((x) => (x.held || prefsRef.current.mic !== "ptt" ? x : { ...x, held: true })),
    [],
  );
  const releaseTalk = useCallback(() => setDesired((x) => (x.held ? { ...x, held: false } : x)), []);

  // The instance changed or the view went away: nothing keeps playing or transmitting.
  useEffect(
    () => () => {
      transmitterRef.current?.stop();
      transmitterRef.current = null;
      receiverRef.current?.stop();
      receiverRef.current = null;
      socketRef.current?.close();
      socketRef.current = null;
    },
    [],
  );

  const speaking = useCallback(() => receiverRef.current?.speaking() ?? new Set<string>(), []);
  const level = useCallback(() => transmitterRef.current?.level() ?? 0, []);

  const update = useCallback((stage: VoiceStage & SpeakStage) => {
    receiverRef.current?.update(stage);
    const tx = transmitterRef.current;
    if (!tx?.isTransmitting) {
      target.current = null;
      stage.clearEmitter();
      return;
    }
    const a = aim(stage, prefsRef.current, distancesRef.current?.distance ?? 48, point.current);
    target.current = a;
    const m = prefsRef.current.reach ? a?.marker : null;
    if (m) stage.setEmitter(m.x, m.y, m.z, m.radius, tx.level());
    else stage.clearEmitter();
  }, []);

  const now = derive(desired, prefs, { canListen, canSpeak });
  return {
    joined: desired.joined,
    state,
    canListen,
    canSpeak,
    listening: now.listen,
    muted: desired.muted,
    deafened: desired.deafened,
    transmitting: now.transmitting,
    join,
    leave,
    toggleMute,
    toggleDeafen,
    pressTalk,
    releaseTalk,
    level,
    speaking,
    update,
    prefs,
    setPrefs,
  };
}

// --- the toolbar ---

/** Hold V to talk, anywhere on the page but not while typing; released when the window loses focus. */
function usePushToTalkKey(voice: Voice, enabled: boolean) {
  const { pressTalk, releaseTalk } = voice;
  useEffect(() => {
    if (!enabled) return;
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "v" || e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      e.preventDefault();
      pressTalk();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "v") releaseTalk();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", releaseTalk);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", releaseTalk);
    };
  }, [enabled, pressTalk, releaseTalk]);
}

/**
 * The voice controls for the live view's toolbar, in Discord's shape: "Join voice", then a bar with
 * the microphone (mute, or hold to talk), the headphones (deafen), the settings and leave. Or the
 * hint explaining why there is none: the browser lacks WebCodecs, or Simple Voice Chat is not on
 * the server. Nothing for viewers with neither role.
 */
export function VoiceControls({ status, voice }: { status: VoiceStatus | null; voice: Voice }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => setSupported(voiceSupported()), []);
  usePushToTalkKey(voice, voice.canSpeak && status?.available === true);
  if ((!voice.canListen && !voice.canSpeak) || status === null || supported === null) return null;
  if (!supported) return <span className="text-xs text-muted-foreground">{VOICE_UNSUPPORTED}</span>;
  if (!status.available) {
    return <span className="text-xs text-muted-foreground">Install Simple Voice Chat to enable voice</span>;
  }
  if (!voice.joined) {
    return (
      <>
        <Button
          size="sm"
          variant="secondary"
          onClick={voice.join}
          title={
            voice.canListen
              ? "Hear the players' voice chat and talk to them; they are told you are there"
              : "Talk to the players; they are told you are there"
          }
        >
          <Headphones data-icon="inline-start" />
          Join voice
        </Button>
        <VoiceSettingsMenu voice={voice} status={status} />
      </>
    );
  }
  const busy = voice.state !== "open";
  return (
    <div className={cn("flex h-8 items-center gap-0.5 rounded-lg border bg-muted/40 px-1", busy && "animate-pulse")}>
      <span
        className={cn("mx-1 inline-block size-2 rounded-full", busy ? "bg-amber-500" : "bg-emerald-500")}
        title={busy ? "Connecting to voice" : "Voice connected"}
        aria-hidden="true"
      />
      {voice.canSpeak && <MicButton voice={voice} />}
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={voice.toggleDeafen}
        disabled={!voice.canListen}
        aria-pressed={voice.deafened}
        title={
          !voice.canListen
            ? "Listening needs the manager role"
            : voice.deafened
              ? "Undeafen: hear the players again"
              : "Deafen: hear nobody (mutes you too)"
        }
        className={cn(
          voice.deafened && "bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive",
        )}
      >
        {voice.deafened ? <HeadphoneOff /> : <Headphones />}
      </Button>
      <VoiceSettingsMenu voice={voice} status={status} />
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={voice.leave}
        title="Leave voice"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <PhoneOff />
      </Button>
    </div>
  );
}

/** A press shorter than this is a tap: the mute toggle rather than a word. */
const TAP_MS = 250;

/**
 * The microphone: a click mutes or unmutes; in push-to-talk mode holding it (or V) talks. A green
 * ring and a level bar show the voice leaving.
 */
function MicButton({ voice }: { voice: Voice }) {
  const meter = useRef<HTMLSpanElement>(null);
  const ptt = voice.prefs.mic === "ptt";
  useEffect(() => {
    if (!voice.transmitting) return;
    const timer = setInterval(() => {
      const el = meter.current;
      if (el) el.style.height = `${Math.min(100, Math.round(voice.level() * 300))}%`;
    }, 80);
    return () => {
      clearInterval(timer);
      if (meter.current) meter.current.style.height = "0%";
    };
  }, [voice.transmitting, voice.level]);
  /** When the current hold began; 0 while nothing is held. */
  const downAt = useRef(0);
  const release = (tap: boolean) => {
    if (!downAt.current) return;
    const quick = tap && performance.now() - downAt.current < TAP_MS;
    downAt.current = 0;
    voice.releaseTalk();
    if (quick) voice.toggleMute();
  };
  const off = voice.muted || voice.deafened;
  const title = voice.deafened
    ? "Deafened: undeafen to talk"
    : voice.muted
      ? "Unmute"
      : ptt
        ? "Hold to talk (or hold V); click to mute"
        : "Mute";
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      disabled={voice.deafened}
      aria-pressed={off}
      title={title}
      className={cn(
        "relative select-none overflow-hidden",
        off && "bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive",
        voice.transmitting && "ring-2 ring-emerald-500",
      )}
      onPointerDown={(e) => {
        if (!ptt || off) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        downAt.current = performance.now();
        voice.pressTalk();
      }}
      onPointerUp={() => release(true)}
      onPointerCancel={() => release(false)}
      onLostPointerCapture={() => release(false)}
      onClick={() => {
        if (!ptt || off) voice.toggleMute();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span
        ref={meter}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 bg-emerald-500/25 transition-[height] duration-75"
        style={{ height: "0%" }}
      />
      {off ? <MicOff className="relative" /> : <Mic className="relative" />}
    </Button>
  );
}

/** Who else is listening or speaking from Beacon right now, for every viewer; your own session is not news. */
export function VoicePresencePill({ status, className }: { status: VoiceStatus | null; className?: string }) {
  const me = useSession().data?.user.name;
  const listeners = status?.listeners.filter((n) => n !== me) ?? [];
  const speakers = status?.speaking.filter((n) => n !== me) ?? [];
  if (listeners.length === 0 && speakers.length === 0) return null;
  const parts: string[] = [];
  if (listeners.length) parts.push(`${listeners.join(", ")} listening`);
  if (speakers.length) parts.push(`${speakers.join(", ")} speaking`);
  const text = parts.join(" · ");
  return (
    <Badge variant="secondary" className={cn("gap-1 bg-background/80 backdrop-blur", className)} title={text}>
      {speakers.length ? (
        <Mic className="size-3" aria-hidden="true" />
      ) : (
        <Headphones className="size-3" aria-hidden="true" />
      )}
      {text}
    </Badge>
  );
}

// --- the menu ---

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

const TARGET_LABELS: Record<Target, { label: string; hint: string }> = {
  auto: {
    label: "Follows the camera",
    hint: "Fly and orbit: your voice comes from where the camera is · Player: a whisper only they hear",
  },
  everyone: { label: "Everyone", hint: "The whole server hears you, wherever they are" },
};

const MIC_LABELS: Record<MicMode, { label: string; hint: string }> = {
  ptt: { label: "Push to talk", hint: "Hold V or the microphone button while you speak" },
  open: { label: "Open mic", hint: "The microphone stays on until you mute" },
};

/** The viewer's own choices, kept in the browser: microphone, where the voice goes, renderer, room, cues. */
function VoiceSettingsMenu({ voice, status }: { voice: Voice; status: VoiceStatus }) {
  const { prefs, setPrefs } = voice;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button size="icon-sm" variant="ghost" title="Voice settings" aria-label="Voice settings" />}
      >
        <SlidersHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {voice.canSpeak && (
          <>
            <DropdownMenuRadioGroup value={prefs.mic} onValueChange={(v) => setPrefs({ ...prefs, mic: v as MicMode })}>
              <DropdownMenuLabel>Microphone</DropdownMenuLabel>
              {MIC_MODES.map((m) => (
                <DropdownMenuRadioItem key={m} value={m} title={MIC_LABELS[m].hint}>
                  {MIC_LABELS[m].label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={prefs.target}
              onValueChange={(v) => setPrefs({ ...prefs, target: v as Target })}
            >
              <DropdownMenuLabel>Talk to</DropdownMenuLabel>
              {TARGETS.map((t) => (
                <DropdownMenuRadioItem key={t} value={t} title={TARGET_LABELS[t].hint}>
                  {TARGET_LABELS[t].label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={prefs.radius}
              onValueChange={(v) => setPrefs({ ...prefs, radius: v as Radius })}
            >
              <DropdownMenuLabel>Reach</DropdownMenuLabel>
              {RADII.map((r) => (
                <DropdownMenuRadioItem key={r} value={r} disabled={prefs.target === "everyone"}>
                  {r === "max" ? `Server distance (${status.distance} blocks)` : `${r} blocks`}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuGroup>
              <DropdownMenuCheckboxItem
                checked={prefs.reach}
                onCheckedChange={(v) => setPrefs({ ...prefs, reach: v })}
                title="A globe of the reach around where your voice leaves, drawn while sound is going out"
              >
                Show reach while talking
              </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
          </>
        )}
        {voice.canSpeak && voice.canListen && <DropdownMenuSeparator />}
        {voice.canListen && (
          <>
            <DropdownMenuRadioGroup
              value={prefs.renderer}
              onValueChange={(v) => setPrefs({ ...prefs, renderer: v as Renderer })}
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
              value={prefs.room}
              onValueChange={(v) => setPrefs({ ...prefs, room: v as RoomPreset })}
            >
              <DropdownMenuLabel>Room</DropdownMenuLabel>
              {ROOM_PRESETS.map((r) => (
                <DropdownMenuRadioItem key={r} value={r} disabled={prefs.renderer !== "resonance"}>
                  {ROOM_LABELS[r]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuCheckboxItem
                checked={prefs.elevation}
                onCheckedChange={(v) => setPrefs({ ...prefs, elevation: v })}
                title="Brightens voices above you and dulls those below; a generic HRTF cannot tell on its own"
              >
                Elevation cue
              </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
