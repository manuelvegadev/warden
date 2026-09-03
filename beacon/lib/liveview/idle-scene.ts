// The waiting screen: the Beacon mark in three dimensions, in the corner of a dark room. The block
// is a beacon: a glowing cyan core inside a glass cube framed by round edges, and the core is the
// room's light, so the frame throws its shadows on the walls and the floor. It turns slowly on its
// own; a drag turns it by hand. There is nothing else to control.

import { BRAND } from "@warden/ui/lib/brand";
import {
  ACESFilmicToneMapping,
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  HemisphereLight,
  type Material,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Scene,
  SphereGeometry,
  VSMShadowMap,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { capturePointer, fitRenderer, releasePointer } from "./canvas";

/** The mark and its core are the brand's; the room is darker than the site's surface, it is lit from within. */
const MARK = BRAND.tileMark;
const CORE = BRAND.core;
const GROUND = 0x070707;
const WALL = 0x1a1a1a;
/** The block: its size, the round stroke of its edges (1.5 of a 24 grid) and the core's share (7 of 12). */
const SIZE = 2;
const STROKE = (1.5 / 24) * SIZE * 2;
const CORE_SIZE = (7 / 12) * SIZE;
/** The icon's isometric tilt, and how fast the block turns on its own. */
const TILT = Math.atan(1 / Math.SQRT2);
const AUTO_TURN = 0.35;
const DRAG_SPEED = 0.008;
/** A waiting screen does not need more than 60 frames a second, nor retina resolution. */
const FRAME_MS = 1000 / 60 - 1;
const MAX_PIXEL_RATIO = 1;
/** The room: the walls and the floor sit this far from the block. */
const ROOM = 4;
/**
 * The charge before the world shows. Both the spin and the light grow exponentially: slow at first,
 * then running away, the rate of growth itself growing all the time. The light's curve is steeper,
 * so it stays quiet while the spin is already winding up and only blows out at the end.
 */
const CHARGE_SPIN = 22;
const CHARGE_SPIN_STEEPNESS = 4;
const CHARGE_LIGHT = 400;
const CHARGE_LIGHT_STEEPNESS = 7;
const CHARGE_EXPOSURE = 6;
/** Exponential ramp from 0 to 1 over p in 0..1; `k` is how much steeper the end is than the start. */
const expo = (p: number, k: number) => (Math.exp(k * p) - 1) / (Math.exp(k) - 1);

export class IdleScene {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 1, 0.1, 100);
  private readonly renderer: WebGLRenderer;
  /** Yaw from the drag and the slow turn; the tilt sits inside it. */
  private readonly spin = new Group();
  private readonly tilt = new Group();
  private drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
  private yaw = 0;
  private pitch = 0;
  private readonly light: PointLight;
  private readonly core: Mesh;
  /** 0 at rest, 1 when the charge has whited the screen out. */
  private chargeLevel = 0;
  private charging: { start: number; ms: number; resolve: () => void } | null = null;
  private raf = 0;
  private lastFrame = 0;
  private disposed = false;
  private readonly abort = new AbortController();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.shadowMap.enabled = true;
    // Variance shadows blur into a penumbra: the core reads as a glowing body, not a pinpoint.
    this.renderer.shadowMap.type = VSMShadowMap;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.setClearColor(GROUND);
    // Reflections for the glass: a neutral studio, generated once.
    const pmrem = new PMREMGenerator(this.renderer);
    const studio = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(studio, 0.04).texture;
    pmrem.dispose();
    disposeAll(studio);

    this.camera.position.set(6.6, 4.5, 8.4);
    this.camera.lookAt(0, -0.2, 0);
    this.scene.add(makeRoom());
    this.tilt.rotation.x = TILT;
    const block = makeBlock();
    this.light = block.light;
    this.core = block.core;
    this.tilt.add(block.group);
    this.spin.add(this.tilt);
    this.scene.add(this.spin);
    // A little sky light so the room reads even where the core's light does not reach.
    this.scene.add(new HemisphereLight(0x334455, 0x0a0a0a, 0.7));

    const { signal } = this.abort;
    canvas.style.cursor = "grab";
    canvas.addEventListener("pointerdown", this.onPointerDown, { signal });
    canvas.addEventListener("pointermove", this.onPointerMove, { signal });
    canvas.addEventListener("pointerup", this.onPointerUp, { signal });
    canvas.addEventListener("pointercancel", this.onPointerUp, { signal });
    this.resize();
    this.loop(performance.now());
  }

  resize() {
    fitRenderer(this.renderer, this.camera, this.canvas);
  }

  private loop = (t: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    // Hidden (the world is showing): nothing to draw. Otherwise at most 60 frames a second.
    if (this.canvas.clientWidth === 0 || t - this.lastFrame < FRAME_MS) return;
    const dt = Math.min(0.1, (t - this.lastFrame) / 1000 || 0.016);
    this.lastFrame = t;
    this.stepCharge(t);
    const p = this.chargeLevel;
    if (!this.drag || p > 0) this.yaw += dt * (AUTO_TURN + CHARGE_SPIN * expo(p, CHARGE_SPIN_STEEPNESS));
    this.spin.rotation.y = this.yaw;
    this.spin.rotation.x = this.pitch;
    this.renderer.render(this.scene, this.camera);
  };

  /**
   * Runs the block up to a white-out: faster and faster, brighter and brighter, and resolves once
   * the screen is white, so the world can be shown underneath. `reset` puts it back for next time.
   */
  charge(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.charging = { start: performance.now(), ms, resolve };
    });
  }

  reset() {
    this.charging = null;
    this.chargeLevel = 0;
    this.applyCharge();
  }

  private stepCharge(t: number) {
    const c = this.charging;
    if (!c) return;
    this.chargeLevel = Math.min(1, (t - c.start) / c.ms);
    this.applyCharge();
    if (this.chargeLevel >= 1) {
      this.charging = null;
      c.resolve();
    }
  }

  private applyCharge() {
    const eased = expo(this.chargeLevel, CHARGE_LIGHT_STEEPNESS);
    this.light.intensity = 30 + CHARGE_LIGHT * eased;
    this.renderer.toneMappingExposure = 1 + (CHARGE_EXPOSURE - 1) * eased;
    (this.core.material as MeshBasicMaterial).color.set(CORE).lerp(new Color(0xffffff), eased);
  }

  private onPointerDown = (ev: PointerEvent) => {
    this.drag = { x: ev.clientX, y: ev.clientY, yaw: this.yaw, pitch: this.pitch };
    capturePointer(this.canvas, ev.pointerId);
    this.canvas.style.cursor = "grabbing";
  };

  private onPointerMove = (ev: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    this.yaw = d.yaw + (ev.clientX - d.x) * DRAG_SPEED;
    this.pitch = MathUtils.clamp(d.pitch + (ev.clientY - d.y) * DRAG_SPEED, -1, 1);
  };

  private onPointerUp = (ev: PointerEvent) => {
    releasePointer(this.canvas, ev.pointerId);
    this.drag = null;
    this.canvas.style.cursor = "grab";
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.abort.abort();
    this.scene.environment?.dispose();
    disposeAll(this.scene);
    this.renderer.dispose();
  }
}

/** Frees the geometries and materials under an object. */
function disposeAll(root: Scene) {
  root.traverse((o) => {
    const m = o as Mesh;
    if (m.geometry) m.geometry.dispose();
    if (m.material) (m.material as Material).dispose();
  });
}

/**
 * The block: twelve round edges and eight corners in the mark's grey, which throw the shadows; glass
 * faces that reflect the room and let the core through; and the core, glowing and lighting the room.
 */
function makeBlock(): { group: Group; light: PointLight; core: Mesh } {
  const g = new Group();
  const frame = new MeshStandardMaterial({ color: MARK, roughness: 0.5, metalness: 0.1, envMapIntensity: 0.3 });
  const h = SIZE / 2;
  const ends = [-h, h];
  const edge = new CylinderGeometry(STROKE / 2, STROKE / 2, SIZE, 10);
  const solid = (geometry: CylinderGeometry | SphereGeometry) => {
    const m = new Mesh(geometry, frame);
    m.castShadow = true;
    return m;
  };
  for (const a of ends) {
    for (const b of ends) {
      const ey = solid(edge);
      ey.position.set(a, 0, b);
      const ex = solid(edge);
      ex.rotation.z = Math.PI / 2;
      ex.position.set(0, a, b);
      const ez = solid(edge);
      ez.rotation.x = Math.PI / 2;
      ez.position.set(a, b, 0);
      g.add(ey, ex, ez);
    }
  }
  const corner = new SphereGeometry(STROKE / 2, 12, 8);
  for (const x of ends) {
    for (const y of ends) {
      for (const z of ends) {
        const m = solid(corner);
        m.position.set(x, y, z);
        g.add(m);
      }
    }
  }
  // Thin panes just inside the frame: plain transparency with the studio's reflections. Physical
  // transmission looked no better here and cost a whole extra render of the scene every frame.
  const pane = SIZE - STROKE * 0.6;
  const glass = new Mesh(
    new BoxGeometry(pane, pane, pane),
    new MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.1,
      roughness: 0.02,
      metalness: 0,
      // The glass look comes from the reflections, which are a texture lookup: the studio in the
      // environment map, plus a clear coat for the sharp highlights.
      envMapIntensity: 1.4,
      specularIntensity: 1,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      depthWrite: false,
    }),
  );
  g.add(glass);
  // The core is unlit: it is the light, and lit from inside it would burn to white.
  const core = new Mesh(new BoxGeometry(CORE_SIZE, CORE_SIZE, CORE_SIZE), new MeshBasicMaterial({ color: CORE }));
  g.add(core);
  // The core is the light. It sits at the centre, so the frame around it throws the shadows.
  const light = new PointLight(CORE, 30, 40, 2);
  light.castShadow = true;
  // A small map blurred wide: softer shadows for a quarter of the work.
  light.shadow.mapSize.set(512, 512);
  light.shadow.bias = -0.0005;
  light.shadow.radius = 26;
  light.shadow.blurSamples = 12;
  g.add(light);
  return { group: g, light, core };
}

/** The corner of a box: a floor and two walls, matte and dark, that take the shadows. */
function makeRoom(): Group {
  const g = new Group();
  const wall = new MeshStandardMaterial({ color: WALL, roughness: 0.95, metalness: 0 });
  const floor = new MeshStandardMaterial({ color: GROUND, roughness: 0.9, metalness: 0 });
  const plane = new PlaneGeometry(60, 60);
  const f = new Mesh(plane, floor);
  f.rotation.x = -Math.PI / 2;
  f.position.y = -ROOM * 0.55;
  const back = new Mesh(plane, wall);
  back.position.z = -ROOM;
  const left = new Mesh(plane, wall);
  left.rotation.y = Math.PI / 2;
  left.position.x = -ROOM;
  for (const m of [f, back, left]) {
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}
