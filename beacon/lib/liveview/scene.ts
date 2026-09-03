// The three.js side of the live view: renderer, camera rig, one mesh pair (opaque + water) per
// chunk, avatars, and the bookkeeping of which chunks around the focus are wanted.
import {
  AmbientLight,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  LinearSRGBColorSpace,
  type Material,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import type { PlayerPos } from "@/lib/api";
import { Avatar } from "./avatar";
import { type CameraMode, CameraRig, FOV } from "./camera";
import { fitRenderer } from "./canvas";
import { Celestial } from "./celestial";
import { RADIUS_MAX, RADIUS_MIN, SKY_DOME_RADIUS } from "./constants";
import { horizontalFog } from "./fog";
import { chunkKey, parseChunkKey } from "./format";
import type { MeshData } from "./mesher";
import { DEFAULT_SKY, dayTime, fogColor, type RGB, skyColor, terrainLight, type WorldClock } from "./sky";

interface LoadedChunk {
  hash: string;
  opaque: Mesh | null;
  water: Mesh | null;
  /** Daytime sky of the chunk's biome; the chunk under the focus decides the background. */
  sky: RGB | null;
}

/**
 * Where a player's name tag hangs on screen, in pixels from the canvas's top-left corner: the bottom
 * centre of the tag, above the head. It may lie outside the canvas (the player is out of view, or
 * behind the camera, in which case it points the opposite way); the layer clamps it to its edges.
 */
export interface PlayerMarker {
  name: string;
  x: number;
  y: number;
}

/** The tag sits at least this far above the head, in pixels. */
const TAG_MIN_LIFT = 14;
/** Seen from above, the tag is lifted by the head's projected size, so it never sits on the model. */
const TAG_LIFT_BLOCKS = 0.45;

export interface SceneOptions {
  /** Asked when chunks in range are missing; the caller fetches and feeds them back with setChunkMesh. */
  onNeed: (world: string, keys: [number, number][]) => void;
  /** Chunks dropped for being out of range, so the mesher can forget them too. */
  onUnload: (world: string, keys: [number, number][]) => void;
  /** The followed player changed (a click, a drag that broke the follow, the player leaving). */
  onFollow: (name: string | null) => void;
  /** Every frame: where each player's name tag goes on screen. */
  onMarkers: (markers: PlayerMarker[]) => void;
  /** Every rendered frame, after the markers: what needs the camera and the avatars where they are now. */
  onFrame?: () => void;
  skinUrl: (name: string) => string;
}

/** How long a chunk the server did not have stays "absent" before being asked for again. */
const ABSENT_RETRY_MS = 20_000;
/** A request that never came back is retried after this. */
const PENDING_RETRY_MS = 15_000;
/** The lights for the player models (the terrain's shading is baked in), at full daylight. */
const AMBIENT_LIGHT = 2.2;
const SUN_LIGHT = 2.0;
/** Sky, fog and light ease towards their targets with this time constant, in seconds. */
const LIGHT_EASE_SECONDS = 1.2;
/** The game's clock rate, and how the local clock follows the server's samples. */
const TICKS_PER_SECOND = 20;
const CLOCK_SNAP_TICKS = 40;
const CLOCK_CORRECTION = 0.3;
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
  readonly rig: CameraRig;
  private readonly raycaster = new Raycaster();
  private readonly focusPoint = new Vector3();
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
  private clock: WorldClock = { day: 1, time: 6000, gameTime: 6000, rain: false, thunder: false };
  private clockSample: WorldClock | null = null;
  private clocks: Record<string, WorldClock> = {};
  private clockSampledAt = 0;
  private readonly ambient = new AmbientLight(0xffffff, AMBIENT_LIGHT);
  private readonly sun = new DirectionalLight(0xffffff, SUN_LIGHT);
  private readonly fog = new Fog(0x9fc4e7, 1, 2);
  private readonly dome = makeSkyDome();
  private readonly celestial = new Celestial("/liveview");
  private lastDome = "";
  /** Every chunk mesh, so the terrain shows or hides as one. */
  private readonly terrain = new Group();
  private idle = true;
  /** Debug: where the camera's pivot is (the point a click or a wheel notch picked). */
  private readonly pivotMarker = makePivotMarker();
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
    // One canvas pixel per CSS pixel, retina or not: the world is the expensive scene, and blocks read fine at 1×.
    this.renderer.setPixelRatio(1);
    // No colour management, like the game: block colours come from the textures as sRGB bytes, the
    // light multiplies them, and the result goes to the screen as it is. Left at the default, three
    // would take them as linear and re-encode them, and nights come out bright and washed.
    this.renderer.outputColorSpace = LinearSRGBColorSpace;
    this.camera = new PerspectiveCamera(FOV, 1, 0.5, SKY_DOME_RADIUS + 500);
    this.rig = new CameraRig(this.camera, canvas, {
      pick: (x, y) => this.pick(x, y),
      // Dragging the world away or flying off is how you stop following someone; turning is not.
      onUserMove: () => this.follow(null),
    });
    this.jumpTo(new Vector3(0, 64, 0));
    this.scene.background = new Color();
    this.scene.fog = this.fog;
    this.scene.add(this.dome);
    this.scene.add(this.celestial.sky);
    this.scene.add(this.celestial.clouds);
    // Terrain shading is baked into vertex colours (MeshBasicMaterial ignores lights); the lights are
    // for the skinview3d player models, whose standard material renders black without them.
    this.sun.position.set(0.4, 1, 0.6);
    this.scene.add(this.ambient);
    this.scene.add(this.sun);
    this.scene.add(this.terrain);
    this.scene.add(this.pivotMarker);
    this.terrain.visible = false;
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
    this.syncIdle();
    this.clockSample = null;
    this.takeClock(this.clocks[world]);
    this.lastPlan = 0;
  }

  /**
   * Waiting mode, whenever the world has no player: the terrain is hidden, nothing is fetched and
   * nothing is drawn; the component shows its own waiting scene over the canvas.
   */
  private syncIdle() {
    const idle = this.avatars.size === 0;
    if (idle === this.idle) return;
    this.idle = idle;
    this.terrain.visible = !idle;
    if (!idle) this.lastPlan = 0;
  }

  setRadius(r: number) {
    this.radius = Math.max(RADIUS_MIN, Math.min(RADIUS_MAX, r));
    const far = (this.radius + 1) * 16;
    this.fog.near = far * 0.7;
    this.fog.far = far * 1.05;
    this.lastPlan = 0;
  }

  /**
   * The world's time of day and weather: sky and fog colour, terrain and player lighting. Samples
   * come a few times a second and a few ticks apart; between them the clock runs on at the game's 20
   * ticks a second, so the sun, the sky and the clouds move smoothly instead of stepping.
   */
  setClocks(clocks: Record<string, WorldClock>) {
    this.clocks = clocks;
    this.takeClock(clocks[this.world]);
  }

  /** The clock as shown: the last sample run on to now, or null before any sample for this world. */
  currentClock(): WorldClock | null {
    return this.clockSample ? this.clock : null;
  }

  private takeClock(clock: WorldClock | undefined) {
    if (!clock) return;
    const now = performance.now();
    const predicted = this.clockAt(now);
    const error = clock.gameTime - predicted.gameTime;
    // A small disagreement is absorbed over the next samples; a big one (a `/time set`, a lag spike) snaps.
    const base = Math.abs(error) > CLOCK_SNAP_TICKS ? clock.gameTime : predicted.gameTime + error * CLOCK_CORRECTION;
    this.clockSample = { ...clock, gameTime: base, time: clock.time - (clock.gameTime - base) };
    this.clockSampledAt = now;
    this.clock = this.clockAt(now);
  }

  /** The clock extrapolated from the last sample to `now`. */
  private clockAt(now: number): WorldClock {
    const sample = this.clockSample;
    if (!sample) return this.clock;
    const ticks = ((now - this.clockSampledAt) / 1000) * TICKS_PER_SECOND;
    const time = sample.time + ticks;
    return {
      ...sample,
      gameTime: sample.gameTime + ticks,
      time: dayTime(time),
      day: sample.day + Math.floor(time / 24000),
    };
  }

  /**
   * Sky, fog and light for the clock, the weather and the biome under the focus. The targets can
   * jump (a biome border, rain starting, a `/time set`); what is shown eases towards them.
   * @param dt seconds since the last frame; 0 snaps to the target
   */
  private applyLighting(dt: number) {
    const focus = this.focus();
    const fx = Math.floor(focus.x / 16);
    const fz = Math.floor(focus.z / 16);
    const base = this.loaded.get(chunkKey(fx, fz))?.sky ?? this.lastSky;
    this.lastSky = base;
    const k = dt > 0 ? 1 - Math.exp(-dt / LIGHT_EASE_SECONDS) : 1;
    const sky = ease(this.shownSky, skyColor(base, this.clock), k);
    const fog = ease(this.shownFog, fogColor(base, this.clock), k);
    const light = ease(this.shownLight, terrainLight(this.clock), k);
    (this.scene.background as Color).setRGB(sky[0] / 255, sky[1] / 255, sky[2] / 255);
    this.fog.color.setRGB(fog[0] / 255, fog[1] / 255, fog[2] / 255);
    this.dome.position.copy(this.camera.position);
    const key = `${sky.map(Math.round)}|${fog.map(Math.round)}`;
    if (key !== this.lastDome) {
      this.lastDome = key;
      paintSkyDome(this.dome, sky, fog);
    }
    this.opaqueMaterial.color.setRGB(light[0], light[1], light[2]);
    this.transMaterial.color.setRGB(light[0], light[1], light[2]);
    const l = (light[0] + light[1] + light[2]) / 3;
    this.ambient.intensity = AMBIENT_LIGHT * l;
    this.sun.intensity = SUN_LIGHT * l;
    this.celestial.update(this.clock, this.camera.position, this.fog.far);
  }

  private lastSky: RGB = DEFAULT_SKY;
  private readonly shownSky: RGB = [...DEFAULT_SKY];
  private readonly shownFog: RGB = [...DEFAULT_SKY];
  private readonly shownLight: RGB = [1, 1, 1];

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

  setChunkMesh(world: string, cx: number, cz: number, hash: string, mesh: MeshData, sky: RGB | null) {
    if (world !== this.world) return;
    const k = chunkKey(cx, cz);
    this.pending.delete(k);
    this.absent.delete(k);
    const prev = this.loaded.get(k);
    if (prev) this.dropChunk(prev);
    // A chunk without translucent blocks (most of them) gets no second mesh: an empty mesh is still a draw call.
    const opaque = this.place(cx, cz, mesh.positions, mesh.colors, mesh.indices, this.opaqueMaterial);
    const water = this.place(cx, cz, mesh.transPositions, mesh.transColors, mesh.transIndices, this.transMaterial);
    this.loaded.set(k, { hash, opaque, water, sky });
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
    g.computeBoundingBox(); // the raycaster rejects a chunk by its box before testing its triangles
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
    this.syncIdle();
  }

  /**
   * Selects a player: the orbit camera moves with them, the player camera looks through their eyes,
   * and a flight jumps to them once and is then on its own.
   */
  follow(name: string | null) {
    if (name === this.following) return;
    this.following = name;
    const a = name ? this.avatars.get(name) : undefined;
    // Orbit and flight both go to the player at once; the player camera lands in their eyes anyway.
    if (a && this.rig.mode !== "player") this.jumpTo(a.group.position);
    this.opts.onFollow(name);
  }

  /** A click on a player: selects them, or lets go of them, except that the player camera always needs one. */
  toggleFollow(name: string) {
    this.follow(this.following === name && this.rig.mode !== "player" ? null : name);
  }

  /** Whether the camera is looking out of this player's eyes. */
  private inEyes(name: string) {
    return this.rig.mode === "player" && name === this.following;
  }

  /** Puts the focus on a point at once, keeping the camera's current offset from it. */
  jumpTo(p: Vector3) {
    // Before the first jump the camera sits on the focus: it gets the opening aerial angle.
    const offset = this.camera.position.clone().sub(this.rig.pivot);
    if (offset.lengthSq() < 1) offset.copy(CAMERA_OFFSET);
    this.rig.jumpTo(p, offset);
    this.lastTarget.copy(p);
    this.lastPlan = 0;
  }

  setCameraMode(mode: CameraMode) {
    const prev = this.rig.mode;
    if (mode === prev) return;
    const a = this.following ? this.avatars.get(this.following) : undefined;
    if (prev === "player" && a) {
      // Back out of the eyes to the opening aerial shot over the player.
      this.rig.setMode(mode);
      this.rig.jumpTo(a.group.position, CAMERA_OFFSET);
    } else {
      this.rig.setMode(mode);
    }
    if (mode === "orbit" && a) this.jumpTo(a.group.position);
    if (mode === "player" && !a) this.follow(this.avatars.keys().next().value ?? null);
    this.lastPlan = 0;
  }

  /** Shows the camera's pivot, to see what a click or the wheel picked. */
  setDebug(on: boolean) {
    this.pivotMarker.visible = on;
  }

  /** Where the camera's attention is: the orbit pivot, the followed player, or ahead of a flight. */
  private focus(): Vector3 {
    return this.rig.focus(this.focusPoint);
  }

  /** The nearest terrain or player under a screen position, for the orbit camera's pivot. */
  private pick(x: number, y: number): Vector3 | null {
    this.raycaster.setFromCamera({ x, y } as never, this.camera);
    this.raycaster.far = this.fog.far * 1.2; // past the fog there is nothing to see, nor to pick
    const hits = this.raycaster.intersectObjects(this.terrain.visible ? this.terrain.children : [], false);
    for (const a of this.avatars.values()) hits.push(...this.raycaster.intersectObject(a.group, true));
    if (hits.length === 0) return null;
    return hits.reduce((best, h) => (h.distance < best.distance ? h : best)).point;
  }

  // ---- loop ----

  resize() {
    fitRenderer(this.renderer, this.camera, this.canvas);
  }

  private loop = (t: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (t - this.lastFrame) / 1000 || 0.016);
    this.lastFrame = t;
    for (const [name, a] of this.avatars) {
      a.update(dt);
      a.firstPerson = this.inEyes(name);
    }
    const followed = this.following ? this.avatars.get(this.following) : undefined;
    if (followed && this.rig.mode === "orbit") {
      this.delta.copy(followed.group.position).sub(this.rig.pivot);
      this.rig.translate(this.delta);
    } else if (followed && this.rig.mode === "player") {
      followed.eye(this.camera.position);
      this.rig.setLook(followed.viewDirection(this.delta));
      this.rig.pivot.copy(followed.group.position);
    }
    this.rig.update(dt);
    if (this.pivotMarker.visible) {
      this.pivotMarker.position.copy(this.rig.pivot);
      // A constant size on screen, whatever the distance.
      this.pivotMarker.scale.setScalar(this.camera.position.distanceTo(this.rig.pivot) / 60);
    }
    if (t - this.lastPlan > 1000 || this.focus().distanceTo(this.lastTarget) > 16) this.plan(t);
    // The sky follows the biome under the focus and the clock runs on between samples.
    this.clock = this.clockAt(t);
    this.applyLighting(dt);
    // Nothing to show while waiting; the component covers the canvas with its own scene then.
    if (this.idle) return;
    this.renderer.render(this.scene, this.camera);
    this.opts.onMarkers(this.markers());
    this.opts.onFrame?.();
  };

  /**
   * The camera as an audio listener: position, forward and up, nine numbers into `out`. Scene
   * coordinates are the game's, so a speaker placed by `heads` is heard where the avatar is drawn.
   */
  listenerPose(out: Float32Array): void {
    const c = this.camera;
    out[0] = c.position.x;
    out[1] = c.position.y;
    out[2] = c.position.z;
    c.getWorldDirection(this.delta);
    out[3] = this.delta.x;
    out[4] = this.delta.y;
    out[5] = this.delta.z;
    this.delta.set(0, 1, 0).applyQuaternion(c.quaternion);
    out[6] = this.delta.x;
    out[7] = this.delta.y;
    out[8] = this.delta.z;
  }

  /**
   * Every player shown in the current world, by UUID, at eye height, where their voice comes from.
   * `self` marks the player whose eyes the camera looks through: their mouth is the listener's own
   * position, which the caller will want to treat differently.
   */
  heads(cb: (uuid: string, x: number, y: number, z: number, self: boolean) => void): void {
    for (const [name, a] of this.avatars) {
      if (!a.uuid) continue;
      a.eye(this.delta);
      cb(a.uuid, this.delta.x, this.delta.y, this.delta.z, this.inEyes(name));
    }
  }

  /** Each player's head projected onto the screen and lifted clear of the model. */
  private markers(): PlayerMarker[] {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const worldPerPixel = (2 * Math.tan(MathUtils.degToRad(this.camera.fov / 2))) / h;
    const out: PlayerMarker[] = [];
    for (const [name, a] of this.avatars) {
      if (this.inEyes(name)) continue;
      const head = a.headTop(this.delta);
      const distance = head.distanceTo(this.camera.position);
      const v = head.applyMatrix4(this.camera.matrixWorldInverse);
      const behind = v.z > 0;
      v.applyMatrix4(this.camera.projectionMatrix);
      const nx = behind ? -v.x : v.x;
      const ny = behind ? -v.y : v.y;
      const x = ((nx + 1) / 2) * w;
      let y = ((1 - ny) / 2) * h;
      if (!behind) y -= Math.max(TAG_MIN_LIFT, TAG_LIFT_BLOCKS / (worldPerPixel * distance));
      out.push({ name, x, y });
    }
    return out;
  }

  /** Ask for the chunks around the focus that are neither loaded, pending nor known absent; drop far ones. */
  private plan(now: number) {
    this.lastPlan = now;
    const focus = this.focus();
    this.lastTarget.copy(focus);
    if (!this.world || this.idle) return;
    const fx = Math.floor(focus.x / 16);
    const fz = Math.floor(focus.z / 16);
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
      // Dropped as soon as they leave the radius: the slider is the exact number kept in the scene.
      if (!this.inRange(cx, cz, r)) {
        this.dropChunk(c);
        this.loaded.delete(k);
        dropped.push([cx, cz]);
      }
    }
    if (dropped.length) this.opts.onUnload(this.world, dropped);
  }

  private inRange(cx: number, cz: number, r: number) {
    const focus = this.focus();
    const fx = Math.floor(focus.x / 16);
    const fz = Math.floor(focus.z / 16);
    return Math.max(Math.abs(cx - fx), Math.abs(cz - fz)) <= r;
  }

  stats() {
    return { chunks: this.loaded.size, pending: this.pending.size };
  }

  dispose() {
    this.disposed = true;
    this.dome.geometry.dispose();
    (this.dome.material as Material).dispose();
    this.pivotMarker.geometry.dispose();
    (this.pivotMarker.material as Material).dispose();
    this.celestial.dispose();
    cancelAnimationFrame(this.raf);
    for (const c of this.loaded.values()) this.dropChunk(c);
    for (const a of this.avatars.values()) a.dispose();
    this.rig.dispose();
    this.opaqueMaterial.dispose();
    this.transMaterial.dispose();
    this.renderer.dispose();
  }
}

/** Moves `shown` a fraction `k` of the way to `target`, in place, and returns it. */
function ease(shown: RGB, target: RGB, k: number): RGB {
  for (let i = 0; i < 3; i++) shown[i] += (target[i] - shown[i]) * k;
  return shown;
}

/** A magenta ball drawn over everything, so the pivot shows even inside a hill. */
function makePivotMarker(): Mesh {
  const m = new Mesh(
    new SphereGeometry(0.5, 12, 8),
    new MeshBasicMaterial({ color: 0xff00ff, depthTest: false, transparent: true, opacity: 0.85 }),
  );
  m.renderOrder = 10;
  m.visible = false;
  return m;
}

/**
 * The sky: a dome around the camera whose vertex colours run from the sky colour at the zenith to
 * the fog colour at the horizon, so sunsets glow low in the sky and the sky overhead stays blue.
 */
function makeSkyDome(): Mesh {
  const g = new SphereGeometry(SKY_DOME_RADIUS, 24, 12);
  g.setAttribute("color", new BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
  const m = new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false });
  const dome = new Mesh(g, m);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  return dome;
}

function paintSkyDome(dome: Mesh, sky: RGB, fog: RGB) {
  const pos = dome.geometry.attributes.position;
  const col = dome.geometry.attributes.color as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    // Height above the horizon, 0..1; the horizon band takes the fog colour, the rest fades to sky.
    const h = Math.max(0, pos.getY(i) / SKY_DOME_RADIUS);
    const t = Math.min(1, h / 0.3);
    const k = t * t * (3 - 2 * t);
    col.setXYZ(
      i,
      (fog[0] + (sky[0] - fog[0]) * k) / 255,
      (fog[1] + (sky[1] - fog[1]) * k) / 255,
      (fog[2] + (sky[2] - fog[2]) * k) / 255,
    );
  }
  col.needsUpdate = true;
}
