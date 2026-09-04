// The terrain's material: the horizontal fog of fog.ts plus the map's relief. The mesher stores a
// per-vertex `mapShade` (a vanilla map's three shades: brighter than the column to the north, level
// with it, or lower), and `relief` blends it in — 1 on the map, where straight down there are no
// sides to read height from, 0 everywhere else.
import type { Material } from "three";
import { withHorizontalFog } from "./fog";

export function terrainMaterial<T extends Material>(material: T, relief: { value: number }): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRelief = relief;
    shader.vertexShader = withHorizontalFog(
      shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float mapShade;\nuniform float uRelief;")
        .replace(
          "#include <color_vertex>",
          `#include <color_vertex>
        #if defined( USE_COLOR_ALPHA ) || defined( USE_COLOR )
          vColor.rgb *= mix(1.0, mapShade, uRelief);
        #endif`,
        ),
    );
  };
  material.customProgramCacheKey = () => "terrain";
  return material;
}
