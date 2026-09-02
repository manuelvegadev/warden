// What every three.js canvas in the live view needs: fitting the renderer to the element, and a
// pointer capture that does not throw for a synthetic event or a pointer that is already gone.
import type { PerspectiveCamera, WebGLRenderer } from "three";

/** Sizes the renderer's drawing buffer to the canvas's layout size and keeps the camera's aspect in step. */
export function fitRenderer(renderer: WebGLRenderer, camera: PerspectiveCamera, canvas: HTMLCanvasElement) {
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

export function capturePointer(canvas: HTMLCanvasElement, pointerId: number) {
  try {
    canvas.setPointerCapture(pointerId);
  } catch {
    // a synthetic event, or a pointer that is already gone
  }
}

export function releasePointer(canvas: HTMLCanvasElement, pointerId: number) {
  try {
    canvas.releasePointerCapture(pointerId);
  } catch {
    // never captured
  }
}
