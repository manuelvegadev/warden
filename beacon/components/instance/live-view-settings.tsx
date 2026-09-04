"use client";

import { Button } from "@warden/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@warden/ui/components/dialog";
import { Label } from "@warden/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@warden/ui/components/select";
import { Slider } from "@warden/ui/components/slider";
import { Switch } from "@warden/ui/components/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@warden/ui/components/tabs";
import { cn } from "@warden/ui/lib/utils";
import { AudioLines, Camera, Monitor, Settings } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { CAMERA_LABELS, CAMERA_MODES, CAMERAS, cameraDescription } from "@/components/instance/live-view-cameras";
import { OVERLAY } from "@/components/instance/live-view-chip";
import type { Voice } from "@/components/instance/voice-listen";
import type { VoiceStatus } from "@/lib/api";
import { canChooseOutput } from "@/lib/audio-context";
import type { CameraMode } from "@/lib/liveview/camera-modes";
import { RADIUS_MIN } from "@/lib/liveview/constants";
import type { LeavesMode } from "@/lib/liveview/mesher";
import { RADII, type Radius } from "@/lib/voice/aim";
import { RENDERERS, type Renderer, ROOM_PRESETS, type RoomPreset } from "@/lib/voice/spatial";

/**
 * The quality presets, low to high: what each sets. Potato is the viewer as it began (flat colours,
 * one pixel per CSS pixel); good adds the textures with solid leaves; fancy adds see-through leaves
 * and the screen's own pixel density. Every knob stays adjustable on its own below the slider.
 */
const QUALITY = [
  {
    name: "Potato",
    hint: "Flat colours, no textures, one pixel per CSS pixel",
    textures: false,
    leaves: "fast",
    pixelScale: "1",
  },
  {
    name: "Good",
    hint: "Textures, solid canopies, one pixel per CSS pixel",
    textures: true,
    leaves: "fast",
    pixelScale: "1",
  },
  {
    name: "Fancy",
    hint: "Textures, see-through leaves with depth, the screen's pixel density",
    textures: true,
    leaves: "fancy",
    pixelScale: "device",
  },
] as const satisfies readonly {
  name: string;
  hint: string;
  textures: boolean;
  leaves: LeavesMode;
  pixelScale: PixelScale;
}[];

/** The preset the settings match, or -1 when they are a mix. */
const qualityOf = (view: ViewSettings) =>
  QUALITY.findIndex(
    (q) => q.textures === view.textures && q.leaves === view.leaves && q.pixelScale === view.pixelScale,
  );

export const LEAVES_MODES = ["fancy", "fast"] as const satisfies readonly LeavesMode[];
const LEAVES_LABELS: Record<LeavesMode, string> = {
  fancy: "Fancy (see-through, like the game)",
  fast: "Fast (solid canopies)",
};
export const PIXEL_SCALES = ["1", "device", "0.5"] as const;
export type PixelScale = (typeof PIXEL_SCALES)[number];
const PIXEL_SCALE_LABELS: Record<PixelScale, string> = {
  "1": "1× (one pixel per CSS pixel)",
  device: "Device (Retina-sharp)",
  "0.5": "0.5× (faster)",
};

/** What the live view lets the viewer choose, other than voice: the camera and how the world is drawn. */
/** The default of the brightness option, in percent: the game's is 50; the panel reads best a touch lower. */
export const BRIGHTNESS_DEFAULT = 45;

export interface ViewSettings {
  cameraMode: CameraMode;
  setCameraMode: (mode: CameraMode) => void;
  /** Chunks around the focus, and the most the server's view distance allows. */
  radius: number;
  maxRadius: number;
  setRadius: (radius: number) => void;
  glow: boolean;
  setGlow: (on: boolean) => void;
  /** The map camera's relief shading: a vanilla map's three shades by whether the ground to the north is higher, level or lower. */
  relief: boolean;
  setRelief: (on: boolean) => void;
  /** Device pixels per CSS pixel: "1" (the default), "device" (the screen's own, Retina-sharp) or "0.5" for a slow machine. */
  pixelScale: PixelScale;
  setPixelScale: (scale: PixelScale) => void;
  /** The game's graphics setting for leaves: solid canopies, or cut-outs with the leaves behind showing. */
  leaves: LeavesMode;
  setLeaves: (mode: LeavesMode) => void;
  /** The block textures, or the flat colours the viewer started with. */
  textures: boolean;
  setTextures: (on: boolean) => void;
  /** The game's brightness option in percent, 0 (moody) to 100 (bright): how much the dark is lifted. */
  brightness: number;
  setBrightness: (percent: number) => void;
  debug: boolean;
  setDebug: (on: boolean) => void;
}

/**
 * The live view's settings, behind the gear in its corner: one dialog with a tab for the camera,
 * one for audio (the devices, the reach and how the players' voices are rendered; the microphone's
 * mode and the target sit on the voice bar itself) and one for video (how much of the world is
 * drawn and how). Every choice is kept in the browser and applies at once.
 */
export function LiveViewSettings({
  view,
  voice,
  status,
}: {
  view: ViewSettings;
  voice: Voice;
  status: VoiceStatus | null;
}) {
  const hasVoice = (voice.canListen || voice.canSpeak) && status !== null;
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            size="icon"
            variant="outline"
            className={OVERLAY}
            title="Live view settings"
            aria-label="Live view settings"
          />
        }
      >
        <Settings />
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Live view settings</DialogTitle>
          <DialogDescription>Kept in this browser; they apply as you change them.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="camera" className="gap-3">
          <TabsList variant="line" className="w-full justify-start border-b">
            <TabsTrigger value="camera" className="flex-none">
              <Camera data-icon="inline-start" />
              Camera
            </TabsTrigger>
            <TabsTrigger value="audio" className="flex-none" disabled={!hasVoice}>
              <AudioLines data-icon="inline-start" />
              Audio
            </TabsTrigger>
            <TabsTrigger value="video" className="flex-none">
              <Monitor data-icon="inline-start" />
              Video
            </TabsTrigger>
          </TabsList>
          <TabsContent value="camera" className="min-h-64">
            <CameraSettings view={view} />
          </TabsContent>
          <TabsContent value="audio" className="min-h-64">
            {hasVoice && status && <AudioSettings voice={voice} status={status} />}
          </TabsContent>
          <TabsContent value="video" className="min-h-64">
            <VideoSettings view={view} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// --- the rows ---

/** One setting: its name and what it does on the left, the control on the right (a select fills the slot, a switch keeps to its end). */
function Row({ id, label, hint, children }: { id?: string; label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <Label htmlFor={id}>{label}</Label>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex w-52 shrink-0 justify-end">{children}</div>
    </div>
  );
}

/** A select over a fixed list of choices, labelled by a table. */
function Choice<T extends string>({
  id,
  value,
  options,
  labels,
  onChange,
  disabled,
}: {
  id?: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <Select items={labels} value={value} onValueChange={(v) => v && onChange(v as T)} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {labels[o]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// --- camera ---

function CameraSettings({ view }: { view: ViewSettings }) {
  const id = useId();
  return (
    <div className="divide-y">
      <Row id={id} label="Camera">
        <Choice
          id={id}
          value={view.cameraMode}
          options={CAMERA_MODES}
          labels={CAMERA_LABELS}
          onChange={view.setCameraMode}
        />
      </Row>
      <div className="py-3">
        <p className="text-sm font-medium">Controls</p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
          {CAMERA_MODES.map((m) => {
            const Icon = CAMERAS[m].icon;
            return (
              <div key={m} className="contents">
                <dt className="flex items-center gap-1.5 font-medium">
                  <Icon className="size-3.5" aria-hidden="true" />
                  {CAMERAS[m].label}
                </dt>
                <dd className="text-muted-foreground">{cameraDescription(m)}</dd>
              </div>
            );
          })}
        </dl>
      </div>
    </div>
  );
}

// --- video ---

function VideoSettings({ view }: { view: ViewSettings }) {
  const id = useId();
  const quality = qualityOf(view);
  const applyQuality = (level: number) => {
    const q = QUALITY[level];
    if (!q) return;
    view.setTextures(q.textures);
    view.setLeaves(q.leaves);
    view.setPixelScale(q.pixelScale);
  };
  return (
    <div className="divide-y">
      <div className="py-3">
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor={`${id}-quality`}>Quality</Label>
          <span className="text-xs text-muted-foreground">{quality < 0 ? "Custom" : QUALITY[quality].hint}</span>
        </div>
        <Slider
          id={`${id}-quality`}
          className="mt-3"
          min={0}
          max={QUALITY.length - 1}
          step={1}
          value={quality < 0 ? 1 : quality}
          onValueChange={(v) => applyQuality(Array.isArray(v) ? v[0] : v)}
          aria-label="Quality"
        />
        <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
          {QUALITY.map((q, i) => (
            <button
              key={q.name}
              type="button"
              className={cn("hover:text-foreground", i === quality && "font-medium text-foreground")}
              onClick={() => applyQuality(i)}
            >
              {q.name}
            </button>
          ))}
        </div>
      </div>
      <Row
        id={`${id}-textures`}
        label="Block textures"
        hint="The game's textures on every block; off, the flat average colour of each, as the viewer began."
      >
        <Switch id={`${id}-textures`} checked={view.textures} onCheckedChange={view.setTextures} />
      </Row>
      <Row
        id={`${id}-radius`}
        label="Render distance"
        hint={`Chunks around the focus, up to the server's view distance (${view.maxRadius}).`}
      >
        <div className="flex w-full items-center gap-3">
          <Slider
            id={`${id}-radius`}
            min={RADIUS_MIN}
            max={view.maxRadius}
            step={1}
            value={view.radius}
            onValueChange={(v) => view.setRadius(Array.isArray(v) ? v[0] : v)}
            aria-label="Render distance"
          />
          <span className="w-5 text-right text-sm tabular-nums">{view.radius}</span>
        </div>
      </Row>
      <Row
        id={`${id}-glow`}
        label="Outline the players"
        hint="Like the game's Glowing effect: they show from afar and through the terrain, in Orbit, Fly and Isometric."
      >
        <Switch id={`${id}-glow`} checked={view.glow} onCheckedChange={view.setGlow} />
      </Row>
      <Row
        id={`${id}-relief`}
        label="Map relief"
        hint="On the Map camera, shade the ground as a vanilla map does: brighter where it rises to the north, darker where it falls. Off, the map shows the block colours flat."
      >
        <Switch id={`${id}-relief`} checked={view.relief} onCheckedChange={view.setRelief} />
      </Row>
      <Row
        id={`${id}-leaves`}
        label="Leaves"
        hint="Fancy keeps the holes in the leaf textures and draws the leaves behind them, as the game does by default; fast fills them and draws only the outside of a canopy, fewer faces."
      >
        <Choice
          id={`${id}-leaves`}
          value={view.leaves}
          options={LEAVES_MODES}
          labels={LEAVES_LABELS}
          onChange={view.setLeaves}
        />
      </Row>
      <Row
        id={`${id}-pixels`}
        label="Pixel scale"
        hint="How many device pixels the scene renders per CSS pixel: sharper on a Retina screen at the device's scale, lighter at 0.5×."
      >
        <Choice
          id={`${id}-pixels`}
          value={view.pixelScale}
          options={PIXEL_SCALES}
          labels={PIXEL_SCALE_LABELS}
          onChange={view.setPixelScale}
        />
      </Row>
      <Row
        id={`${id}-brightness`}
        label="Brightness"
        hint={`The game's brightness option: how much the dark is lifted, from moody to bright. ${BRIGHTNESS_DEFAULT} % is the default here, 50 % the game's.`}
      >
        <div className="flex w-full items-center gap-3">
          <Slider
            id={`${id}-brightness`}
            min={0}
            max={100}
            step={5}
            value={view.brightness}
            onValueChange={(v) => view.setBrightness(Array.isArray(v) ? v[0] : v)}
            aria-label="Brightness"
          />
          <span className="w-9 text-right text-sm tabular-nums">{view.brightness}%</span>
        </div>
      </Row>
      <Row id={`${id}-debug`} label="Debug overlay" hint="The camera's pivot in the scene and the chunk count.">
        <Switch id={`${id}-debug`} checked={view.debug} onCheckedChange={view.setDebug} />
      </Row>
    </div>
  );
}

// --- audio ---

const RENDERER_LABELS: Record<Renderer, string> = { resonance: "Resonance Audio", browser: "Browser" };
const ROOM_LABELS: Record<RoomPreset, string> = { outdoors: "Outdoors", room: "Room", hall: "Hall", none: "No room" };

/**
 * The audio devices, refreshed as they are plugged and unplugged. Their names are blank until the
 * microphone has been allowed once; then they are numbered.
 */
function useMediaDevices(): MediaDeviceInfo[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.enumerateDevices) return;
    let cancelled = false;
    const refresh = () => {
      media
        .enumerateDevices()
        .then((all) => {
          if (!cancelled) setDevices(all.filter((d) => d.deviceId !== "default"));
        })
        .catch(() => {});
    };
    refresh();
    media.addEventListener("devicechange", refresh);
    return () => {
      cancelled = true;
      media.removeEventListener("devicechange", refresh);
    };
  }, []);
  return devices;
}

/** A device of one kind, or "" for the browser's default. */
function DeviceSelect({
  id,
  kind,
  devices,
  value,
  onChange,
  disabled,
}: {
  id: string;
  kind: MediaDeviceKind;
  devices: MediaDeviceInfo[];
  value: string;
  onChange: (deviceId: string) => void;
  disabled?: boolean;
}) {
  const noun = kind === "audioinput" ? "Microphone" : "Output";
  const labels: Record<string, string> = { "": "System default" };
  devices
    .filter((d) => d.kind === kind)
    .forEach((d, i) => {
      labels[d.deviceId] = d.label || `${noun} ${i + 1}`;
    });
  // A remembered device that is not plugged in right now still shows, so the choice is not lost.
  if (value && !(value in labels)) labels[value] = `${noun} (not connected)`;
  return (
    <Select items={labels} value={value} onValueChange={(v) => onChange(v ?? "")} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent fit="content" className="max-w-96">
        {Object.entries(labels).map(([v, label]) => (
          <SelectItem key={v} value={v}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AudioSettings({ voice, status }: { voice: Voice; status: VoiceStatus }) {
  const id = useId();
  const { prefs, setPrefs } = voice;
  const outputs = canChooseOutput();
  const devices = useMediaDevices();
  const reachLabels = Object.fromEntries(
    RADII.map((r) => [r, r === "max" ? `Server distance (${status.distance} blocks)` : `${r} blocks`]),
  ) as Record<Radius, string>;
  return (
    <div className="divide-y">
      {voice.canSpeak && (
        <Row id={`${id}-mic-device`} label="Microphone" hint="Names appear once the microphone has been allowed.">
          <DeviceSelect
            id={`${id}-mic-device`}
            kind="audioinput"
            devices={devices}
            value={prefs.micDevice}
            onChange={(micDevice) => setPrefs({ micDevice })}
          />
        </Row>
      )}
      <Row
        id={`${id}-output`}
        label="Output"
        hint={
          outputs
            ? "Where the players' voices and the cues play."
            : "This browser plays through the system's output; choose it there."
        }
      >
        <DeviceSelect
          id={`${id}-output`}
          kind="audiooutput"
          devices={devices}
          value={prefs.output}
          onChange={(output) => setPrefs({ output })}
          disabled={!outputs}
        />
      </Row>
      {voice.canSpeak && (
        <>
          <Row
            id={`${id}-reach`}
            label="Reach"
            hint="How far your voice carries from where it leaves; not while talking to everyone."
          >
            <Choice
              id={`${id}-reach`}
              value={prefs.radius}
              options={RADII}
              labels={reachLabels}
              onChange={(radius) => setPrefs({ radius })}
              disabled={prefs.target === "everyone"}
            />
          </Row>
          <Row
            id={`${id}-globe`}
            label="Show reach while talking"
            hint="A globe of the reach around where your voice leaves, drawn while sound is going out."
          >
            <Switch id={`${id}-globe`} checked={prefs.reach} onCheckedChange={(reach) => setPrefs({ reach })} />
          </Row>
        </>
      )}
      {voice.canListen && (
        <>
          <Row
            id={`${id}-renderer`}
            label="Renderer"
            hint={
              prefs.renderer === "resonance"
                ? "Ambisonic HRTF with a room: reflections and reverb around the voices."
                : "The browser's own HRTF panner, no room; the fallback."
            }
          >
            <Choice
              id={`${id}-renderer`}
              value={prefs.renderer}
              options={RENDERERS}
              labels={RENDERER_LABELS}
              onChange={(renderer) => setPrefs({ renderer })}
            />
          </Row>
          <Row id={`${id}-room`} label="Room" hint="The space Resonance Audio puts the voices in.">
            <Choice
              id={`${id}-room`}
              value={prefs.room}
              options={ROOM_PRESETS}
              labels={ROOM_LABELS}
              onChange={(room) => setPrefs({ room })}
              disabled={prefs.renderer !== "resonance"}
            />
          </Row>
          <Row
            id={`${id}-elevation`}
            label="Elevation cue"
            hint="Brightens voices above you and dulls those below; a generic HRTF cannot tell on its own."
          >
            <Switch
              id={`${id}-elevation`}
              checked={prefs.elevation}
              onCheckedChange={(elevation) => setPrefs({ elevation })}
            />
          </Row>
        </>
      )}
    </div>
  );
}
