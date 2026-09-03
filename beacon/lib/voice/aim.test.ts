import assert from "node:assert/strict";
import { test } from "node:test";
import { aim, CONSCIENCE_DISTANCE, type SpeakStage, type SpeakTargetKind } from "./aim.ts";
import { SPEAK_ENTITY, SPEAK_LOCATIONAL, SPEAK_STATIC } from "./frames.ts";

function stage(kind: SpeakTargetKind, uuid: string | null = "u-1"): SpeakStage {
  return {
    worldName: "world",
    speakTarget(out) {
      out[0] = 10;
      out[1] = 70;
      out[2] = -5;
      return kind;
    },
    followedUuid: () => uuid,
    setEmitter() {},
    clearEmitter() {},
  };
}

const out = new Float32Array(3);

test("fly and orbit: a locational voice at the camera with the chosen reach, capped by the server", () => {
  const a = aim(stage("camera"), { target: "auto", radius: "16" }, 48, out);
  assert.deepEqual(a?.head, {
    mode: SPEAK_LOCATIONAL,
    whisper: false,
    distance: 16,
    world: "world",
    x: 10,
    y: 70,
    z: -5,
  });
  assert.deepEqual(a?.marker, { x: 10, y: 70, z: -5, radius: 16 });
  assert.equal(aim(stage("camera"), { target: "auto", radius: "max" }, 48, out)?.head.distance, 48);
  assert.equal(aim(stage("camera"), { target: "auto", radius: "32" }, 24, out)?.head.distance, 24);
});

test("player mode: the followed player's entity channel, whispered from up close", () => {
  const a = aim(stage("entity"), { target: "auto", radius: "max" }, 48, out);
  assert.deepEqual(a?.head, { mode: SPEAK_ENTITY, whisper: true, distance: CONSCIENCE_DISTANCE, uuid: "u-1" });
  assert.equal(a?.marker?.radius, CONSCIENCE_DISTANCE);
  assert.equal(aim(stage("entity", null), { target: "auto", radius: "max" }, 48, out), null);
});

test("everyone: the static channel, drawn at the point when there is one", () => {
  const a = aim(stage("camera"), { target: "everyone", radius: "8" }, 48, out);
  assert.deepEqual(a?.head, { mode: SPEAK_STATIC, whisper: false, distance: 0 });
  assert.deepEqual(a?.marker, { x: 10, y: 70, z: -5, radius: 0 });
  assert.deepEqual(aim(stage("none"), { target: "everyone", radius: "8" }, 48, out)?.marker, null);
});

test("nowhere to speak from", () => {
  assert.equal(aim(stage("none"), { target: "auto", radius: "max" }, 48, out), null);
});
