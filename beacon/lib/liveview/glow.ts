// The players' outline, the game's Glowing effect (a spectral arrow): a bright rim around each
// silhouette, drawn over everything so a player reads from far away and through the terrain.
//
// Two small passes after the world: the avatars alone, as flat white, into a half-size mask; then
// a full-screen quad that lights every pixel just outside the mask. Nothing else is touched — the
// world keeps its colour pipeline, and the mask ignores depth on purpose.
import {
  type Camera,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  OrthographicCamera,
  PlaneGeometry,
  type Scene,
  ShaderMaterial,
  Vector2,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";

/** The layer avatars also live on, so the mask pass sees only them. */
const GLOW_LAYER = 1;
/**
 * The rim: the mask is dilated by two steps of this many screen pixels, so the outline is about
 * twice this wide — thin, like the game's, so a distant player is a figure with an edge and not a
 * blob. The half-size mask blurs it a little, which suits a glow.
 */
const RIM_PX = 1;
const MASK_SCALE = 0.5;

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D mask;
  uniform vec2 texel;
  varying vec2 vUv;
  void main() {
    float inside = texture2D(mask, vUv).a;
    // The rim: the mask dilated by a few texels, minus the mask itself.
    float near = 0.0;
    for (int i = -2; i <= 2; i++) {
      for (int j = -2; j <= 2; j++) {
        near = max(near, texture2D(mask, vUv + vec2(float(i), float(j)) * texel).a);
      }
    }
    float rim = clamp(near - inside, 0.0, 1.0);
    if (rim <= 0.01) discard;
    gl_FragColor = vec4(1.0, 1.0, 1.0, rim * 0.9);
  }
`;

export class Glow {
  private readonly mask: WebGLRenderTarget;
  private readonly white = new MeshBasicMaterial({ color: 0xffffff, fog: false });
  private readonly quad: Mesh;
  private readonly material: ShaderMaterial;
  private readonly screen = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  enabled = true;

  constructor(private readonly renderer: WebGLRenderer) {
    this.mask = new WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.material = new ShaderMaterial({
      uniforms: { mask: { value: this.mask.texture }, texel: { value: new Vector2() } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
  }

  /** Marks an object (and its parts) as one of the glowing ones. */
  static mark(object: Object3D) {
    object.traverse((o) => o.layers.enable(GLOW_LAYER));
  }

  resize(width: number, height: number) {
    const w = Math.max(1, Math.round(width * MASK_SCALE));
    const h = Math.max(1, Math.round(height * MASK_SCALE));
    this.mask.setSize(w, h);
    this.material.uniforms.texel.value.set((RIM_PX * MASK_SCALE) / w, (RIM_PX * MASK_SCALE) / h);
  }

  /** After the world is drawn: the rims, on top, with the same camera. */
  render(scene: Scene, camera: Camera) {
    if (!this.enabled) return;
    const r = this.renderer;
    const layers = camera.layers.mask;
    const override = scene.overrideMaterial;
    const background = scene.background;
    const fog = scene.fog;
    camera.layers.set(GLOW_LAYER);
    scene.overrideMaterial = this.white;
    scene.background = null;
    scene.fog = null;
    r.setRenderTarget(this.mask);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(scene, camera);
    r.setRenderTarget(null);
    camera.layers.mask = layers;
    scene.overrideMaterial = override;
    scene.background = background;
    scene.fog = fog;
    const autoClear = r.autoClear;
    r.autoClear = false;
    r.render(this.quad, this.screen);
    r.autoClear = autoClear;
  }

  dispose() {
    this.mask.dispose();
    this.white.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
