// Time of day the way Java Edition lights it: the celestial angle from the world clock, the sky
// colour fading from the biome's daytime blue to black through sunrise and sunset, block light
// from sky level 15 by day down to 4 at night, and rain or thunder greying everything.

export interface WorldClock {
  /** Days since the world began. */
  day: number;
  /** Ticks since 06:00, 0..24000 (6000 noon, 12000 sunset, 18000 midnight). */
  time: number;
  /** Total ticks of the world, never paused or set: what the clouds drift by. */
  gameTime: number;
  rain: boolean;
  thunder: boolean;
}

/** A tick count folded into the day, 0..24000. */
export const dayTime = (ticks: number) => ((ticks % 24000) + 24000) % 24000;

/** The in-game clock, 24-hour: tick 0 is 06:00, 1000 ticks are an hour. */
export function clockLabel(clock: WorldClock): string {
  const minutes = Math.floor((dayTime(clock.time) / 1000) * 60);
  const h = (Math.floor(minutes / 60) + 6) % 24;
  const m = minutes % 60;
  const weather = clock.thunder ? " · Thunderstorm" : clock.rain ? " · Rain" : "";
  return `Day ${clock.day}, ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}${weather}`;
}

export type RGB = [number, number, number];

/** Plains at noon: the sky before any chunk has told us its biome. */
export const DEFAULT_SKY: RGB = [120, 167, 255];
/** The overworld's fog colour, the same for every biome: much paler than the sky. */
const FOG_BASE: RGB = [192, 216, 255];
/** How much of the sky colour the game mixes into the fog at the panel's render distances. */
const FOG_SKY_MIX = 0.15;

/** Where the sun is, 0..1 (0 = 06:00, 0.5 = 18:00); eased the way the game eases it. */
export function celestialAngle(time: number): number {
  let f = dayTime(time) / 24000 - 0.25;
  if (f < 0) f += 1;
  return f + (1 - (Math.cos(f * Math.PI) + 1) / 2 - f) / 3;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** How much of the biome's sky colour shows, 0 (night) to 1 (day); the game's sky brightness. */
export function skyBrightness(time: number): number {
  return clamp01(Math.cos(celestialAngle(time) * 2 * Math.PI) * 2 + 0.5);
}

/** The night is not black: the sky keeps a trace of its colour overhead, more so at the horizon. */
const NIGHT_SKY = 0.06;
const NIGHT_FOG = 0.14;

/** The world's sky light level, 15 by day down to 4 at midnight. */
export function skyLight(time: number): number {
  return 15 - Math.round((1 - skyBrightness(time)) * 11);
}

/** The sunrise/sunset glow: colour and how strongly it blends into the sky, or null away from the horizon. */
export function sunriseColor(time: number): { rgb: RGB; alpha: number } | null {
  const c = Math.cos(celestialAngle(time) * 2 * Math.PI);
  if (c < -0.4 || c > 0.4) return null;
  const f = (c / 0.4) * 0.5 + 0.5;
  const s = 1 - (1 - Math.sin(f * Math.PI)) * 0.99;
  const alpha = s * s;
  return { rgb: [Math.round((f * 0.3 + 0.7) * 255), Math.round((f * 0.7 + 0.2) * 255), Math.round(0.2 * 255)], alpha };
}

/** The sky overhead for a biome's daytime sky at this time and weather, 0..255. */
export function skyColor(base: RGB, clock: WorldClock): RGB {
  const b = Math.max(NIGHT_SKY, skyBrightness(clock.time));
  return weather([base[0] * b, base[1] * b, base[2] * b], clock);
}

/**
 * The fog colour, which is also the horizon: the game's pale fog colour with a little of the biome's
 * sky mixed in. At sunrise and sunset the glow lives here, so distant terrain and the horizon turn
 * orange while the sky overhead stays blue, as in the game.
 */
export function fogColor(base: RGB, clock: WorldClock): RGB {
  const b = Math.max(NIGHT_FOG, skyBrightness(clock.time));
  const mix = (i: number) => (FOG_BASE[i] + (base[i] - FOG_BASE[i]) * FOG_SKY_MIX) * b;
  let rgb: RGB = [mix(0), mix(1), mix(2)];
  const glow = sunriseColor(clock.time);
  if (glow) {
    const a = glow.alpha * 0.75;
    rgb = [
      rgb[0] + (glow.rgb[0] - rgb[0]) * a,
      rgb[1] + (glow.rgb[1] - rgb[1]) * a,
      rgb[2] + (glow.rgb[2] - rgb[2]) * a,
    ];
  }
  return weather(rgb, clock);
}

/**
 * Moves a colour `amount` (0..1) of the way towards its own luminance scaled by `towards`: the
 * game's way of greying the sky, the fog and the clouds in rain and thunder.
 */
export function greyTowards(rgb: RGB, amount: number, towards: number): RGB {
  const lum = (rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11) * towards;
  return [rgb[0] + (lum - rgb[0]) * amount, rgb[1] + (lum - rgb[1]) * amount, rgb[2] + (lum - rgb[2]) * amount];
}

/** Rain greys a colour towards its luminance, thunder more so. */
function weather(rgb: RGB, clock: WorldClock): RGB {
  const out = clock.thunder ? greyTowards(rgb, 0.75, 0.9) : clock.rain ? greyTowards(rgb, 0.45, 0.9) : rgb;
  return [Math.round(out[0]), Math.round(out[1]), Math.round(out[2])];
}

/** How visible the stars are, 0..0.5: the game's star brightness, up in the hour after sunset. */
export function starBrightness(time: number): number {
  const f = clamp01(1 - (Math.cos(celestialAngle(time) * 2 * Math.PI) * 2 + 0.25));
  return f * f * 0.5;
}

/**
 * The multiplier for the terrain's baked colours, per channel 0..1: full at sky light 15, dim and
 * bluish at 4 (moonlight), the way the game's light map reads at default gamma.
 */
export function terrainLight(clock: WorldClock): RGB {
  const level = skyLight(clock.time) - (clock.thunder ? 3 : clock.rain ? 1 : 0);
  const t = clamp01(Math.max(0, level) / 15);
  const b = 0.16 + 0.84 * t ** 1.6;
  const night = 1 - t;
  return [b * (1 - night * 0.35), b * (1 - night * 0.22), b];
}
