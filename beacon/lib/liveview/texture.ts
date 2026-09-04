import { CanvasTexture, NearestFilter, type Texture } from "three";

/** Keeps a texture's pixels crisp, the way Minecraft draws its 16×16 art. */
export function crisp<T extends Texture>(texture: T): T {
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  return texture;
}

export const pixelTexture = (canvas: HTMLCanvasElement) => crisp(new CanvasTexture(canvas));
