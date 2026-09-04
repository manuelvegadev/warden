// A player in the scene: the game's own humanoid geometry (from the Bedrock resource pack, see
// lib/liveview/bedrock) with the Mojang skin on it, posed every frame from what the agent says the
// player is doing with the pack's own animations. Positions arrive at 5 Hz and are interpolated.
// The name tag is not here: it is an HTML layer over the canvas that the scene positions from the
// head each frame.

import { inferModelType, loadImage, loadSkinToCanvas } from "skinview-utils";
import { type CanvasTexture, Group, type Material, MathUtils, MeshBasicMaterial, Vector3 } from "three";
import type { PlayerPos } from "@/lib/api";
import { loadGeometry, loadGeometryFile } from "./bedrock/assets";
import { buildModel, MODEL_UNIT, type Model } from "./bedrock/model";
import { type Motion, PlayerPose } from "./bedrock/player-pose";
import { lookDirection } from "./camera";
import { EYE_HEIGHT, EYE_HEIGHT_SNEAKING } from "./constants";
import { pixelTexture } from "./texture";

/** The player's geometries: the classic (Steve) and slim (Alex) arms, where the pack keeps each. */
const CLASSIC = { file: "bedrock/models/entity/humanoid.custom.geo.json", id: "geometry.humanoid.custom" };
const SLIM = { file: "bedrock/models/mobs.json", id: "geometry.humanoid.customSlim" };
/** The pack draws the player at 0.9375 of the model's 32 units: 1.875 blocks, the game's height. */
const PLAYER_SCALE = 0.9375;
const LERP_PER_SECOND = 8;
/** How far the head may turn from the body before the body follows (Minecraft: 75°). */
const HEAD_LIMIT = MathUtils.degToRad(75);
/** Wraps an angle to (-π, π]. */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Avatar {
  readonly group = new Group();
  /** The player's UUID from the last sample; what the voice receiver keys speakers by. */
  uuid = "";
  /** The model, once the geometry and the skin have arrived. */
  private model: Model | null = null;
  private pose: PlayerPose | null = null;
  private readonly material = new MeshBasicMaterial({ alphaTest: 0.5 });
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
  private hidden = false;
  private disposed = false;

  /** @param decorate applied to the model's material (the scene patches fog into it). */
  constructor(
    public readonly name: string,
    skinUrl: string,
    decorate?: (material: Material) => void,
  ) {
    decorate?.(this.material);
    void this.load(skinUrl);
  }

  /** The skin decides the geometry (slim or classic arms); both files are asked for meanwhile, once per page. */
  private async load(url: string) {
    void loadGeometryFile(CLASSIC.file).catch(() => {});
    void loadGeometryFile(SLIM.file).catch(() => {});
    const canvas = document.createElement("canvas");
    let slim = false;
    try {
      const img = await loadImage({ src: url, crossOrigin: "use-credentials" });
      loadSkinToCanvas(canvas, img);
      slim = inferModelType(canvas) === "slim";
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
    const which = slim ? SLIM : CLASSIC;
    const geometry = await loadGeometry(which.file, which.id).catch((e) => {
      console.warn("live view: the player geometry is missing (run `pnpm mc:assets`)", e);
      return null;
    });
    if (!geometry || this.disposed) return;
    this.texture = pixelTexture(canvas);
    this.material.map = this.texture;
    const model = buildModel(geometry, this.material);
    model.mesh.scale.setScalar(MODEL_UNIT * PLAYER_SCALE);
    // The geometry faces north (−z); yaw 0 in the game faces south, so the body turns from there.
    model.mesh.rotation.y = Math.PI;
    model.mesh.layers.mask = this.group.layers.mask; // marked for the outline like the group was
    model.mesh.visible = !this.hidden;
    this.model = model;
    this.pose = new PlayerPose(model);
    this.group.add(model.mesh);
  }

  /** New sample from the server. */
  setPosition(p: PlayerPos, now: number) {
    this.uuid = p.uuid;
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
    // The game's yaw grows clockwise seen from above; a rotation about +y grows the other way.
    this.group.rotation.y = -this.bodyYaw;
    if (!moving) this.speed *= 0.9;
    this.pose?.update(
      {
        motion: this.decideMotion(moving),
        speed: this.speed,
        pitch: MathUtils.radToDeg(MathUtils.clamp(this.viewPitch, -1.2, 1.2)),
        headYaw: MathUtils.radToDeg(MathUtils.clamp(wrap(this.viewYaw - this.bodyYaw), -HEAD_LIMIT, HEAD_LIMIT)),
      },
      dt,
    );
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

  /** The eyes, for a camera looking through them and for the voice. */
  eye(out = new Vector3()): Vector3 {
    return out
      .copy(this.group.position)
      .setY(this.group.position.y + (this.last.sneaking ? EYE_HEIGHT_SNEAKING : EYE_HEIGHT));
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
    this.hidden = on;
    if (this.model) this.model.mesh.visible = !on;
  }

  dispose() {
    this.disposed = true;
    this.texture?.dispose();
    this.material.dispose();
    this.model?.mesh.geometry.dispose();
    this.group.removeFromParent();
  }
}
