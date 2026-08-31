import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { SUITS } from '../lib/game-config.ts';
import { suitAnimationClips, applySuitRestPose, normalizeSuit } from '../lib/three-assets.ts';
import { AvatarAnimator } from '../lib/avatar-animation.ts';
import { IRONMAN_SEGMENTS } from '../lib/ironman-animation.ts';
import { IronManRepulsors } from '../lib/ironman-repulsors.ts';
import { updateIronFlight } from '../lib/ironman-flight.ts';
import { createTraversalState, stepTraversalInPlace } from '../lib/traversal-physics.ts';

const loader = new GLTFLoader();
loader.register(parser => { parser.loadTextureImage = () => Promise.resolve(new THREE.Texture()); return { name: 'TextureStub' }; });
const suit = SUITS.find(suit => suit.id === 'ironman');
const bytes = await fs.readFile(new URL(`../public${suit.model}`, import.meta.url));
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
assert.equal(gltf.animations.length, 36, 'new animation pack missing');
function create() {
  const root = clone(gltf.scene), clips = suitAnimationClips(gltf.animations, suit);
  applySuitRestPose(root, suit, clips); normalizeSuit(root, suit);
  const holder = new THREE.Group(); holder.rotation.order = 'YXZ'; holder.position.set(8, 30, 2); holder.add(root); holder.updateMatrixWorld(true);
  const animator = new AvatarAnimator(root, suit, clips), effects = new IronManRepulsors(holder, animator.bones);
  return { root, holder, clips, animator, effects };
}
const test = create();
assert.equal(test.animator.bones.length, 20, 'all anatomical joints must map');
assert.equal(test.effects.emitters.length, 4, 'missing palms or boots');
for (const source of gltf.animations) {
  const runtime = test.animator.clips.find(clip => clip.name === source.name);
  assert.ok(runtime, `discarded ${source.name}`);
  if (source.duration < .15) continue;
  for (const track of source.tracks.filter(track => track.name.endsWith('.quaternion'))) {
    assert.deepEqual(runtime.tracks.find(item => item.name === track.name)?.values, track.values, `rewrote native rotation ${source.name}/${track.name}`);
  }
}
let sourceChecks = 0, poses = 0;
for (const [role, [name, start]] of Object.entries(IRONMAN_SEGMENTS)) {
  const source = test.clips.find(clip => clip.name === name), derived = test.animator.clips.find(clip => clip.name === `ironman-native:${role}`);
  for (const track of derived.tracks) {
    const original = source.tracks.find(item => item.name === track.name);
    assert.ok(original, `foreign track ${track.name}`);
    const interpolate = original.InterpolantFactoryMethodLinear(), size = track.getValueSize();
    for (let i = 0; i < track.times.length; i++) {
      const expected = interpolate.evaluate(track.times[i] + start);
      if (track.name.endsWith('.quaternion')) {
        assert.ok(new THREE.Quaternion().fromArray(track.values, i * size).normalize().angleTo(new THREE.Quaternion().fromArray(expected).normalize()) < .0015);
      } else for (let j = 0; j < size; j++) assert.ok(Math.abs(expected[j] - track.values[i * size + j]) < .001);
      sourceChecks++;
    }
  }
}
const v = new THREE.Vector3();
function bounds(root) {
  const box = new THREE.Box3(); root.updateMatrixWorld(true);
  root.traverseVisible(mesh => {
    if (!(mesh instanceof THREE.SkinnedMesh)) return;
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) box.expandByPoint(mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld));
  });
  return box;
}
function advance(motion, seconds, expected = [], target = test) {
  const seen = new Set();
  for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) {
    target.animator.update(1 / 60, motion); seen.add(target.animator.activeClip);
    target.holder.rotation.x = motion.pose === 'fly' ? -1.1 * target.animator.cruiseBlend : 0;
    target.effects.update(['hover', 'fly'].includes(motion.pose) && !motion.grounded, motion.speed ?? 0, motion.boost ?? false, frame / 60);
    assert.deepEqual(target.holder.position.toArray(), [8, 30, 2], 'clip moved physics position');
    if (frame % 5 === 0) {
      const box = bounds(target.root); poses++;
      assert.ok([...box.min, ...box.max].every(Number.isFinite), 'non-finite rendered bounds');
      assert.ok(box.getSize(v).length() < 4.5, 'source root motion escaped the avatar');
      if (motion.grounded) {
        assert.ok(box.min.y >= 29.97 && box.min.y < 30.04, `ground contact ${box.min.y}: ${target.animator.activeClip}`);
      }
      for (const emitter of target.effects.emitters) {
        if (!emitter.group.visible) continue;
        const actual = emitter.group.getWorldPosition(new THREE.Vector3()), joint = emitter.bone.getWorldPosition(new THREE.Vector3());
        assert.ok(Math.abs(actual.distanceTo(joint) - (emitter.foot ? .12 : .07)) < .001, 'repulsor drifted from animated joint');
      }
    }
  }
  for (const name of expected) assert.ok(seen.has(name), `missing ${name}; saw ${[...seen].join(', ')}`);
  return seen;
}
advance({ pose: 'idle', grounded: true }, 2, ['menu_idle']);
advance({ pose: 'hover', grounded: false }, 2, ['ironman-native:coil', 'ironman-native:rise', 'ironman-native:ignite', 'fly_idle']);
advance({ pose: 'fly', grounded: false, speed: 52 }, 2, ['fly_fast']);
const point = role => test.animator.bones.find(entry => entry.role === role).bone.getWorldPosition(new THREE.Vector3());
const forwardUp = point('head').sub(point('hips')).normalize();
assert.ok(forwardUp.z < -.8 && forwardUp.y > -.1, `cruise is not forward/horizontal: ${forwardUp.toArray().join(',')}`);
for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
  test.holder.rotation.y = yaw; test.holder.updateMatrixWorld(true);
  const heading = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  assert.ok(point('head').sub(point('hips')).normalize().dot(heading) > .8, 'flight pitch is not local to heading');
}
test.holder.rotation.y = 0;
advance({ pose: 'fly', grounded: false, speed: 72, boost: true }, 1, ['ironman-native:redirect', 'fly_fast']);
advance({ pose: 'fall', grounded: false }, 2, ['ironman-native:tuck', 'ironman-native:drift']);
assert.ok(test.effects.emitters.every(emitter => !emitter.group.visible), 'power-cut left jets active');
advance({ pose: 'hover', grounded: false }, 1, ['ironman-native:boost', 'ironman-native:ignite', 'fly_idle']);
advance({ pose: 'hover', grounded: false, speed: 12 }, 1, ['fly_slow']);
advance({ pose: 'fall', grounded: false }, .5);
advance({ pose: 'idle', grounded: true }, 1, ['ironman-native:landing', 'menu_idle']);
advance({ pose: 'fall', grounded: false }, .4);
advance({ pose: 'idle', grounded: true }, .1, ['ironman-native:landing']);
advance({ pose: 'run', grounded: true, speed: 10 }, .5, ['procedural:run']);
advance({ pose: 'jump', grounded: false }, .6, ['jump_start']);
const lobby = create(); advance({ pose: 'idle', grounded: true, lobby: true }, 19, ['menu_goodbye', 'menu_action', 'menu_idle'], lobby);
const cancelled = create(); advance({ pose: 'hover', grounded: false }, .1, ['ironman-native:coil'], cancelled);
advance({ pose: 'fall', grounded: false }, 1, ['ironman-native:tuck', 'ironman-native:drift'], cancelled);
assert.ok(!cancelled.animator.activeClip.includes('rise'), 'cancelled launch kept playing');

// Controls and the same collision solver used by the game: no animation moves the capsule.
const input = { hoverToggle: false, cruiseToggle: false, ascend: false, descend: false, boost: false, aim: { x: 0, y: 0, z: -1 } };
const body = { grounded: true, velocity: { x: 0, y: 0, z: 0 } };
assert.equal(updateIronFlight('grounded', body, { ...input, descend: true }, 1 / 60), 'grounded');
assert.equal(body.grounded, true, 'Shift launched a grounded hero');
let mode = updateIronFlight('grounded', body, { ...input, hoverToggle: true }, 1 / 60);
assert.equal(mode, 'hover'); assert.ok(body.velocity.y > 8);
for (let i = 0; i < 300; i++) mode = updateIronFlight(mode, body, input, 1 / 60);
assert.ok(Math.abs(body.velocity.y) < 1e-8, 'hover did not stabilize');
mode = updateIronFlight(mode, body, { ...input, cruiseToggle: true, ascend: true }, 1 / 60);
assert.equal(mode, 'cruise', 'Space cancelled cruise');
mode = updateIronFlight(mode, body, { ...input, hoverToggle: true, ascend: true }, 1 / 60);
assert.equal(mode, 'freefall');
mode = updateIronFlight(mode, body, { ...input, ascend: true }, 1 / 60);
assert.equal(mode, 'freefall', 'stale held Space reignited after power-off');
assert.equal(updateIronFlight(mode, body, { ...input, ascend: true, ascendPressed: true }, 1 / 60), 'hover');
const state = createTraversalState({ x: 0, y: 20, z: 0 }); state.grounded = false;
let flight = 'cruise';
const wall = { min: { x: -30, y: 0, z: -12 }, max: { x: 30, y: 60, z: -10 } };
for (let i = 0; i < 180; i++) {
  flight = updateIronFlight(flight, state, { ...input, boost: true }, 1 / 60);
  stepTraversalInPlace(state, {}, { groundY: 0, colliders: [wall] }, 1 / 60, { gravity: 0, maximumSpeed: 92 });
  assert.ok(state.position.z > -10, 'boost tunnelled through wall');
}
console.log(`PASS: 36 retained source clips, ${sourceChecks} source curve samples, ${poses} full-mesh pose checks; chained takeoff/boost/hover/cruise/cut/recovery/landing; four tracked repulsors; controls and boost collision.`);
