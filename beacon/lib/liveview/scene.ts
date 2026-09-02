// The three.js side of the live view: renderer, camera and orbit controls, one mesh pair (opaque +
// water) per chunk, avatars, and the bookkeeping of which chunks around the focus are wanted.
import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  type Material,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MOUSE,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PlayerPos } from "@/lib/api";
import { Avatar, pixelTexture } from "./avatar";
import { chunkKey, parseChunkKey } from "./format";
import type { MeshData } from "./mesher";

interface LoadedChunk {
  hash: string;
  opaque: Mesh | null;
  water: Mesh | null;
}

export interface SceneOptions {
  /** Asked when chunks in range are missing; the caller fetches and feeds them back with setChunkMesh. */
  onNeed: (world: string, keys: [number, number][]) => void;
  /** Chunks dropped for being out of range, so the mesher can forget them too. */
  onUnload: (world: string, keys: [number, number][]) => void;
  /** The followed player changed (a click, a drag that broke the follow, the player leaving). */
  onFollow: (name: string | null) => void;
  skinUrl: (name: string) => string;
}

/** How long a chunk the server did not have stays "absent" before being asked for again. */
const ABSENT_RETRY_MS = 20_000;
/** A request that never came back is retried after this. */
const PENDING_RETRY_MS = 15_000;
/** Chunks beyond radius + this are dropped. */
const UNLOAD_MARGIN = 3;
/** Chunks per request. Ring order means the nearest batch lands first; the daemon caps a request at 1024. */
const REQUEST_BATCH = 256;
/** The opening shot: an aerial view pitched well down, from the south-east, like a strategy game camera. */
const CAMERA_PITCH = MathUtils.degToRad(55);
const CAMERA_AZIMUTH = MathUtils.degToRad(30);
const CAMERA_DISTANCE = 80;
const CAMERA_OFFSET = new Vector3(
  CAMERA_DISTANCE * Math.cos(CAMERA_PITCH) * Math.sin(CAMERA_AZIMUTH),
  CAMERA_DISTANCE * Math.sin(CAMERA_PITCH),
  CAMERA_DISTANCE * Math.cos(CAMERA_PITCH) * Math.cos(CAMERA_AZIMUTH),
);

export class LiveViewScene {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly controls: OrbitControls;
  private readonly opaqueMaterial = horizontalFog(new MeshBasicMaterial({ vertexColors: true }));
  // Translucency comes per vertex (RGBA colours): water, ice, glass and leaves in one pass.
  private readonly transMaterial = horizontalFog(
    new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
  );
  private world = "";
  private loaded = new Map<string, LoadedChunk>();
  private pending = new Map<string, number>(); // key → requested at
  private absent = new Map<string, number>(); // key → learned at
  private avatars = new Map<string, Avatar>();
  private following: string | null = null;
  /** Every chunk mesh, so the terrain shows or hides as one. */
  private readonly terrain = new Group();
  private readonly idleCube = makeIdleCube();
  private radius = 8;
  private raf = 0;
  private lastFrame = 0;
  private lastPlan = 0;
  private disposed = false;
  private readonly lastTarget = new Vector3();
  private readonly delta = new Vector3();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly opts: SceneOptions,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera = new PerspectiveCamera(55, 1, 0.5, 2000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 600;
    // Map-style mouse: left drags the world (panning along the ground), right tilts and turns.
    this.controls.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
    this.controls.screenSpacePanning = false;
    this.jumpTo(new Vector3(0, 64, 0));
    canvas.style.cursor = "grab";
    canvas.addEventListener("pointerdown", (ev) => {
      canvas.style.cursor = "grabbing";
      // Dragging the world away is how you stop following someone; turning the camera is not.
      if (ev.button === 0) this.follow(null);
    });
    for (const ev of ["pointerup", "pointercancel", "pointerleave"]) {
      canvas.addEventListener(ev, () => {
        canvas.style.cursor = "grab";
      });
    }
    this.scene.background = new Color(0x9fc4e7);
    // Terrain shading is baked into vertex colours (MeshBasicMaterial ignores lights); the lights are
    // for the skinview3d player models, whose standard material renders black without them.
    this.scene.add(new AmbientLight(0xffffff, 2.2));
    const sun = new DirectionalLight(0xffffff, 2.0);
    sun.position.set(0.4, 1, 0.6);
    this.scene.add(sun);
    this.scene.add(this.terrain);
    this.scene.add(this.idleCube);
    this.setIdle(true);
    this.setRadius(this.radius);
    this.resize();
    this.loop(performance.now());
  }

  // ---- world and chunks ----

  setWorld(world: string) {
    if (world === this.world) return;
    this.world = world;
    for (const c of this.loaded.values()) this.dropChunk(c);
    this.loaded.clear();
    this.pending.clear();
    this.absent.clear();
    for (const a of this.avatars.values()) a.dispose();
    this.avatars.clear();
    this.follow(null);
    this.lastPlan = 0;
  }

  /**
   * Waiting mode: the terrain is hidden, nothing is fetched, and the globe spins at the focus. The
   * component decides when (no player in the world, agent gone, server stopped).
   */
  setIdle(idle: boolean) {
    this.terrain.visible = !idle;
    this.idleCube.visible = idle;
    if (!idle) this.lastPlan = 0;
  }

  private get idle() {
    return this.idleCube.visible;
  }

  setRadius(r: number) {
    this.radius = Math.max(2, Math.min(32, r));
    const far = (this.radius + 1) * 16;
    this.scene.fog = new Fog(0x9fc4e7, far * 0.7, far * 1.05);
    this.lastPlan = 0;
  }

  /** The server had no data for these keys: do not ask again for a while. */
  markAbsent(keys: [number, number][]) {
    const now = performance.now();
    for (const [cx, cz] of keys) {
      const k = chunkKey(cx, cz);
      this.pending.delete(k);
      this.absent.set(k, now);
    }
  }

  /** A `world.chunks` message: chunks whose hash differs from what is loaded are fetched again. */
  invalidate(world: string, refs: [number, number, string][]) {
    if (world !== this.world) return;
    const keys: [number, number][] = [];
    for (const [cx, cz, hash] of refs) {
      const k = chunkKey(cx, cz);
      this.absent.delete(k);
      const cur = this.loaded.get(k);
      if (cur && cur.hash === hash) continue;
      if (this.inRange(cx, cz, this.radius)) {
        keys.push([cx, cz]);
        this.pending.set(k, performance.now());
      }
    }
    for (let i = 0; i < keys.length; i += REQUEST_BATCH) this.opts.onNeed(this.world, keys.slice(i, i + REQUEST_BATCH));
  }

  setChunkMesh(world: string, cx: number, cz: number, hash: string, mesh: MeshData) {
    if (world !== this.world) return;
    const k = chunkKey(cx, cz);
    this.pending.delete(k);
    this.absent.delete(k);
    const prev = this.loaded.get(k);
    if (prev) this.dropChunk(prev);
    // A chunk without translucent blocks (most of them) gets no second mesh: an empty mesh is still a draw call.
    const opaque = this.place(cx, cz, mesh.positions, mesh.colors, mesh.indices, this.opaqueMaterial);
    const water = this.place(cx, cz, mesh.transPositions, mesh.transColors, mesh.transIndices, this.transMaterial);
    this.loaded.set(k, { hash, opaque, water });
  }

  /**
   * One mesh per chunk and pass. The mesh origin sits at the geometry's centre rather than the chunk
   * corner at y = 0: three.js orders translucent meshes by the depth of their origin, and with the
   * centre that order is right for neighbouring chunks, so water under one chunk's ice never paints
   * over the next chunk's ice.
   */
  private place(
    cx: number,
    cz: number,
    positions: Float32Array,
    colors: Uint8Array,
    indices: Uint32Array,
    material: MeshBasicMaterial,
  ): Mesh | null {
    if (indices.length === 0) return null;
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(positions, 3));
    g.setAttribute("color", new BufferAttribute(colors, 4, true));
    g.setIndex(new BufferAttribute(indices, 1));
    g.computeBoundingSphere();
    // Whole blocks only: vertices must stay exact integers or neighbouring chunks show hairline cracks.
    // Cloned: recomputing the sphere below would otherwise overwrite the very vector we position by.
    const c = (g.boundingSphere?.center ?? new Vector3()).clone().round();
    g.translate(-c.x, -c.y, -c.z);
    g.computeBoundingSphere();
    const m = new Mesh(g, material);
    m.position.set(cx * 16 + c.x, c.y, cz * 16 + c.z);
    this.terrain.add(m);
    return m;
  }

  private dropChunk(c: LoadedChunk) {
    for (const m of [c.opaque, c.water]) {
      if (!m) continue;
      this.terrain.remove(m);
      m.geometry.dispose();
    }
  }

  // ---- players ----

  setPlayers(players: PlayerPos[], now: number) {
    const hadAny = this.avatars.size > 0;
    const wasFollowing = this.following;
    const seen = new Set<string>();
    for (const p of players) {
      if (p.world !== this.world) continue;
      seen.add(p.name);
      let a = this.avatars.get(p.name);
      if (!a) {
        a = new Avatar(p.name, this.opts.skinUrl(p.name), horizontalFog);
        this.avatars.set(p.name, a);
        this.scene.add(a.group);
      }
      a.setPosition(p, now);
    }
    for (const [name, a] of this.avatars) {
      if (!seen.has(name)) {
        a.dispose();
        this.avatars.delete(name);
        if (this.following === name) this.follow(null);
      }
    }
    // The first arrival gets the camera (nothing else is worth looking at), and so does whoever is
    // left when the followed player leaves.
    const followedLeft = wasFollowing !== null && this.following === null;
    if (!this.following && this.avatars.size > 0 && (!hadAny || followedLeft)) {
      this.follow(this.avatars.keys().next().value ?? null);
    }
  }

  follow(name: string | null) {
    if (name === this.following) return;
    this.following = name;
    const a = name ? this.avatars.get(name) : undefined;
    if (a) this.jumpTo(a.group.position);
    this.opts.onFollow(name);
  }

  /** Puts the focus on a point at once, keeping the camera's current offset from the target. */
  jumpTo(p: Vector3) {
    // Before the first jump the camera sits on the target: it gets the opening aerial angle.
    const offset = this.camera.position.clone().sub(this.controls.target);
    if (offset.lengthSq() < 1) offset.copy(CAMERA_OFFSET);
    this.controls.target.copy(p);
    this.camera.position.copy(p).add(offset);
    this.lastTarget.copy(p);
    this.lastPlan = 0;
  }

  // ---- loop ----

  resize() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (t: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (t - this.lastFrame) / 1000 || 0.016);
    this.lastFrame = t;
    for (const a of this.avatars.values()) a.update(dt);
    if (this.idle) {
      this.idleCube.position.copy(this.controls.target);
      this.idleCube.rotation.y += dt * 0.6;
    }
    if (this.following) {
      const a = this.avatars.get(this.following);
      if (a) {
        this.delta.copy(a.group.position).sub(this.controls.target);
        this.controls.target.add(this.delta);
        this.camera.position.add(this.delta);
      }
    }
    this.controls.update();
    if (t - this.lastPlan > 1000 || this.controls.target.distanceTo(this.lastTarget) > 16) this.plan(t);
    this.renderer.render(this.scene, this.camera);
  };

  /** Ask for the chunks around the focus that are neither loaded, pending nor known absent; drop far ones. */
  private plan(now: number) {
    this.lastPlan = now;
    this.lastTarget.copy(this.controls.target);
    if (!this.world || this.idle) return;
    const fx = Math.floor(this.controls.target.x / 16);
    const fz = Math.floor(this.controls.target.z / 16);
    const need: [number, number][] = [];
    const r = this.radius;
    for (let ring = 0; ring <= r; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const cx = fx + dx;
          const cz = fz + dz;
          const k = chunkKey(cx, cz);
          if (this.loaded.has(k)) continue;
          const p = this.pending.get(k);
          if (p !== undefined && now - p < PENDING_RETRY_MS) continue;
          const a = this.absent.get(k);
          if (a !== undefined && now - a < ABSENT_RETRY_MS) continue;
          need.push([cx, cz]);
          this.pending.set(k, now);
        }
      }
    }
    for (let i = 0; i < need.length; i += REQUEST_BATCH) this.opts.onNeed(this.world, need.slice(i, i + REQUEST_BATCH));
    const dropped: [number, number][] = [];
    for (const [k, c] of this.loaded) {
      const [cx, cz] = parseChunkKey(k);
      if (!this.inRange(cx, cz, r + UNLOAD_MARGIN)) {
        this.dropChunk(c);
        this.loaded.delete(k);
        dropped.push([cx, cz]);
      }
    }
    if (dropped.length) this.opts.onUnload(this.world, dropped);
  }

  private inRange(cx: number, cz: number, r: number) {
    const fx = Math.floor(this.controls.target.x / 16);
    const fz = Math.floor(this.controls.target.z / 16);
    return Math.max(Math.abs(cx - fx), Math.abs(cz - fz)) <= r;
  }

  stats() {
    return { chunks: this.loaded.size, pending: this.pending.size };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const c of this.loaded.values()) this.dropChunk(c);
    for (const a of this.avatars.values()) a.dispose();
    this.controls.dispose();
    this.opaqueMaterial.dispose();
    this.transMaterial.dispose();
    this.renderer.dispose();
  }
}

// A 16×16 pixel-art globe: ocean, a few continents, ice caps. Drawn once onto a canvas and used on
// every face of the waiting cube.
const GLOBE = [
  "wwwwwwwwwwwwwwww",
  "wwwbbbwwwwbbbwww",
  "bbbbbggbbbbbbbbb",
  "bbbgggggbbbggggb",
  "bbggggggbbgggggg",
  "bbbggggbbbgggggg",
  "bbbbgggbbbbggggb",
  "bbbbbggbbbbbgggb",
  "bbbbbbggbbbbbbgb",
  "bbbbbggggbbbbbbb",
  "bbbbbgggbbbbbbbb",
  "bbbbbbggbbbbbbbb",
  "bbbbbbbgbbbbbbbb",
  "bbbbbbbbbbbbgbbb",
  "wbbbbbbbbbbbbbbw",
  "wwwwwwwwwwwwwwww",
];
const GLOBE_COLORS: Record<string, string> = { w: "#e8f3ff", b: "#3b6fd6", g: "#4caf50" };

function makeIdleCube(): Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    GLOBE.forEach((row, y) => {
      for (let x = 0; x < 16; x++) {
        ctx.fillStyle = GLOBE_COLORS[row[x]] ?? GLOBE_COLORS.b;
        ctx.fillRect(x, y, 1, 1);
      }
    });
  }
  const cube = new Mesh(new BoxGeometry(10, 10, 10), new MeshLambertMaterial({ map: pixelTexture(canvas) }));
  cube.rotation.x = 0.35;
  return cube;
}

/**
 * Fog by horizontal distance from the camera instead of view depth, so climbing high does not fade
 * the ground below: the fog only hides what is far along the ground.
 */
function horizontalFog<T extends Material>(material: T): T {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <fog_vertex>",
      `#ifdef USE_FOG
        vec4 fogWorld = modelMatrix * vec4(transformed, 1.0);
        vFogDepth = length(fogWorld.xz - cameraPosition.xz);
      #endif`,
    );
  };
  material.customProgramCacheKey = () => "horizontal-fog";
  return material;
}
