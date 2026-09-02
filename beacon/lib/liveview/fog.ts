// Fog by horizontal distance from the camera instead of view depth, so climbing high does not fade
// the ground below: the fog only hides what is far along the ground.
import type { Material } from "three";

/**
 * @param depthScale multiplies the distance before the scene's fog range applies: below 1 the
 *   material fades out that many times farther away than the terrain does (the clouds).
 */
export function horizontalFog<T extends Material>(material: T, depthScale = 1): T {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <fog_vertex>",
      `#ifdef USE_FOG
        vec4 fogWorld = modelMatrix * vec4(transformed, 1.0);
        vFogDepth = length(fogWorld.xz - cameraPosition.xz) * ${depthScale.toFixed(4)};
      #endif`,
    );
  };
  material.customProgramCacheKey = () => `horizontal-fog-${depthScale}`;
  return material;
}
