// The player's animations, as the game's Bedrock resource pack writes them
// (animations/player.animation.json), applied to the humanoid skeleton every frame. The pack states
// them as Molang expressions over the game's queries; this is the same arithmetic over the values
// the scene knows: how far the player has walked, how fast, how long they have been here, and what
// they are doing. Angles are the file's degrees; `Pose` converts them.
import { MathUtils } from "three";
import { TICKS_PER_SECOND } from "../constants";
import type { Model } from "./model";
import { Pose } from "./pose";

/** What a player is doing, from the agent's pose flags and the speed of the last samples. */
export type Motion = "idle" | "walk" | "run" | "sneak" | "jump" | "swim" | "fly" | "glide";

/** What the scene knows each frame. */
export interface PlayerState {
  motion: Motion;
  /** Blocks per second over the ground. */
  speed: number;
  /** Head pitch in degrees, the game's sign (down is positive). */
  pitch: number;
  /** Head yaw relative to the body, degrees, the game's sign. */
  headYaw: number;
}

/**
 * The game's walk: the swing amount is the distance moved per tick times four, capped at 1, eased
 * at 0.4 a tick; the swing itself grows by the amount every tick.
 */
const SWING_EASE = 0.4;
/** The game's stride: 38.17° of phase per unit of limb swing, 0.6662 radians. */
const STRIDE = 38.17;
/** The idle arm sway: 103.2° a second, a little under 3° of amplitude. */
const SWAY_SPEED = 103.2;
const SWAY = 2.865;
/** The game eases in and out of the swimming pose over about half a second. */
const SWIM_EASE_SECONDS = 0.55;
const cosDeg = (deg: number) => Math.cos(deg * MathUtils.DEG2RAD);
const sinDeg = (deg: number) => Math.sin(deg * MathUtils.DEG2RAD);

/** The swimming stroke, `animation.player.swim`: the left arm's rotation over a 1.3 s loop; the right mirrors its z. */
const SWIM_LENGTH = 1.3;
const SWIM_ARM: [number, [number, number, number]][] = [
  [0, [0, 180, 180]],
  [0.7, [0, 180, 287.2]],
  [1.1, [90, 180, 180]],
  [1.3, [0, 180, 180]],
];

/** Linear interpolation through keyframes that loop every `SWIM_LENGTH` seconds. */
function keyframes(track: [number, [number, number, number]][], t: number, out: [number, number, number]) {
  const time = ((t % SWIM_LENGTH) + SWIM_LENGTH) % SWIM_LENGTH;
  for (let i = 1; i < track.length; i++) {
    const [t0, a] = track[i - 1];
    const [t1, b] = track[i];
    if (time <= t1) {
      const k = t1 === t0 ? 0 : (time - t0) / (t1 - t0);
      out[0] = MathUtils.lerp(a[0], b[0], k);
      out[1] = MathUtils.lerp(a[1], b[1], k);
      out[2] = MathUtils.lerp(a[2], b[2], k);
      return;
    }
  }
}

/**
 * Poses a humanoid model from what the player is doing, keeping the game's animation state (limb
 * swing, swim amount, time alive) between frames.
 */
export class PlayerPose {
  private readonly pose: Pose;
  private limbSwing = 0;
  private limbAmount = 0;
  private lifeTime = 0;
  private swimAmount = 0;
  private swimTime = 0;
  private lean = 0;
  private readonly arm: [number, number, number] = [0, 0, 0];

  constructor(model: Model) {
    this.pose = new Pose(model);
  }

  /** Advances the animation state by `dt` seconds and writes the frame's pose. */
  update(s: PlayerState, dt: number) {
    const m = s.motion;
    this.lifeTime += dt;
    // The game's limb swing: eased towards how fast the feet move, frozen in the air.
    if (m !== "jump") {
      const ticks = dt * TICKS_PER_SECOND;
      const feet = m === "walk" || m === "run" || m === "sneak" || m === "fly";
      const target = feet ? Math.min(1, (s.speed / TICKS_PER_SECOND) * 4) : 0;
      this.limbAmount += (target - this.limbAmount) * Math.min(1, SWING_EASE * ticks);
      this.limbSwing += this.limbAmount * ticks;
    }
    const swimStep = dt / SWIM_EASE_SECONDS;
    this.swimAmount = MathUtils.clamp(this.swimAmount + (m === "swim" ? swimStep : -swimStep), 0, 1);
    if (m === "swim") this.swimTime += dt;
    this.lean += ((m === "fly" && s.speed > 0.3 ? 1 : 0) - this.lean) * Math.min(1, dt * 4);

    const p = this.pose;
    p.begin();
    const swimming = this.swimAmount > 0;
    // move.arms / move.legs: the stride.
    const tcos0 = cosDeg(this.limbSwing * STRIDE) * this.limbAmount * 57.3;
    if (!swimming) {
      p.rotate("leftArm", tcos0, 0, 0);
      p.rotate("rightArm", -tcos0, 0, 0);
      p.rotate("leftLeg", tcos0 * -1.4, -0.1, -0.1);
      p.rotate("rightLeg", tcos0 * 1.4, 0.1, 0.1);
    }
    // bob: the arms sway out a little all the time.
    const sway = cosDeg(this.lifeTime * SWAY_SPEED) * SWAY + SWAY;
    p.rotate("leftArm", 0, 0, -sway);
    p.rotate("rightArm", 0, 0, sway);
    if (m === "jump" && !swimming) {
      // In the air the stride freezes and the arms open a touch.
      p.rotate("leftArm", -17, 0, 25);
      p.rotate("rightArm", -17, 0, -25);
    }
    if (m === "sneak" && !swimming) {
      // sneaking: the body drops and leans, the legs fold under it.
      p.move("body", 0, -2, 0);
      p.move("head", 0, -1, 0);
      p.rotate("leftArm", -5.7, 0, 0);
      p.rotate("rightArm", -5.7, 0, 0);
      p.rotate("leftLeg", -28, -0.1, -0.1);
      p.rotate("rightLeg", -28, 0.1, 0.1);
      p.move("root", 0, 1.25, 9);
      p.rotate("root", 28, 0, 0);
    }
    if (swimming) {
      // swim: the body lies along the gaze, the arms take turns, the legs kick.
      const a = this.swimAmount;
      const arm = this.arm;
      keyframes(SWIM_ARM, this.swimTime, arm);
      p.rotate("leftArm", arm[0] * a, arm[1] * a, arm[2] * a);
      p.rotate("rightArm", arm[0] * a, arm[1] * a, -arm[2] * a);
      p.rotate("leftLeg", cosDeg(this.lifeTime * 390 + 180) * 17.2 * a, -0.1, -0.1);
      p.rotate("rightLeg", cosDeg(this.lifeTime * 390) * 17.2 * a, 0.1, 0.1);
      p.move("root", 0, (sinDeg(s.pitch) * 17 + 5) * a, cosDeg(s.pitch) * 17 * a);
      p.rotate("root", a * (90 + s.pitch), 0, 0);
    } else if (m === "glide") {
      // Gliding: stretched out along the flight, the arms back along the body.
      p.rotate("root", 90 + s.pitch, 0, 0);
      p.move("root", 0, 12, 0);
      p.rotate("leftArm", 170, 0, -8);
      p.rotate("rightArm", 170, 0, 8);
    } else if (m === "fly") {
      p.rotate("root", 11 * this.lean, 0, 0);
    }
    // look_at_target: the head follows the gaze; the body has already turned as far as it will.
    p.rotate("head", s.pitch, s.headYaw, 0);
    p.commit();
  }
}
