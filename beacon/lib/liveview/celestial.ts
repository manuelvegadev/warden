// The sky's moving parts, the way Java Edition draws them: a star field generated from the game's
// own seed, the sun and the moon (with its phase) on the celestial axis, and the cloud layer, which
// is the game's cloud map extruded into boxes and scrolled by the world's game time, so it matches
// what players see.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  ImageLoader,
  type Material,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  type Texture,
  TextureLoader,
  type Vector3,
} from "three";
import { SKY_DOME_RADIUS } from "./constants";
import { horizontalFog } from "./fog";
import { JavaRandom } from "./java-random";
import { celestialAngle, greyTowards, type RGB, skyBrightness, starBrightness, type WorldClock } from "./sky";
import { crisp } from "./texture";

/** Where the sky is drawn: just inside the sky dome. */
const SKY_RADIUS = SKY_DOME_RADIUS - 100;
/**
 * The game's sun and moon are 30 and 20 units wide at 100 units, scaled to our radius and enlarged a
 * fifth: the player view is wider than the game's default field of view, which shrinks them on screen.
 */
const CELESTIAL_SCALE = 1.2;
const SUN_SIZE = (30 / 100) * SKY_RADIUS * CELESTIAL_SCALE;
const MOON_SIZE = (20 / 100) * SKY_RADIUS * CELESTIAL_SCALE;
/** The cloud layer: one cloud-map pixel is a 12×4×12 box at this height; the 256-pixel map tiles every 3072. */
const CLOUD_HEIGHT = 192;
const CLOUD_CELL = 12;
const CLOUD_THICKNESS = 4;
const CLOUD_MAP = 256;
const CLOUD_TILE = CLOUD_MAP * CLOUD_CELL;
/** The map is cut into 8×8 pieces of 32 cells (384 blocks), so only the pieces within the fog are drawn. */
const CLOUD_PIECE = 32;
const CLOUD_PIECES = CLOUD_MAP / CLOUD_PIECE;
const CLOUD_PIECE_BLOCKS = CLOUD_PIECE * CLOUD_CELL;
/** The clouds fade into the fog this many times farther out than the terrain does. */
const CLOUD_FOG_SCALE = 0.2;
/** Clouds drift west (−x) at this many blocks per tick. */
const CLOUD_SPEED = 0.03;
/** The game's shading of a cloud box: top, bottom, the x-facing and the z-facing sides. */
const CLOUD_SHADE = { top: 1, bottom: 0.7, x: 0.9, z: 0.8 };
const STAR_SEED = 10842;
const STAR_COUNT = 1500;

export class Celestial {
  /** Stars, sun and moon: follows the camera and turns with the time of day. */
  readonly sky = new Group();
  /** The cloud layer: the pieces of the map within the fog, in world space. */
  readonly clouds = new Group();
  private readonly stars: Points;
  private readonly sun: Mesh;
  private readonly moon: Mesh;
  private readonly moonPhases: Texture[];
  private readonly cloudMaterial: MeshBasicMaterial;
  /** One geometry per piece of the map, in the piece's own coordinates. */
  private cloudPieces: BufferGeometry[] = [];
  /** The pieces on show, by map tile and piece: "ix,iz,px,pz". */
  private readonly shown = new Map<string, Mesh>();
  private phase = -1;

  /** @param assets base URL of the textures the colour script copied (sun.png, moon-N.png, clouds.png) */
  constructor(assets: string) {
    const loader = new TextureLoader();
    const pixel = (url: string) => crisp(loader.load(url));

    this.stars = new Points(
      starGeometry(),
      new PointsMaterial({
        color: 0xffffff,
        size: 2,
        sizeAttenuation: false,
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    );
    this.sky.add(this.stars);

    const body = (size: number, map: Texture) =>
      new Mesh(
        new PlaneGeometry(size, size),
        new MeshBasicMaterial({ map, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false }),
      );
    this.sun = body(SUN_SIZE, pixel(`${assets}/sun.png`));
    this.sun.position.set(0, SKY_RADIUS, 0);
    this.sun.lookAt(0, 0, 0);
    this.sky.add(this.sun);
    this.moonPhases = Array.from({ length: 8 }, (_, i) => pixel(`${assets}/moon-${i}.png`));
    this.moon = body(MOON_SIZE, this.moonPhases[0]);
    this.moon.position.set(0, -SKY_RADIUS, 0);
    this.moon.lookAt(0, 0, 0);
    this.sky.add(this.moon);

    this.cloudMaterial = horizontalFog(
      new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 }),
      CLOUD_FOG_SCALE,
    );
    new ImageLoader().load(`${assets}/clouds.png`, (image) => {
      this.cloudPieces = cloudPieces(cloudMask(image));
    });
  }

  /**
   * Per frame: turn the sky, pick the moon phase, fade the stars, drift and tint the clouds.
   * @param fogFar where the terrain's fog ends; the clouds reach `1 / CLOUD_FOG_SCALE` times as far
   */
  update(clock: WorldClock, camera: Vector3, fogFar: number) {
    this.sky.position.copy(camera);
    this.sky.rotation.z = celestialAngle(clock.time) * 2 * Math.PI;
    const phase = ((clock.day % 8) + 8) % 8;
    if (phase !== this.phase) {
      this.phase = phase;
      (this.moon.material as MeshBasicMaterial).map = this.moonPhases[phase];
      (this.moon.material as MeshBasicMaterial).needsUpdate = true;
    }
    const weather = clock.thunder ? 0 : clock.rain ? 0.25 : 1;
    (this.stars.material as PointsMaterial).opacity = starBrightness(clock.time) * weather;
    (this.sun.material as MeshBasicMaterial).opacity = weather;
    (this.moon.material as MeshBasicMaterial).opacity = weather;

    this.placeClouds(camera, (clock.gameTime * CLOUD_SPEED) % CLOUD_TILE, fogFar / CLOUD_FOG_SCALE);
    const c = cloudColor(clock);
    this.cloudMaterial.color.setRGB(c[0], c[1], c[2]);
  }

  /**
   * Shows the pieces of the (repeating) map whose square comes within `range` of the camera. The
   * map lives in "cloud space", the world shifted by the drift, so a piece keeps its key as it moves.
   */
  private placeClouds(camera: Vector3, drift: number, range: number) {
    if (this.cloudPieces.length === 0) return;
    const cx = camera.x + drift;
    const cz = camera.z;
    const wanted = new Set<string>();
    for (let ix = Math.floor((cx - range) / CLOUD_TILE); ix <= Math.floor((cx + range) / CLOUD_TILE); ix++) {
      for (let iz = Math.floor((cz - range) / CLOUD_TILE); iz <= Math.floor((cz + range) / CLOUD_TILE); iz++) {
        for (let pz = 0; pz < CLOUD_PIECES; pz++) {
          for (let px = 0; px < CLOUD_PIECES; px++) {
            const x0 = ix * CLOUD_TILE + px * CLOUD_PIECE_BLOCKS;
            const z0 = iz * CLOUD_TILE + pz * CLOUD_PIECE_BLOCKS;
            // Distance from the camera to the piece's square.
            const dx = Math.max(x0 - cx, 0, cx - (x0 + CLOUD_PIECE_BLOCKS));
            const dz = Math.max(z0 - cz, 0, cz - (z0 + CLOUD_PIECE_BLOCKS));
            if (dx * dx + dz * dz > range * range) continue;
            const key = `${ix},${iz},${px},${pz}`;
            wanted.add(key);
            let mesh = this.shown.get(key);
            if (!mesh) {
              mesh = new Mesh(this.cloudPieces[pz * CLOUD_PIECES + px], this.cloudMaterial);
              this.shown.set(key, mesh);
              this.clouds.add(mesh);
            }
            mesh.position.set(x0 - drift, CLOUD_HEIGHT, z0);
          }
        }
      }
    }
    for (const [key, mesh] of this.shown) {
      if (wanted.has(key)) continue;
      this.clouds.remove(mesh);
      this.shown.delete(key);
    }
  }

  dispose() {
    for (const o of [this.stars, this.sun, this.moon]) {
      o.geometry.dispose();
      (o.material as Material).dispose();
    }
    for (const t of this.moonPhases) t.dispose();
    for (const g of this.cloudPieces) g.dispose();
    this.cloudMaterial.dispose();
  }
}

/** The game's cloud colour: white, greyed by rain, dimmed towards night, greyed further by thunder. */
function cloudColor(clock: WorldClock): RGB {
  let rgb: RGB = [1, 1, 1];
  if (clock.rain || clock.thunder) rgb = greyTowards(rgb, 0.95, 0.6);
  const day = skyBrightness(clock.time) * 0.9 + 0.1;
  rgb = [rgb[0] * day, rgb[1] * day, rgb[2] * day];
  if (clock.thunder) rgb = greyTowards(rgb, 0.95, 0.2);
  return rgb;
}

/**
 * The game's star field: 1500 draws from java.util.Random(10842), keeping the points that fall in
 * the unit shell, each pushed to the sky radius. The same draws in the same order, so the sky
 * matches the game's star for star.
 */
function starGeometry(): BufferGeometry {
  const random = new JavaRandom(STAR_SEED);
  const positions: number[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    let x = random.nextFloat() * 2 - 1;
    let y = random.nextFloat() * 2 - 1;
    let z = random.nextFloat() * 2 - 1;
    random.nextFloat(); // the star's size
    const d = x * x + y * y + z * z;
    if (d < 0.010000001 || d >= 1) continue;
    random.nextDouble(); // the star's rotation
    const s = SKY_RADIUS / Math.sqrt(d);
    x *= s;
    y *= s;
    z *= s;
    positions.push(x, y, z);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  return g;
}

/** The cloud map as a bitmap: 1 where there is a cloud. */
function cloudMask(image: HTMLImageElement): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = CLOUD_MAP;
  canvas.height = CLOUD_MAP;
  const ctx = canvas.getContext("2d");
  const mask = new Uint8Array(CLOUD_MAP * CLOUD_MAP);
  if (ctx) {
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, CLOUD_MAP, CLOUD_MAP).data;
    for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] > 127 && data[i * 4] > 127 ? 1 : 0;
  }
  return mask;
}

/** The six faces of a cloud box, as the corners' unit offsets, in counter-clockwise order seen from outside. */
const BOX_FACES = [
  { shade: CLOUD_SHADE.top, dx: 0, dz: 0, corners: [0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0] },
  { shade: CLOUD_SHADE.bottom, dx: 0, dz: 0, corners: [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1] },
  { shade: CLOUD_SHADE.x, dx: 1, dz: 0, corners: [1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1] },
  { shade: CLOUD_SHADE.x, dx: -1, dz: 0, corners: [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0] },
  { shade: CLOUD_SHADE.z, dx: 0, dz: 1, corners: [1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 0, 1] },
  { shade: CLOUD_SHADE.z, dx: 0, dz: -1, corners: [0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0] },
];

/**
 * The cloud map as geometry, one piece at a time: every cloud pixel becomes a box, with the faces
 * between neighbouring boxes left out (also across the map's edge, since it repeats), and the
 * game's shade per face baked into the vertex colours. Two passes, count then fill, straight into
 * typed arrays: the whole map is a few hundred thousand vertices.
 */
function cloudPieces(mask: Uint8Array): BufferGeometry[] {
  const cloud = (x: number, z: number) =>
    mask[((z + CLOUD_MAP) % CLOUD_MAP) * CLOUD_MAP + ((x + CLOUD_MAP) % CLOUD_MAP)] === 1;
  const pieces: BufferGeometry[] = [];
  for (let pz = 0; pz < CLOUD_PIECES; pz++) {
    for (let px = 0; px < CLOUD_PIECES; px++) {
      let faces = 0;
      for (let z = pz * CLOUD_PIECE; z < (pz + 1) * CLOUD_PIECE; z++) {
        for (let x = px * CLOUD_PIECE; x < (px + 1) * CLOUD_PIECE; x++) {
          if (cloud(x, z))
            for (const f of BOX_FACES)
              if (f.dx === 0 && f.dz === 0) faces++;
              else if (!cloud(x + f.dx, z + f.dz)) faces++;
        }
      }
      const positions = new Float32Array(faces * 12);
      const colors = new Uint8Array(faces * 12);
      const indices = new Uint32Array(faces * 6);
      let n = 0;
      for (let z = pz * CLOUD_PIECE; z < (pz + 1) * CLOUD_PIECE; z++) {
        for (let x = px * CLOUD_PIECE; x < (px + 1) * CLOUD_PIECE; x++) {
          if (!cloud(x, z)) continue;
          const x0 = (x - px * CLOUD_PIECE) * CLOUD_CELL;
          const z0 = (z - pz * CLOUD_PIECE) * CLOUD_CELL;
          for (const f of BOX_FACES) {
            if ((f.dx !== 0 || f.dz !== 0) && cloud(x + f.dx, z + f.dz)) continue;
            const shade = Math.round(f.shade * 255);
            const v = n * 4;
            for (let i = 0; i < 4; i++) {
              positions[(v + i) * 3] = x0 + f.corners[i * 3] * CLOUD_CELL;
              positions[(v + i) * 3 + 1] = f.corners[i * 3 + 1] * CLOUD_THICKNESS;
              positions[(v + i) * 3 + 2] = z0 + f.corners[i * 3 + 2] * CLOUD_CELL;
              colors.fill(shade, (v + i) * 3, (v + i) * 3 + 3);
            }
            indices.set([v, v + 1, v + 2, v, v + 2, v + 3], n * 6);
            n++;
          }
        }
      }
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(positions, 3));
      g.setAttribute("color", new BufferAttribute(colors, 3, true));
      g.setIndex(new BufferAttribute(indices, 1));
      g.computeBoundingSphere();
      pieces.push(g);
    }
  }
  return pieces;
}
