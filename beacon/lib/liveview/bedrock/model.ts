// A Bedrock geometry as one three.js SkinnedMesh: one draw call per model whatever the number of
// bones, the bones as a skeleton the animations move.
import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  type Euler,
  type Material,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  type Vector3,
} from "three";
import { buildBuffers, type Geometry, toModelPosition, toModelRotation } from "./geometry";

/** Units per block in a geometry file. */
export const MODEL_UNIT = 1 / 16;

export interface Model {
  mesh: SkinnedMesh;
  /** Every bone by name, at the file's rest pose. */
  bones: Map<string, Bone>;
  /** The rest pose, to start every frame's pose from. */
  rest: Map<string, { position: Vector3; rotation: Euler }>;
}

/** Builds the skinned mesh of a geometry. Scale the mesh (or its parent) by `MODEL_UNIT` to draw it in blocks. */
export function buildModel(geo: Geometry, material: Material): Model {
  const buffers = buildBuffers(geo);
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(buffers.positions, 3));
  g.setAttribute("uv", new BufferAttribute(buffers.uvs, 2));
  const n = buffers.boneIndex.length;
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    skinIndex[i * 4] = buffers.boneIndex[i];
    skinWeight[i * 4] = 1;
  }
  g.setAttribute("skinIndex", new Uint16BufferAttribute(skinIndex, 4));
  g.setAttribute("skinWeight", new BufferAttribute(skinWeight, 4));
  g.setIndex(new BufferAttribute(buffers.indices, 1));

  const mesh = new SkinnedMesh(g, material);
  const bones = new Map<string, Bone>();
  const rest: Model["rest"] = new Map();
  const pivots = new Map<string, [number, number, number]>();
  // Parents come before their children in the files; a bone's position is its pivot from its parent's.
  for (const def of geo.bones) {
    const bone = new Bone();
    bone.name = def.name;
    bone.rotation.order = "ZYX";
    const pivot = toModelPosition(def.pivot);
    const parentPivot = (def.parent && pivots.get(def.parent)) || [0, 0, 0];
    bone.position.set(pivot[0] - parentPivot[0], pivot[1] - parentPivot[1], pivot[2] - parentPivot[2]);
    const rotation = toModelRotation(def.rotation);
    bone.rotation.set(rotation[0], rotation[1], rotation[2]);
    ((def.parent && bones.get(def.parent)) || mesh).add(bone);
    bones.set(def.name, bone);
    pivots.set(def.name, pivot);
    rest.set(def.name, { position: bone.position.clone(), rotation: bone.rotation.clone() });
  }
  // The vertices are in model space; a bone's own frame is its pivot, so its inverse bind matrix
  // is the inverse of its rest world matrix, which `bind` takes from the current pose.
  mesh.updateMatrixWorld(true);
  mesh.bind(new Skeleton([...bones.values()]));
  mesh.frustumCulled = false; // the bounds would be the rest pose's; a bound player is cheap to draw anyway
  return { mesh, bones, rest };
}
