import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  celestialAngle,
  clockLabel,
  DEFAULT_SKY,
  fogColor,
  skyBrightness,
  skyColor,
  skyLight,
  sunriseColor,
  terrainLight,
} from "./sky";

const clear = (time: number) => ({ day: 34, time, gameTime: 0, rain: false, thunder: false });

describe("sky", () => {
  it("prints the 24-hour clock with the day", () => {
    assert.equal(clockLabel(clear(0)), "Day 34, 06:00");
    assert.equal(clockLabel(clear(6000)), "Day 34, 12:00");
    assert.equal(clockLabel(clear(6550)), "Day 34, 12:33");
    assert.equal(clockLabel(clear(18000)), "Day 34, 00:00");
    assert.equal(clockLabel({ day: 2, time: 13000, gameTime: 0, rain: true, thunder: false }), "Day 2, 19:00 · Rain");
  });

  it("follows the game's clock", () => {
    assert.ok(Math.abs(celestialAngle(6000)) < 1e-9, "noon is angle 0");
    assert.ok(Math.abs(celestialAngle(18000) - 0.5) < 1e-9, "midnight is angle 0.5");
    assert.equal(skyBrightness(6000), 1);
    assert.equal(skyBrightness(18000), 0);
    assert.equal(skyLight(6000), 15);
    assert.equal(skyLight(18000), 4);
    // Sunset begins at 18:00 and the light is fully down by about 19:40 (the wiki's 19:40:12).
    assert.ok(skyLight(12000) >= 14);
    assert.ok(skyLight(13000) < 14 && skyLight(13000) > 4);
    assert.equal(skyLight(13700), 4);
    assert.ok(skyLight(23000) > 4 && skyLight(0) >= 14, "dawn brightens from 05:00");
  });

  it("colours the sky from the biome by day, near black at night, warm at sunset", () => {
    assert.deepEqual(skyColor(DEFAULT_SKY, clear(6000)), DEFAULT_SKY);
    // Night keeps a trace of the sky colour (the game's sky is not pure black).
    const night = skyColor(DEFAULT_SKY, clear(18000));
    assert.ok(
      night.every((c, i) => c > 0 && c <= Math.ceil(DEFAULT_SKY[i] * 0.07)),
      `night ${night}`,
    );
    assert.equal(sunriseColor(6000), null);
    const dusk = sunriseColor(12500);
    assert.ok(dusk && dusk.alpha > 0.5, "the glow peaks around sunset");
    const c = fogColor(DEFAULT_SKY, clear(12500));
    assert.ok(c[0] > c[2], `sunset horizon is warmer than blue: ${c}`);
    const overhead = skyColor(DEFAULT_SKY, clear(12500));
    assert.ok(overhead[2] > overhead[0], `the sky overhead stays blue: ${overhead}`);
  });

  it("dims and greys with the weather", () => {
    const day = skyColor(DEFAULT_SKY, clear(6000));
    const rain = skyColor(DEFAULT_SKY, { day: 1, time: 6000, gameTime: 0, rain: true, thunder: false });
    const storm = skyColor(DEFAULT_SKY, { day: 1, time: 6000, gameTime: 0, rain: true, thunder: true });
    assert.ok(rain[2] < day[2] && storm[2] < rain[2]);
    assert.ok(Math.abs(rain[0] - rain[2]) < Math.abs(day[0] - day[2]), "rain is greyer");
  });

  it("lights the terrain fully by day and dimly, bluish, at night", () => {
    assert.deepEqual(terrainLight(clear(6000)), [1, 1, 1]);
    const night = terrainLight(clear(18000));
    assert.ok(night[2] > night[0] && night[2] < 0.35 && night[0] > 0.1, `night ${night}`);
    const rainy = terrainLight({ day: 1, time: 6000, gameTime: 0, rain: true, thunder: false });
    assert.ok(rainy[0] < 1 && rainy[0] > 0.8);
  });
});
