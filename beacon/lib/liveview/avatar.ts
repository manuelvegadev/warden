// A player in the scene: the skinview3d model (a THREE.Group) with the walking animation while the
// position changes, and a name tag above the head. Positions arrive at 5 Hz and are interpolated.

import { inferModelType, loadImage, loadSkinToCanvas } from "skinview-utils";
import { NameTagObject, PlayerObject, WalkingAnimation } from "skinview3d";
import { CanvasTexture, Group, NearestFilter, Vector3 } from "three";
import type { PlayerPos } from "@/lib/api";

/** Model units are skin pixels: 32 tall. A player is 1.8 blocks. */
const SCALE = 1.8 / 32;
/** Feet are at −24 model units (legs hang from y = −12 with a 12-unit box). */
const FEET_OFFSET = 24 * SCALE;
const LERP_PER_SECOND = 8;

export class Avatar {
  readonly group = new Group();
  readonly player = new PlayerObject();
  private readonly walk = new WalkingAnimation();
  private target = new Vector3();
  private targetYaw = 0;
  private speed = 0; // blocks per second, from the last two samples
  private lastSampleAt = 0;
  private texture: CanvasTexture | null = null;
  private disposed = false;

  constructor(
    public readonly name: string,
    skinUrl: string,
  ) {
    this.player.scale.setScalar(SCALE);
    this.player.position.y = FEET_OFFSET;
    this.player.skin.visible = false; // until a texture is bound; a bare model renders as garbage
    this.player.cape.visible = false;
    this.player.elytra.visible = false;
    this.group.add(this.player);
    const tag = new NameTagObject(name, {
      font: "600 40px system-ui, sans-serif",
      height: 6,
      backgroundStyle: "rgba(0,0,0,.45)",
      repaintAfterLoaded: false,
    });
    tag.position.y = 8 + 6; // head top is at +8 model units
    this.player.add(tag);
    this.walk.speed = 1;
    void this.loadSkin(skinUrl);
  }

  private async loadSkin(url: string) {
    const canvas = document.createElement("canvas");
    try {
      const img = await loadImage({ src: url, crossOrigin: "use-credentials" });
      loadSkinToCanvas(canvas, img);
      this.player.skin.modelType = inferModelType(canvas);
    } catch {
      // No Mojang skin (offline-mode name): a flat placeholder keeps the player visible.
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#5b7d8c";
        ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = "#d9b38c";
        ctx.fillRect(8, 8, 8, 8); // face
      }
    }
    if (this.disposed) return;
    this.texture = new CanvasTexture(canvas);
    this.texture.magFilter = NearestFilter;
    this.texture.minFilter = NearestFilter;
    this.player.skin.map = this.texture;
    this.player.skin.visible = true;
  }

  /** New sample from the server. */
  setPosition(p: PlayerPos, now: number) {
    const next = new Vector3(p.x, p.y, p.z);
    if (this.lastSampleAt === 0) {
      this.group.position.copy(next);
    } else {
      const dt = Math.max(0.05, (now - this.lastSampleAt) / 1000);
      this.speed = next.distanceTo(this.target) / dt;
    }
    this.target = next;
    this.targetYaw = p.yaw;
    this.lastSampleAt = now;
    this.group.visible = !p.vanished;
  }

  /** Per frame: move towards the last sample and animate the walk while moving. */
  update(dt: number) {
    const k = Math.min(1, dt * LERP_PER_SECOND);
    this.group.position.lerp(this.target, k);
    // Yaw 0 faces south (+z); the model faces +z at rotation 0, so the sign is inverted.
    const want = -(this.targetYaw * Math.PI) / 180;
    let d = want - this.group.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.group.rotation.y += d * k;
    const moving = this.speed > 0.3 && this.group.position.distanceTo(this.target) > 0.02;
    if (moving) {
      this.walk.speed = Math.min(2.5, 0.5 + this.speed / 4);
      this.walk.update(this.player, dt);
    } else {
      this.speed *= 0.9;
      for (const part of [
        this.player.skin.leftArm,
        this.player.skin.rightArm,
        this.player.skin.leftLeg,
        this.player.skin.rightLeg,
      ]) {
        part.rotation.x *= 0.8;
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.texture?.dispose();
    this.group.removeFromParent();
  }
}
