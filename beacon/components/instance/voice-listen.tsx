"use client";

import { Button } from "@warden/ui/components/button";
import { cn } from "@warden/ui/lib/utils";
import { Globe, Hand, HeadphoneOff, Headphones, Mic, MicOff, PhoneOff, Radio, Video } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useInstance } from "@/components/instance/instance-context";
import { Chip, OVERLAY } from "@/components/instance/live-view-chip";
import { useWardendBaseUrl } from "@/components/wardend-config";
import { useStoredFlag, useStoredPreference } from "@/hooks/use-stored-preference";
import type { WsMessage } from "@/hooks/use-wardend-socket";
import { can } from "@/lib/access";
import { ApiError, instances, type VoiceStatus } from "@/lib/api";
import { setUiOutput } from "@/lib/audio-context";
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
export interface VoicePrefs extends VoiceOptions {
  target: Target;
  radius: Radius;
  /** Push-to-talk (hold V or the microphone button) or open mic (the microphone stays on until muted). */
  mic: MicMode;
  /** Draw the emission point and the reach globe in the scene while talking. */
  reach: boolean;
  /** The microphone, as `enumerateDevices` names it; "" is the browser's default. */
  micDevice: string;
}

const RENDERER_KEY = "beacon.voice.renderer";
const ROOM_KEY = "beacon.voice.room";
const ELEVATION_KEY = "beacon.voice.elevation";
const TARGET_KEY = "beacon.voice.target";
const RADIUS_KEY = "beacon.voice.radius";
const MIC_KEY = "beacon.voice.mic";
const REACH_KEY = "beacon.voice.reach";
const MIC_DEVICE_KEY = "beacon.voice.mic-device";
const OUTPUT_KEY = "beacon.voice.output";
/** The stored preferences as one object, changed a field at a time. */
function useVoicePrefs(): readonly [VoicePrefs, (patch: Partial<VoicePrefs>) => void] {
  const [renderer, setRenderer] = useStoredPreference<Renderer>(RENDERER_KEY, "resonance", RENDERERS);
  const [room, setRoom] = useStoredPreference<RoomPreset>(ROOM_KEY, "outdoors", ROOM_PRESETS);
  const [elevation, setElevation] = useStoredFlag(ELEVATION_KEY, true);
  const [target, setTarget] = useStoredPreference<Target>(TARGET_KEY, "auto", TARGETS);
  const [radius, setRadius] = useStoredPreference<Radius>(RADIUS_KEY, "max", RADII);
  const [mic, setMic] = useStoredPreference<MicMode>(MIC_KEY, "ptt", MIC_MODES);
  const [reach, setReach] = useStoredFlag(REACH_KEY, true);
  const [micDevice, setMicDevice] = useStoredPreference<string>(MIC_DEVICE_KEY, "");
  const [output, setOutput] = useStoredPreference<string>(OUTPUT_KEY, "");
  const prefs = useMemo<VoicePrefs>(
    () => ({ renderer, room, elevation, target, radius, mic, reach, micDevice, output }),
    [renderer, room, elevation, target, radius, mic, reach, micDevice, output],
  );
  const set = useCallback(
    (p: Partial<VoicePrefs>) => {
      if (p.renderer !== undefined) setRenderer(p.renderer);
      if (p.room !== undefined) setRoom(p.room);
      if (p.elevation !== undefined) setElevation(p.elevation);
      if (p.target !== undefined) setTarget(p.target);
      if (p.radius !== undefined) setRadius(p.radius);
      if (p.mic !== undefined) setMic(p.mic);
      if (p.reach !== undefined) setReach(p.reach);
      if (p.micDevice !== undefined) setMicDevice(p.micDevice);
      if (p.output !== undefined) setOutput(p.output);
    },
    [setRenderer, setRoom, setElevation, setTarget, setRadius, setMic, setReach, setMicDevice, setOutput],
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
  setPrefs: (patch: Partial<VoicePrefs>) => void;
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
        setPrefs({ renderer: running });
      }
    },
    [setPrefs],
  );
  useEffect(() => {
    prefsRef.current = prefs;
    const receiver = receiverRef.current;
    if (receiver) void receiver.setOptions(prefs).then(() => reflectRenderer(receiver));
  }, [prefs, reflectRenderer]);
  // The cues and the in-game voices come out of the same device.
  const output = prefs.output;
  useEffect(() => setUiOutput(output), [output]);

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
    // A different microphone is a new capture graph: the old one goes, the next block opens the new one.
    if (transmitterRef.current && transmitterRef.current.deviceId !== prefsRef.current.micDevice) {
      transmitterRef.current.stop();
      transmitterRef.current = null;
    }
    if (want.mic && !transmitterRef.current) {
      const tx = new VoiceTransmitter({ onOpus }, prefsRef.current.micDevice);
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
  const micDevice = prefs.micDevice;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the mic mode changes what "transmitting" means and the device which microphone is open; the rest is read from refs
  useEffect(() => {
    queue.current = queue.current.then(reconcile, reconcile);
  }, [desired, micMode, micDevice, reconcile]);

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
 * The voice controls, over the live view's scene, in Discord's shape: "Join voice", then a bar with
 * the microphone (mute, or hold to talk), the headphones (deafen) and leave. Or the hint explaining
 * why there is none: the browser lacks WebCodecs, or Simple Voice Chat is not loaded. The daemon
 * installs that plugin itself on a server that can load it (ADR-019), so a restart is what a fresh
 * server needs; a server whose admin removed it needs the Plugins tab.
 * Nothing for viewers with neither role. The choices behind them live in the live view's settings.
 */
export function VoiceControls({ status, voice }: { status: VoiceStatus | null; voice: Voice }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => setSupported(voiceSupported()), []);
  usePushToTalkKey(voice, voice.canSpeak && status?.available === true);
  if ((!voice.canListen && !voice.canSpeak) || status === null || supported === null) return null;
  if (!supported || !status.available) {
    return (
      <Chip
        className="text-muted-foreground"
        title={
          supported
            ? "Voice needs the Simple Voice Chat plugin. Warden installs it on a server that can load plugins, so restarting is usually enough; otherwise add it from the Plugins tab."
            : undefined
        }
      >
        {supported ? "Restart the server to enable voice" : VOICE_UNSUPPORTED}
      </Chip>
    );
  }
  if (!voice.joined) {
    return (
      <Button
        variant="outline"
        onClick={voice.join}
        className={OVERLAY}
        title={
          voice.canListen
            ? "Hear the players' voice chat and talk to them; they are told you are there"
            : "Talk to the players; they are told you are there"
        }
      >
        <Headphones data-icon="inline-start" />
        Join voice
      </Button>
    );
  }
  const busy = voice.state !== "open";
  return (
    <div className={cn("flex h-8 items-center gap-0.5 rounded-lg border px-1", OVERLAY, busy && "animate-pulse")}>
      {/* The state light sits in a box the size of the icon buttons, so it is spaced like them. */}
      <span
        className="flex size-7 items-center justify-center"
        title={busy ? "Connecting to voice" : "Voice connected"}
        aria-hidden="true"
      >
        <span className={cn("size-2 rounded-full", busy ? "bg-amber-500" : "bg-emerald-500")} />
      </span>
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
      {voice.canSpeak && (
        <>
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
          <VoiceModeToggles voice={voice} />
        </>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={voice.leave}
        title="Leave voice: stop hearing and talking; the players are told you left"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <PhoneOff data-icon="inline-start" />
        Leave
      </Button>
    </div>
  );
}

/**
 * The two choices worth a single click while talking, each a button that flips to the other
 * value: how the microphone opens (push-to-talk or open mic) and who hears (from the camera or
 * everyone). The rest of the voice settings live in the live view's settings dialog.
 */
function VoiceModeToggles({ voice }: { voice: Voice }) {
  const { prefs, setPrefs } = voice;
  const ptt = prefs.mic === "ptt";
  const everyone = prefs.target === "everyone";
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setPrefs({ mic: ptt ? "open" : "ptt" })}
        title={
          ptt
            ? "Push to talk: hold V or the microphone button while you speak · click for open mic"
            : "Open mic: the microphone stays on until you mute · click for push to talk"
        }
      >
        {ptt ? <Hand data-icon="inline-start" /> : <Radio data-icon="inline-start" />}
        {ptt ? "Push to talk" : "Open mic"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setPrefs({ target: everyone ? "auto" : "everyone" })}
        title={
          everyone
            ? "Everyone: the whole server hears you, wherever they are · click to talk from the camera"
            : "Camera: your voice comes from where the camera is (a whisper to the player in first person) · click to talk to everyone"
        }
      >
        {everyone ? <Globe data-icon="inline-start" /> : <Video data-icon="inline-start" />}
        {everyone ? "Everyone" : "Camera"}
      </Button>
    </>
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
    <Chip className={className} title={text}>
      {speakers.length ? <Mic aria-hidden="true" /> : <Headphones aria-hidden="true" />}
      {text}
    </Chip>
  );
}
