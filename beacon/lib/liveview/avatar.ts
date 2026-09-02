// A player in the scene: the skinview3d model (a THREE.Group) animated by what the agent says the
// player is doing. Positions arrive at 5 Hz and are interpolated. The name tag is not here: it is an
// HTML layer over the canvas that the scene positions from the head each frame.

import { inferModelType, loadImage, loadSkinToCanvas } from "skinview-utils";
import { FlyingAnimation, IdleAnimation, PlayerObject, RunningAnimation, WalkingAnimation } from "skinview3d";
import { CanvasTexture, Group, type Material, MathUtils, type Mesh, NearestFilter, type Texture, Vector3 } from "three";
import type { PlayerPos } from "@/lib/api";
import { lookDirection } from "./camera";

/** Model units are skin pixels: 32 tall. A player is 1.8 blocks. */
const SCALE = 1.8 / 32;
/** Feet are at −24 model units (legs hang from y = −12 with a 12-unit box). */
const FEET_OFFSET = 24 * SCALE;
const LERP_PER_SECOND = 8;
/** How far the head may turn from the body before the body follows (Minecraft: 75°). */
const HEAD_LIMIT = MathUtils.degToRad(75);
/** What the player is doing, from the agent's pose flags and the speed of the last samples. */
type Motion = "idle" | "walk" | "run" | "sneak" | "jump" | "swim" | "fly" | "glide";
/**
 * Swimming is a pose, not an animation: the body lies flat with its centre this far above the
 * player's position (the game's 0.6-block box), and the game eases in and out of it over about half
 * a second. The stroke of the arms is the only part that animates.
 */
const SWIM_LEVEL = 0.3; // blocks: the model's position is in world units, it is the model that is scaled
const SWIM_EASE_SECONDS = 0.55;
const SWIM_STROKE_SPEED = 4;
/** Sneaking, as the game draws it: the body leans forward and drops a little. */
const SNEAK_LEAN = 0.5;
const SNEAK_DROP = 3;
/** Wraps an angle to (-π, π]. */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Keeps a texture's pixels crisp, the way Minecraft draws its 16×16 art. */
export function crisp<T extends Texture>(texture: T): T {
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  return texture;
}

export const pixelTexture = (canvas: HTMLCanvasElement) => crisp(new CanvasTexture(canvas));

export class Avatar {
  readonly group = new Group();
  readonly player = new PlayerObject();
  private readonly walk = new WalkingAnimation();
  private readonly run = new RunningAnimation();
  private readonly idle = new IdleAnimation();
  private readonly glide = new FlyingAnimation();
  /** How far into the swimming pose the body is, 0..1. */
  private swimAmount = 0;
  private stroke = 0;
  private motion: Motion = "idle";
  /** The agent's last word on what the player is doing; older agents send none of the pose fields. */
  private last: Pick<PlayerPos, "pose" | "onGround" | "flying" | "inWater" | "sneaking" | "sprinting"> = {
    pose: "standing",
    onGround: true,
    flying: false,
    inWater: false,
    sneaking: false,
    sprinting: false,
  };
  private target = new Vector3();
  /** Where the player looks (the head), from the last sample, and the smoothed value shown. */
  private headYaw = 0;
  private pitch = 0;
  private viewYaw = 0;
  private viewPitch = 0;
  /** Where the body faces: the direction of travel, or the head once it has turned far enough. */
  private bodyYaw = 0;
  private speed = 0; // blocks per second, from the last two samples
  private lastSampleAt = 0;
  private texture: CanvasTexture | null = null;
  private disposed = false;

  /** @param decorate applied to every mesh material of the model (the scene patches fog into them). */
  constructor(
    public readonly name: string,
    skinUrl: string,
    decorate?: (material: Material) => void,
  ) {
    this.player.scale.setScalar(SCALE);
    if (decorate) {
      this.player.traverse((o) => {
        if ((o as Mesh).isMesh) decorate((o as Mesh).material as Material);
      });
    }
    this.player.position.y = FEET_OFFSET;
    this.player.skin.visible = false; // until a texture is bound; a bare model renders as garbage
    this.player.cape.visible = false;
    this.player.elytra.visible = false;
    this.group.add(this.player);
    this.walk.headBobbing = false; // the head follows the player's look instead
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
    this.texture = pixelTexture(canvas);
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
    if (this.lastSampleAt === 0) {
      this.bodyYaw = MathUtils.degToRad(p.yaw);
      this.viewYaw = this.bodyYaw;
      this.viewPitch = MathUtils.degToRad(p.pitch);
    }
    this.target = next;
    this.headYaw = MathUtils.degToRad(p.yaw);
    this.pitch = MathUtils.degToRad(p.pitch);
    this.last = {
      pose: p.pose ?? "standing",
      onGround: p.onGround ?? true,
      flying: p.flying ?? false,
      inWater: p.inWater ?? false,
      sneaking: p.sneaking || p.pose === "sneaking",
      sprinting: p.sprinting,
    };
    this.lastSampleAt = now;
    this.group.visible = !p.vanished;
  }

  /** Per frame: move towards the last sample, turn body and head, animate what the player is doing. */
  update(dt: number) {
    const k = Math.min(1, dt * LERP_PER_SECOND);
    this.viewYaw = wrap(this.viewYaw + wrap(this.headYaw - this.viewYaw) * k);
    this.viewPitch += (this.pitch - this.viewPitch) * k;
    const dx = this.target.x - this.group.position.x;
    const dz = this.target.z - this.group.position.z;
    this.group.position.lerp(this.target, k);
    const moving = this.speed > 0.3 && this.group.position.distanceTo(this.target) > 0.02;
    // The body faces the direction of travel while walking; standing still, it slowly follows the
    // head once the head has turned more than the game allows (like the player model in Minecraft).
    if (moving && dx * dx + dz * dz > 0.0004) {
      this.bodyYaw = wrap(this.bodyYaw + wrap(Math.atan2(-dx, dz) - this.bodyYaw) * k);
    } else {
      const off = wrap(this.viewYaw - this.bodyYaw);
      if (Math.abs(off) > HEAD_LIMIT) this.bodyYaw = wrap(this.bodyYaw + off * Math.min(1, dt * 3));
    }
    // Yaw 0 faces south (+z); the model faces +z at rotation 0, so the sign is inverted.
    this.group.rotation.y = -this.bodyYaw;
    const head = this.player.skin.head;
    if (!moving) this.speed *= 0.9;
    const motion = this.decideMotion(moving);
    this.animate(motion, dt);
    this.applySwimPose(motion, dt);
    // The animations own the limbs; the head is ours, set after them so the look wins.
    head.rotation.y = -MathUtils.clamp(wrap(this.viewYaw - this.bodyYaw), -HEAD_LIMIT, HEAD_LIMIT);
    head.rotation.x = MathUtils.clamp(this.viewPitch, -1.2, 1.2) + (motion === "sneak" ? -SNEAK_LEAN : 0);
  }

  private decideMotion(moving: boolean): Motion {
    const p = this.last;
    if (p.pose === "fall_flying") return "glide";
    if (p.pose === "swimming") return "swim"; // crawling on land is the same pose
    if (p.flying) return "fly";
    if (!p.onGround && !p.inWater) return "jump";
    if (p.sneaking) return "sneak";
    if (moving) return p.sprinting ? "run" : "walk";
    return "idle";
  }

  /** Runs the animation for the motion, starting from a clean pose whenever the motion changes. */
  private animate(motion: Motion, dt: number) {
    const player = this.player;
    if (motion !== this.motion) {
      this.motion = motion;
      this.resetPose();
      for (const a of [this.walk, this.run, this.idle, this.glide]) a.progress = 0;
    }
    const { leftArm, rightArm, leftLeg, rightLeg } = player.skin;
    switch (motion) {
      case "walk":
        this.walk.speed = Math.min(2.5, 0.5 + this.speed / 4);
        this.walk.update(player, dt);
        break;
      case "run":
        this.run.speed = Math.min(1.6, 0.6 + this.speed / 8);
        this.run.update(player, dt);
        break;
      case "sneak":
        player.rotation.x = SNEAK_LEAN;
        player.position.y = FEET_OFFSET - SNEAK_DROP * SCALE;
        if (this.speed > 0.3) {
          this.walk.speed = 0.8;
          this.walk.update(player, dt);
        }
        break;
      case "jump": {
        // Airborne: a frozen stride with the arms out a little.
        leftLeg.rotation.x = -0.35;
        rightLeg.rotation.x = 0.35;
        leftArm.rotation.x = -0.3;
        rightArm.rotation.x = -0.3;
        leftArm.rotation.z = 0.45;
        rightArm.rotation.z = -0.45;
        break;
      }
      case "swim": {
        // The crawl: arms circling in turn, legs kicking a little. The body itself is the pose's.
        this.stroke += dt * SWIM_STROKE_SPEED;
        leftArm.rotation.x = -(this.stroke % (2 * Math.PI));
        rightArm.rotation.x = -((this.stroke + Math.PI) % (2 * Math.PI));
        leftLeg.rotation.x = Math.sin(this.stroke * 2) * 0.3;
        rightLeg.rotation.x = -Math.sin(this.stroke * 2) * 0.3;
        break;
      }
      case "fly":
        // Creative flight: upright and still, leaning into the movement.
        player.rotation.x = this.speed > 0.3 ? 0.2 : 0;
        break;
      case "glide":
        this.glide.update(player, dt);
        break;
      default:
        this.idle.update(player, dt);
    }
  }

  /**
   * Lays the body down and lifts it to the water line by how far into the swimming pose it is,
   * easing in and out like the game, on top of whatever the limbs are doing.
   */
  private applySwimPose(motion: Motion, dt: number) {
    const step = dt / SWIM_EASE_SECONDS;
    this.swimAmount = MathUtils.clamp(this.swimAmount + (motion === "swim" ? step : -step), 0, 1);
    if (this.swimAmount === 0) return;
    const player = this.player;
    player.rotation.x = (this.swimAmount * Math.PI) / 2;
    player.position.y = FEET_OFFSET + (SWIM_LEVEL - FEET_OFFSET) * this.swimAmount;
  }

  /** Straightens everything an animation may have bent. */
  private resetPose() {
    const player = this.player;
    player.position.set(0, FEET_OFFSET, 0);
    player.rotation.set(0, 0, 0);
    for (const part of [player.skin.leftArm, player.skin.rightArm, player.skin.leftLeg, player.skin.rightLeg]) {
      part.rotation.set(0, 0, 0);
    }
  }

  /** The eyes, for a camera looking through them: 1.62 blocks up, 1.27 when sneaking (the game's values). */
  eye(out = new Vector3()): Vector3 {
    return out.copy(this.group.position).setY(this.group.position.y + (this.last.sneaking ? 1.27 : 1.62));
  }

  /** Where the player looks, smoothed like the head. */
  viewDirection(out = new Vector3()): Vector3 {
    return lookDirection(MathUtils.radToDeg(this.viewYaw), MathUtils.radToDeg(this.viewPitch), out);
  }

  /** The top of the head, where the name tag hangs from. */
  headTop(out = new Vector3()): Vector3 {
    return out.copy(this.group.position).setY(this.group.position.y + (this.last.sneaking ? 1.5 : 1.8));
  }

  /** Hidden while the camera sits in this player's eyes: the model would fill the view. */
  set firstPerson(on: boolean) {
    this.player.visible = !on;
  }

  dispose() {
    this.disposed = true;
    this.texture?.dispose();
    this.group.removeFromParent();
  }
}
