// Posing a Bedrock model's bones: every frame starts from the file's rest pose, animations add
// rotations (in the file's degrees) and position offsets (in the file's units) to named bones, and
// the result is written to the skeleton once. The sign conventions of the mirrored model space are
// applied here, so the animations read like the pack's own tables.
import { MathUtils } from "three";
import type { Model } from "./model";

interface Part {
  bone: Model["bones"] extends Map<string, infer B> ? B : never;
  rest: NonNullable<ReturnType<Model["rest"]["get"]>>;
  rx: number;
  ry: number;
  rz: number;
  px: number;
  py: number;
  pz: number;
}

export class Pose {
  private readonly parts = new Map<string, Part>();

  constructor(model: Model) {
    for (const [name, bone] of model.bones) {
      const rest = model.rest.get(name);
      if (rest) this.parts.set(name, { bone, rest, rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0 });
    }
  }

  /** A new frame: nothing added yet. */
  begin() {
    for (const p of this.parts.values()) p.rx = p.ry = p.rz = p.px = p.py = p.pz = 0;
  }

  /** Adds a rotation in the file's degrees; a bone the model lacks is ignored. */
  rotate(name: string, x: number, y: number, z: number) {
    const p = this.parts.get(name);
    if (!p) return;
    p.rx += x;
    p.ry += y;
    p.rz += z;
  }

  /** Adds a position offset in the file's units. */
  move(name: string, x: number, y: number, z: number) {
    const p = this.parts.get(name);
    if (!p) return;
    p.px += x;
    p.py += y;
    p.pz += z;
  }

  /** Writes the frame to the bones: rest plus what was added, x and y rotations and x offsets flipped for the mirrored space. */
  commit() {
    const d = MathUtils.DEG2RAD;
    for (const p of this.parts.values()) {
      const { rest, bone } = p;
      bone.rotation.set(rest.rotation.x - p.rx * d, rest.rotation.y - p.ry * d, rest.rotation.z + p.rz * d);
      bone.position.set(rest.position.x - p.px, rest.position.y + p.py, rest.position.z + p.pz);
    }
  }
}
