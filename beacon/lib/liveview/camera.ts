// The camera and its five ways of moving. Orbit is the default and works like SketchUp's: the point
// under the cursor when a drag starts is the pivot for turning, the handle for dragging the world
// and the target of the wheel zoom. Fly is the game's spectator mode: WASD, Space and Shift, the
// mouse looks. Eyes puts the camera in a player's eyes; that pose is set by the scene each frame.
// Isometric is Minecraft Dungeons' shot: locked over the followed player from a fixed 45° tilt, a
// drag turns around them, the wheel zooms. Map is a world map: straight down through an
// orthographic camera, north up, no perspective; a drag pans, the wheel zooms.
import { MathUtils, OrthographicCamera, type PerspectiveCamera, type Quaternion, Vector3 } from "three";
import { CAMERA_TRAITS, type CameraMode, type CameraTraits } from "./camera-modes";
import { capturePointer, releasePointer } from "./canvas";

export interface CameraRigOptions {
  /** The world point under a screen position (−1..1 both axes), or null when only sky is there. */
  pick: (ndcX: number, ndcY: number) => Vector3 | null;
  /** The user dragged the world away or flew off: whatever the camera was attached to is let go. */
  onUserMove: () => void;
}

const PITCH_LIMIT = MathUtils.degToRad(89);
/** Radians per pixel when orbiting or looking around. */
const ORBIT_SPEED = 0.005;
const LOOK_SPEED = 0.0025;
/**
 * One wheel notch moves 15% closer to or farther from the point under the cursor, between a few
 * blocks (closer and a block fills the view) and a distance where the terrain is all fog anyway.
 */
const ZOOM_STEP = 1.15;
/** The wheel keeps its target until the cursor has moved this far, in pixels: picking is not free. */
const ZOOM_REPICK_PX = 4;
const MIN_ZOOM_DISTANCE = 4;
const MAX_ZOOM_DISTANCE = 400;
/**
 * Flight, per game tick (20 a second): the keys add `flyingSpeed` to the velocity, then the velocity
 * decays by 0.91, which gives the game's soft start and short stop. Unlike the game, W and S follow
 * the whole view direction, so looking up and pressing W climbs. Sprinting doubles the speed; the
 * wheel changes it, as spectators can.
 */
const TICK = 1 / 20;
/** The game's default is 0.05 (about 11 blocks a second); a little slower reads better in the panel. */
const FLY_SPEED = 0.035;
const FLY_SPEED_MIN = 0.01;
const FLY_SPEED_MAX = 0.5;
const FLY_SPEED_STEP = 1.2;
const FLY_SPRINT = 2;
const FLY_INPUT = 0.98;
const FLY_FRICTION = 0.91;
/** Isometric: a fixed 45° tilt (the game's), the default diagonal heading, and the zoom range in blocks. */
const ISOMETRIC_PITCH = MathUtils.degToRad(-45);
const ISOMETRIC_YAW = MathUtils.degToRad(45);
const ISOMETRIC_DISTANCE = 24;
const ISOMETRIC_DISTANCE_MIN = 8;
const ISOMETRIC_DISTANCE_MAX = 64;

/**
 * Map: half the height of the view in blocks (the zoom). It opens close enough to tell a player
 * apart as they walk, can come in to a few blocks, and cannot go out past the chunks the viewer
 * loads (`setMapExtent`): beyond them there is only sky to see. The camera sits well above any build.
 */
const MAP_HALF = 24;
const MAP_HALF_MIN = 8;
const MAP_HEIGHT = 256;
/** Chunks of the loaded radius the map keeps out of view, hiding what is still loading after a pan. */
const MAP_MARGIN_CHUNKS = 3;

interface Drag {
  button: number;
  x: number;
  y: number;
  pivot: Vector3;
  position: Vector3;
  quaternion: Quaternion;
  yaw: number;
  pitch: number;
  /** The camera's offset from the pivot, in the camera's frame at the start: turning keeps the pivot on its pixel. */
  local: Vector3;
  moved: boolean;
}

export class CameraRig {
  mode: CameraMode = "orbit";
  /** The map's camera; `active` is whichever of the two renders in the current mode. */
  readonly ortho = new OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
  private aspect = 1;
  private distance = ISOMETRIC_DISTANCE;
  private mapHalf = MAP_HALF;
  /** The side of the loaded square of chunks, in blocks: the most the map may show at once; unbounded until the scene says. */
  private mapExtent = Number.POSITIVE_INFINITY;
  /** 2·tan(fov/2), the perspective camera's blocks per pixel at unit distance and unit height; refreshed with the fov. */
  private fovScale = 0;
  /** Yaw turns left with positive values, pitch looks up; the camera's rotation is derived from them. */
  private yaw = ISOMETRIC_YAW;
  private pitch = 0;
  /** The point the orbit camera turns around when nothing is picked; also what the scene calls the focus. */
  readonly pivot = new Vector3();
  private drag: Drag | null = null;
  /** The wheel zooms towards the point under the cursor; picked once per cursor position (client pixels). */
  private zoomTarget: Vector3 | null = null;
  private zoomTargetAt: [number, number] | null = null;
  private readonly keys = new Set<string>();
  private flySpeed = FLY_SPEED;
  /** Flight velocity in blocks per tick. */
  private readonly velocity = new Vector3();
  private readonly abort = new AbortController();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();

  constructor(
    readonly camera: PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    private readonly opts: CameraRigOptions,
  ) {
    camera.rotation.order = "YXZ";
    canvas.tabIndex = 0;
    canvas.style.outline = "none";
    const { signal } = this.abort;
    canvas.addEventListener("pointerdown", this.onPointerDown, { signal });
    canvas.addEventListener("pointermove", this.onPointerMove, { signal });
    canvas.addEventListener("pointerup", this.onPointerUp, { signal });
    canvas.addEventListener("pointercancel", this.onPointerUp, { signal });
    canvas.addEventListener("wheel", this.onWheel, { signal, passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault(), { signal });
    canvas.addEventListener("keydown", this.onKey, { signal });
    canvas.addEventListener("keyup", this.onKey, { signal });
    canvas.addEventListener("blur", () => this.keys.clear(), { signal });
    document.addEventListener("mousemove", this.onLockedMove, { signal });
    // The map camera always looks straight down with north up: its rotation is set once here.
    this.ortho.up.set(0, 0, -1);
    this.ortho.position.set(0, MAP_HEIGHT, 0);
    this.ortho.lookAt(0, 0, 0);
    this.setFov(CAMERA_TRAITS[this.mode].fov);
    this.updateCursorStyle();
  }

  get traits(): CameraTraits {
    return CAMERA_TRAITS[this.mode];
  }

  /** The camera that renders: the orthographic one on the map, the perspective one everywhere else. */
  get active(): PerspectiveCamera | OrthographicCamera {
    return this.traits.ortho ? this.ortho : this.camera;
  }

  /** The view's aspect ratio changed. */
  resize(aspect: number) {
    this.aspect = aspect;
    this.updateOrtho();
  }

  /** The chunk radius the scene loads; the map's zoom stops a margin short of its edge. */
  setMapRadius(chunks: number) {
    this.mapExtent = (2 * Math.max(2, chunks - MAP_MARGIN_CHUNKS) + 1) * 16;
    this.updateOrtho();
  }

  /** The widest the map may open: the loaded square just fits the view's shorter side. */
  private mapHalfMax(): number {
    return this.mapExtent / 2 / Math.min(1, this.aspect || 1);
  }

  /** Blocks per pixel of the active camera at `distance` from it (the map is the same at any distance). */
  worldPerPixel(viewHeight: number, distance: number): number {
    if (this.traits.ortho) return (2 * this.mapHalf) / viewHeight;
    return (this.fovScale / viewHeight) * distance;
  }

  private setFov(fov: number) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.fovScale = 2 * Math.tan(MathUtils.degToRad(fov / 2));
  }

  setMode(mode: CameraMode) {
    if (mode === this.mode) return;
    const prevDistance = this.camera.position.distanceTo(this.pivot);
    this.mode = mode;
    this.drag = null;
    this.keys.clear();
    this.velocity.set(0, 0, 0);
    if (mode !== "fly" && document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.setFov(this.traits.fov);
    if (mode === "isometric") {
      this.pitch = ISOMETRIC_PITCH;
      this.distance = MathUtils.clamp(prevDistance, ISOMETRIC_DISTANCE_MIN, ISOMETRIC_DISTANCE_MAX);
      this.aim();
    } else if (mode === "map") {
      this.mapHalf = MAP_HALF;
      this.updateOrtho();
      this.aim();
    }
    this.updateCursorStyle();
  }

  /**
   * Isometric and map: puts the camera where the mode says it goes relative to `target`, which
   * becomes the pivot. The scene calls it every frame with the followed player, or without one to
   * stay over the pivot.
   */
  aim(target = this.pivot) {
    this.pivot.copy(target);
    if (this.mode === "isometric") {
      this.applyRotation();
      this.camera.position.copy(this.pivot).addScaledVector(this.forward(this.tmp), -this.distance);
    } else if (this.mode === "map") {
      this.ortho.position.set(this.pivot.x, this.pivot.y + MAP_HEIGHT, this.pivot.z);
    }
  }

  /** Points the camera at `direction`. */
  setLook(direction: Vector3) {
    const d = this.tmp.copy(direction).normalize();
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.asin(MathUtils.clamp(d.y, -1, 1));
    this.applyRotation();
  }

  forward(out = new Vector3()): Vector3 {
    const c = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * c, Math.sin(this.pitch), -Math.cos(this.yaw) * c);
  }

  /** Puts the camera at `offset` from `point`, looking at the point, which becomes the pivot; an aimed mode ignores the offset. */
  jumpTo(point: Vector3, offset: Vector3) {
    if (this.traits.aimed) {
      this.aim(point);
      return;
    }
    this.pivot.copy(point);
    this.camera.position.copy(point).add(offset);
    this.setLook(this.tmp2.copy(point).sub(this.camera.position));
  }

  /** Moves camera and pivot together (following a player), a drag in progress included. */
  translate(delta: Vector3) {
    this.camera.position.add(delta);
    this.pivot.add(delta);
    this.zoomTarget?.add(delta);
    if (this.drag) {
      this.drag.pivot.add(delta);
      this.drag.position.add(delta);
    }
  }

  /** Where the scene should load chunks and read the biome: the pivot, or ahead of a flying camera. */
  focus(out = new Vector3()): Vector3 {
    if (this.mode !== "fly") return out.copy(this.pivot);
    const c = Math.cos(this.pitch) || 1;
    return out.copy(this.camera.position).addScaledVector(this.forward(this.tmp).setY(0).divideScalar(c), 32);
  }

  /** Per frame: spectator flight, the game's tick physics run for the ticks the frame covers. */
  update(dt: number) {
    if (this.mode !== "fly") return;
    const v = this.velocity;
    if (this.keys.size === 0 && v.lengthSq() < 1e-8) return;
    // W and S go where the camera looks; A and D strafe level; Space and Shift go straight up and down.
    const forward = this.forward(this.tmp);
    const right = this.tmp2.set(-forward.z, 0, forward.x).normalize();
    const input = new Vector3();
    if (this.keys.has("KeyW")) input.add(forward);
    if (this.keys.has("KeyS")) input.sub(forward);
    if (this.keys.has("KeyD")) input.add(right);
    if (this.keys.has("KeyA")) input.sub(right);
    if (this.keys.has("Space")) input.y += 1;
    if (this.keys.has("ShiftLeft")) input.y -= 1;
    if (input.lengthSq() > 1) input.normalize();
    const speed = this.flySpeed * (this.keys.has("ControlLeft") ? FLY_SPRINT : 1);
    input.multiplyScalar(speed * FLY_INPUT);
    // Fractional ticks: the velocity after n ticks of "add the input, then decay" in closed form.
    const ticks = dt / TICK;
    const h = FLY_FRICTION ** ticks;
    const gain = (1 - h) / (1 - FLY_FRICTION);
    v.x = v.x * h + input.x * gain;
    v.y = v.y * h + input.y * gain;
    v.z = v.z * h + input.z * gain;
    if (v.lengthSq() < 1e-8) {
      v.set(0, 0, 0);
      return;
    }
    this.camera.position.addScaledVector(v, ticks);
    this.opts.onUserMove();
  }

  dispose() {
    this.abort.abort();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  // ---- internals ----

  private applyRotation() {
    this.pitch = MathUtils.clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  private ndc(ev: { clientX: number; clientY: number }): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1];
  }

  /** The direction through a screen position, in world space, for the camera's current rotation. */
  private rayDirection(nx: number, ny: number, quaternion: Quaternion, out: Vector3): Vector3 {
    out.set(nx, ny, 0.5).applyMatrix4(this.camera.projectionMatrixInverse);
    return out.normalize().applyQuaternion(quaternion);
  }

  /** The point under the cursor when it is on the terrain or a player; otherwise the last one that was. */
  private pickPivot(nx: number, ny: number): Vector3 {
    return this.opts.pick(nx, ny) ?? this.pivot.clone();
  }

  private onPointerDown = (ev: PointerEvent) => {
    this.canvas.focus();
    if (this.mode === "eyes") return;
    if (this.mode === "fly" && ev.button === 0 && document.pointerLockElement !== this.canvas) {
      // Refused in some embeddings (and without a real click): the left-drag look takes over then.
      try {
        (this.canvas.requestPointerLock?.() as Promise<void> | undefined)?.catch(() => {});
      } catch {
        // an older browser throwing synchronously
      }
    }
    const [nx, ny] = this.ndc(ev);
    // Orbit grabs whatever is under the cursor; the other modes turn or pan around their own pivot.
    const pivot = this.mode === "orbit" ? this.pickPivot(nx, ny) : this.pivot.clone();
    this.pivot.copy(pivot);
    const quaternion = this.camera.quaternion.clone();
    const position = this.camera.position.clone();
    this.drag = {
      button: ev.button,
      x: ev.clientX,
      y: ev.clientY,
      pivot,
      position,
      quaternion,
      yaw: this.yaw,
      pitch: this.pitch,
      local: position.clone().sub(pivot).applyQuaternion(quaternion.clone().invert()),
      moved: false,
    };
    capturePointer(this.canvas, ev.pointerId);
    this.updateCursorStyle();
  };

  private onPointerMove = (ev: PointerEvent) => {
    // A real move (not a trackpad's jitter under the wheel) means the next wheel notch picks again.
    const at = this.zoomTargetAt;
    if (at && Math.hypot(ev.clientX - at[0], ev.clientY - at[1]) > ZOOM_REPICK_PX) this.zoomTargetAt = null;
    const d = this.drag;
    if (!d) return;
    const dx = ev.clientX - d.x;
    const dy = ev.clientY - d.y;
    if (!d.moved && dx * dx + dy * dy < 4) return;
    d.moved = true;
    if (this.mode === "fly") {
      // Without pointer lock (denied, or an embedded page) a left drag looks around.
      if (document.pointerLockElement !== this.canvas) this.look(d.yaw - dx * LOOK_SPEED, d.pitch - dy * LOOK_SPEED);
      return;
    }
    if (this.mode === "isometric") {
      // Any drag turns around the player; the tilt is the game's and stays.
      this.yaw = d.yaw - dx * ORBIT_SPEED;
      this.aim();
      return;
    }
    if (this.mode === "map") {
      // A left drag pans: the point under the cursor follows it across the map (north is up).
      if (d.button !== 0) return;
      const wpp = this.worldPerPixel(this.canvas.clientHeight || 1, 0);
      this.pivot.set(d.pivot.x - dx * wpp, d.pivot.y, d.pivot.z - dy * wpp);
      this.aim();
      this.opts.onUserMove();
      return;
    }
    if (d.button === 0) this.pan(d, ev);
    else this.orbit(d, dx, dy);
  };

  private onPointerUp = (ev: PointerEvent) => {
    releasePointer(this.canvas, ev.pointerId);
    this.drag = null;
    this.updateCursorStyle();
  };

  /** Turn around the pivot: the pivot stays on the pixel it was grabbed at. */
  private orbit(d: Drag, dx: number, dy: number) {
    this.yaw = d.yaw - dx * ORBIT_SPEED;
    this.pitch = MathUtils.clamp(d.pitch - dy * ORBIT_SPEED, -PITCH_LIMIT, PITCH_LIMIT);
    this.applyRotation();
    this.camera.position.copy(d.local).applyQuaternion(this.camera.quaternion).add(d.pivot);
    this.pivot.copy(d.pivot);
  }

  /** Drag the world: the grabbed point follows the cursor across the plane facing the camera. */
  private pan(d: Drag, ev: PointerEvent) {
    const [nx, ny] = this.ndc(ev);
    const dir = this.rayDirection(nx, ny, d.quaternion, this.tmp);
    const normal = this.tmp2.set(0, 0, -1).applyQuaternion(d.quaternion);
    const denom = dir.dot(normal);
    if (denom <= 1e-6) return;
    const t = d.pivot.clone().sub(d.position).dot(normal) / denom;
    const under = d.position.clone().addScaledVector(dir, t);
    const shift = d.pivot.clone().sub(under);
    this.camera.position.copy(d.position).add(shift);
    this.pivot.copy(d.pivot);
    this.opts.onUserMove();
  }

  private look(yaw: number, pitch: number) {
    this.yaw = yaw;
    this.pitch = pitch;
    this.applyRotation();
  }

  private onLockedMove = (ev: MouseEvent) => {
    if (this.mode !== "fly" || document.pointerLockElement !== this.canvas) return;
    this.modifiers(ev);
    this.look(this.yaw - ev.movementX * LOOK_SPEED, this.pitch - ev.movementY * LOOK_SPEED);
  };

  private onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    const notches = Math.sign(ev.deltaY);
    if (notches === 0) return;
    if (this.mode === "fly") {
      this.flySpeed = MathUtils.clamp(this.flySpeed * FLY_SPEED_STEP ** -notches, FLY_SPEED_MIN, FLY_SPEED_MAX);
      return;
    }
    if (this.mode === "isometric") {
      this.distance = MathUtils.clamp(
        this.distance * ZOOM_STEP ** notches,
        ISOMETRIC_DISTANCE_MIN,
        ISOMETRIC_DISTANCE_MAX,
      );
      this.aim();
      return;
    }
    if (this.mode === "map") {
      this.mapHalf = this.mapHalf * ZOOM_STEP ** notches;
      this.updateOrtho();
      return;
    }
    if (this.mode !== "orbit") return;
    if (!this.zoomTarget || !this.zoomTargetAt) {
      const [nx, ny] = this.ndc(ev);
      this.zoomTarget = this.pickPivot(nx, ny);
      this.zoomTargetAt = [ev.clientX, ev.clientY];
    }
    const target = this.zoomTarget;
    const distance = this.camera.position.distanceTo(target);
    const next = MathUtils.clamp(distance * ZOOM_STEP ** notches, MIN_ZOOM_DISTANCE, MAX_ZOOM_DISTANCE);
    const dir = this.tmp.copy(this.camera.position).sub(target).normalize();
    this.camera.position.copy(target).addScaledVector(dir, next);
    this.pivot.copy(target);
  };

  private onKey = (ev: KeyboardEvent) => {
    if (this.mode !== "fly") return;
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(ev.code)) ev.preventDefault();
    if (ev.type === "keydown") this.keys.add(ev.code);
    else this.keys.delete(ev.code);
    this.modifiers(ev);
  };

  /**
   * Ctrl and Shift are read from every event's flags as well: pressed before the view was clicked,
   * their own keydown never reached it.
   */
  private modifiers(ev: KeyboardEvent | MouseEvent) {
    if (ev.ctrlKey) this.keys.add("ControlLeft");
    else this.keys.delete("ControlLeft");
    if (ev.shiftKey) this.keys.add("ShiftLeft");
    else this.keys.delete("ShiftLeft");
  }

  private updateOrtho() {
    this.mapHalf = MathUtils.clamp(this.mapHalf, MAP_HALF_MIN, this.mapHalfMax());
    const o = this.ortho;
    o.left = -this.mapHalf * this.aspect;
    o.right = this.mapHalf * this.aspect;
    o.top = this.mapHalf;
    o.bottom = -this.mapHalf;
    o.updateProjectionMatrix();
  }

  private updateCursorStyle() {
    this.canvas.style.cursor =
      this.mode === "eyes" ? "default" : this.mode === "fly" ? "crosshair" : this.drag ? "grabbing" : "grab";
  }
}

/** The direction a player looks, from the game's yaw (0 = south, 90 = west) and pitch (positive = down). */
export function lookDirection(yawDeg: number, pitchDeg: number, out = new Vector3()): Vector3 {
  const yaw = MathUtils.degToRad(yawDeg);
  const pitch = MathUtils.degToRad(pitchDeg);
  const c = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * c, -Math.sin(pitch), Math.cos(yaw) * c);
}
