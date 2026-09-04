// The terrain's material: the horizontal fog of fog.ts, the block textures, the server's light and
// the map's relief. Every face carries the tile it shows (`tileLayer`, into a texture array of 16×16
// block faces) and where in it each corner lands (`tileUv`); the vertex colour holds the biome
// tint, the ambient occlusion and the face shade, and the tile multiplies it. `light` is the game's
// sky and block light at the vertex (0–15 each, scaled), interpolated across the face and turned
// into colour per pixel exactly the way the game's light map is: the level curve, the hour's
// darkening of sky light, the warmth of block light, the faint floor, the brightness option's
// gamma. The mesher stores a per-vertex `mapShade` (a vanilla map's three shades), and `relief`
// blends it in — 1 on the map, 0 everywhere else.
import type { DataArrayTexture, Material } from "three";
import { withHorizontalFog } from "./fog";

export interface TerrainUniforms {
  relief: { value: number };
  tiles: { value: DataArrayTexture };
  /** The game's sky darken: how much of full sky light the hour lets through, 1 by day, 0.2 at night. */
  skyDarken: { value: number };
  /** The game's brightness option, 0 (moody) to 1 (bright); 0.5 is its default. */
  gamma: { value: number };
  nightVision: { value: number };
}

/**
 * The game's light map (LightTexture), one texel per (sky, block) level pair, as a function of the
 * interpolated levels 0..1. Block light carries the game's steady 1.5 factor (its flicker averages
 * out to nothing).
 */
const LIGHT_MAP = /* glsl */ `
  uniform float uSkyDarken;
  uniform float uGamma;
  uniform float uNightVision;
  varying vec2 vLight;
  float levelBrightness(float f) { return f / (4.0 - 3.0 * f); }
  vec3 notGamma(vec3 c) { vec3 f = 1.0 - c; return 1.0 - f * f * f * f; }
  vec3 lightMap(vec2 level) {
    float sky = levelBrightness(level.x) * (uSkyDarken * 0.95 + 0.05);
    float block = levelBrightness(level.y) * 1.5;
    vec3 skyTint = mix(vec3(uSkyDarken, uSkyDarken, 1.0), vec3(0.99, 1.12, 1.0), 0.35);
    vec3 c = vec3(block, block * ((block * 0.6 + 0.4) * 0.6 + 0.4), block * (block * block * 0.6 + 0.4));
    c += skyTint * sky;
    c = mix(c, vec3(0.75), 0.04);
    float peak = max(c.r, max(c.g, c.b));
    if (peak < 1.0) c = mix(c, c / peak, uNightVision);
    c = clamp(c, 0.0, 1.0);
    c = mix(c, notGamma(c), uGamma);
    c = mix(c, vec3(0.75), 0.04);
    return clamp(c, 0.0, 1.0);
  }`;

export function terrainMaterial<T extends Material>(material: T, u: TerrainUniforms): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRelief = u.relief;
    shader.uniforms.uTiles = u.tiles;
    shader.uniforms.uSkyDarken = u.skyDarken;
    shader.uniforms.uGamma = u.gamma;
    shader.uniforms.uNightVision = u.nightVision;
    shader.vertexShader = withHorizontalFog(
      shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
        attribute float mapShade;
        attribute vec2 tileUv;
        attribute float tileLayer;
        attribute vec2 light;
        uniform float uRelief;
        varying vec3 vTile;
        varying vec2 vLight;`,
        )
        .replace(
          "#include <color_vertex>",
          `#include <color_vertex>
        #if defined( USE_COLOR_ALPHA ) || defined( USE_COLOR )
          vColor.rgb *= mix(1.0, mapShade, uRelief);
        #endif
        vTile = vec3(tileUv, tileLayer);
        vLight = light;`,
        ),
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform highp sampler2DArray uTiles;
        varying vec3 vTile;
        ${LIGHT_MAP}`,
      )
      .replace(
        "#include <map_fragment>",
        `diffuseColor *= texture(uTiles, vTile);
        diffuseColor.rgb *= lightMap(vLight);`,
      );
  };
  material.customProgramCacheKey = () => "terrain";
  return material;
}
