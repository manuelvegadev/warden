"use client";

import { Button } from "@warden/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@warden/ui/components/dropdown-menu";
import { Slider } from "@warden/ui/components/slider";
import { cn } from "@warden/ui/lib/utils";
import { Pause, Play, Repeat, Volume2, VolumeX } from "lucide-react";
import { type KeyboardEvent, memo, type PointerEvent, useEffect, useRef, useState } from "react";
import { clock, normalize, peaks } from "@/lib/audio-player";
import { mono } from "@/lib/utils";

/** Bars in the waveform. */
const BARS = 160;
/** Bigger files are played without a waveform: decoding them whole would take a while and the memory. */
const WAVEFORM_LIMIT = 30 * 1024 * 1024;
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/**
 * A sound in the file manager (ADR-020), played by a player in the panel's own controls rather
 * than the browser's: its waveform, which is also the seek bar (click or drag, arrows step 5 s),
 * play and pause (space), the time, volume, speed and loop. The waveform comes from decoding the
 * file with Web Audio; a file too big for that plays with a plain bar.
 */
export function AudioPlayer({ src, name, size }: { src: string; name: string; size: number }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [wave, setWave] = useState<number[] | null>(null);

  useEffect(() => {
    if (size > WAVEFORM_LIMIT) return;
    let stale = false;
    (async () => {
      const bytes = await (await fetch(src)).arrayBuffer();
      const ctx = new AudioContext();
      try {
        const decoded = await ctx.decodeAudioData(bytes);
        if (!stale) setWave(normalize(peaks(decoded.getChannelData(0), BARS)));
      } finally {
        void ctx.close();
      }
    })().catch(() => {
      /* a format Web Audio cannot decode still plays; it just has no waveform */
    });
    return () => {
      stale = true;
    };
  }, [src, size]);

  // `timeupdate` fires about four times a second, which reads as the playhead jumping; while it
  // plays, the position is read every frame instead.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const a = audio.current;
      if (a) setTime(a.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  useEffect(() => {
    const a = audio.current;
    if (a) a.volume = volume;
  }, [volume]);
  useEffect(() => {
    const a = audio.current;
    if (a) a.playbackRate = rate;
  }, [rate]);

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };
  const seekTo = (t: number) => {
    const a = audio.current;
    if (a && duration) a.currentTime = Math.min(Math.max(t, 0), duration);
  };
  const seekAt = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    seekTo(((e.clientX - r.left) / r.width) * duration);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === " ") {
      e.preventDefault();
      toggle();
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      seekTo(time + (e.key === "ArrowRight" ? 5 : -5));
    }
  };
  const progress = duration ? time / duration : 0;

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        loop={loop}
        muted={muted}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        className="hidden"
      />
      <div className="grid w-full max-w-xl gap-3 rounded-lg border bg-card p-4">
        <span className={cn(mono, "truncate text-sm")}>{name}</span>
        {/* The waveform is the seek bar. */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Position"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${clock(time)} of ${clock(duration)}`}
          onKeyDown={onKeyDown}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            seekAt(e);
          }}
          onPointerMove={(e) => e.buttons === 1 && seekAt(e)}
          className="relative flex h-16 cursor-pointer items-center gap-px rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {wave ? (
            <>
              {/* Two copies of the waveform: the played one on top, cut off at the playhead, so the
                  edge moves continuously — through the middle of a bar — rather than bar by bar. */}
              <Bars wave={wave} className="bg-muted-foreground/35" />
              <Bars wave={wave} className="bg-primary" clip={1 - progress} />
            </>
          ) : (
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary" style={{ width: `${progress * 100}%` }} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="icon" onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="rounded-full">
            {playing ? <Pause /> : <Play />}
          </Button>
          <span className={cn(mono, "text-xs text-muted-foreground tabular-nums")}>
            {clock(time)} / {clock(duration)}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant={loop ? "secondary" : "ghost"}
              size="icon-sm"
              aria-pressed={loop}
              aria-label="Loop"
              title="Loop"
              onClick={() => setLoop((l) => !l)}
            >
              <Repeat />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={muted ? "Unmute" : "Mute"}
              onClick={() => setMuted((m) => !m)}
            >
              {muted || volume === 0 ? <VolumeX /> : <Volume2 />}
            </Button>
            {/* The slider stretches to its parent; the parent gives it a width. */}
            <div className="w-24 shrink-0 px-1">
              <Slider
                min={0}
                max={100}
                value={[muted ? 0 : Math.round(volume * 100)]}
                onValueChange={(v) => {
                  const next = (Array.isArray(v) ? v[0] : v) / 100;
                  setVolume(next);
                  if (next > 0) setMuted(false);
                }}
                aria-label="Volume"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="sm" className={cn(mono, "h-7 px-2 text-xs")} aria-label="Speed" />
                }
              >
                {rate}×
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-24">
                <DropdownMenuRadioGroup value={String(rate)} onValueChange={(v) => setRate(Number(v))}>
                  {RATES.map((r) => (
                    <DropdownMenuRadioItem key={r} value={String(r)}>
                      {r}×
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One layer of the waveform. Memoised: the bars never change once decoded, only how much of the
 * top layer the clip (the unplayed share, cut from the right) leaves showing.
 */
const Bars = memo(function Bars({ wave, className, clip }: { wave: number[]; className: string; clip?: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 flex items-center gap-px"
      style={clip === undefined ? undefined : { clipPath: `inset(0 ${clip * 100}% 0 0)` }}
    >
      {wave.map((p, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: bars are positions, not items
          key={i}
          className={cn("min-w-px flex-1 rounded-full", className)}
          style={{ height: `${Math.max(p * 100, 4)}%` }}
        />
      ))}
    </div>
  );
});
