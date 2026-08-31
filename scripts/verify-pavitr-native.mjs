import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { SUITS } from '../lib/game-config.ts';
import { applySuitRestPose, normalizeSuit, suitAnimationClips } from '../lib/three-assets.ts';
import { AvatarAnimator } from '../lib/avatar-animation.ts';
import { PAVITR_SEGMENTS } from '../lib/pavitr-animation.ts';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(parser => { parser.loadTextureImage = () => Promise.resolve(new THREE.Texture()); return { name: 'CPUTextureStub' }; });
const bytes = await fs.readFile(new URL('../public/assets/suits/pavitr.glb', import.meta.url));
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const suit = SUITS.find(suit => suit.id === 'pavitr');
const canonical = name => name.toLowerCase().replace(/[^a-z0-9]/g, '');
function create() {
  const root = clone(gltf.scene), clips = suitAnimationClips(gltf.animations, suit);
  applySuitRestPose(root, suit, clips); normalizeSuit(root, suit);
  const holder = new THREE.Group(); holder.position.set(23, 120, -17); holder.rotation.y = .7; holder.add(root); holder.updateMatrixWorld(true);
  return { root, holder, animator: new AvatarAnimator(root, suit, clips), clips };
}
const test = create(), { animator } = test;
let samples = 0, provenance = 0;
const inverse = new THREE.Matrix4(), point = new THREE.Vector3();
function bodyMinimum() {
  test.holder.updateMatrixWorld(true); inverse.copy(test.holder.matrixWorld).invert();
  let min = Infinity;
  test.root.traverseVisible(mesh => {
    if (!(mesh instanceof THREE.Mesh)) return;
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
      min = Math.min(min, point.y);
    }
  });
  return min;
}
function advance(motion, seconds, expected) {
  const seen = new Set();
  for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) {
    animator.update(1 / 60, motion); seen.add(animator.activeClip);
    assert.deepEqual(test.holder.position.toArray(), [23, 120, -17], 'native motion moved the physics capsule');
    if (motion.grounded && frame % 4 === 0) {
      const floor = bodyMinimum(); samples++;
      assert.ok(floor > -.035, `native pose penetrated the floor by ${floor}: ${animator.activeClip} at frame ${frame}, support ${animator.supportMode}`);
      assert.ok(Math.abs(floor) < .15, `grounded native pose floated ${floor}: ${animator.activeClip}`);
    }
  }
  if (expected) assert.ok(seen.has(expected), `never selected ${expected}; saw ${[...seen].join(', ')}`);
  return seen;
}

// Every extracted section must evaluate to the source clip on this exact rig.
for (const [role, [suffix, start]] of Object.entries(PAVITR_SEGMENTS)) {
  const source = test.clips.find(clip => canonical(clip.name) === `armatureanimspidermanpavitr${suffix}`);
  const derived = animator.clips.find(clip => clip.name === `pavitr-native:${role}`);
  assert.ok(source && derived);
  for (const track of derived.tracks) {
    const original = source.tracks.find(item => item.name === track.name);
    assert.ok(original, `foreign bone track in ${role}`);
    const interpolant = original.InterpolantFactoryMethodLinear(), size = track.getValueSize();
    for (let i = 0; i < track.times.length; i++) {
      const expected = interpolant.evaluate(track.times[i] + start);
      if (track.name.endsWith('.quaternion')) {
        // q and -q encode the same rotation; exporter keys cross hemispheres.
        const actual = new THREE.Quaternion().fromArray(track.values, i * size).normalize();
        assert.ok(actual.angleTo(new THREE.Quaternion().fromArray(expected).normalize()) < .0015, `source rotation changed ${role}/${track.name}`);
        provenance += size;
        continue;
      }
      for (let component = 0; component < size; component++) {
        assert.ok(Math.abs(expected[component] - track.values[i * size + component]) < .001, `retargeted/distorted source keyframe ${role}/${track.name}`);
        provenance++;
      }
    }
  }
}
const entry = gltf.animations.find(clip => canonical(clip.name).endsWith('pavitrentry')).name;
advance({ pose: 'perch', grounded: true }, 3, entry);
assert.equal(animator.activeClip, 'rooftop-perch', 'entry did not finish into rooftop perch');
advance({ pose: 'jump', grounded: false, verticalSpeed: 12 }, .7, 'pavitr-native:leap');
advance({ pose: 'fall', grounded: false, verticalSpeed: -12 }, .6, 'pavitr-native:fall');
advance({ pose: 'perch', grounded: true }, 1.2, 'pavitr-native:landing');
for (const release of ['releaseFlip', 'releaseTurn']) {
  advance({ pose: 'swing', grounded: false, speed: 30, tension: .9 }, 2, 'pavitr-native:swing');
  const arm = animator.bones.find(entry => entry.role === 'leftArm').bone;
  const before = arm.quaternion.clone();
  advance({ pose: 'swing', grounded: false, speed: 30, tension: .9 }, .4);
  assert.ok(before.angleTo(arm.quaternion) > .03, 'native swing frozen');
  advance({ pose: 'jump', grounded: false, verticalSpeed: 16 }, .3, `pavitr-native:${release}`);
  advance({ pose: 'fall', grounded: false, verticalSpeed: -1 }, .3, `pavitr-native:${release}`);
  // Crossing the apex must not restart a flip or leave it playing forever.
  advance({ pose: 'fall', grounded: false, verticalSpeed: -8 }, 1.4, 'pavitr-native:fall');
  advance({ pose: 'perch', grounded: true }, 1.2, 'pavitr-native:landing');
}
advance({ pose: 'zip', grounded: false, speed: 50 }, .5, 'pavitr-native:zip');
advance({ pose: 'jump', grounded: false, verticalSpeed: 30 }, 2, 'pavitr-native:fall');
assert.equal(animator.activeClip, 'pavitr-native:fall', 'completed release restarted a takeoff animation');
advance({ pose: 'crawl', grounded: false, speed: 4 }, .4, 'local-wall-crawl');
advance({ pose: 'jump', grounded: false, verticalSpeed: 12 }, .5, 'pavitr-native:leap');
advance({ pose: 'dive', grounded: false, verticalSpeed: -40 }, .8, 'pavitr-native:dive');
advance({ pose: 'idle', grounded: true }, .2, 'pavitr-native:landing');
advance({ pose: 'run', grounded: true, speed: 10 }, .4, 'procedural:run');
assert.equal(animator.activeClip, 'procedural:run', 'landing stole movement controls');

const lobby = create(), seen = new Set();
for (let i = 0; i < 40 * 30; i++) { lobby.animator.update(1 / 30, { pose: 'idle', grounded: true, lobby: true }); seen.add(lobby.animator.activeClip); }
for (const suffix of ['entry', 'shellfidget', 'fidgetvictoryin', 'passive']) assert.ok([...seen].some(name => canonical(name).endsWith(suffix)), `lobby never plays ${suffix}`);
assert.ok(![...seen].some(name => name.startsWith('procedural:')), 'lobby replaced a native action');
const interrupted = create();
interrupted.animator.update(.1, { pose: 'perch', grounded: true });
interrupted.animator.update(.2, { pose: 'jump', grounded: false });
assert.equal(interrupted.animator.activeClip, 'pavitr-native:leap', 'spawn intro blocked jump');
interrupted.animator.update(3, { pose: 'idle', grounded: true });
interrupted.animator.update(.05, { pose: 'idle', grounded: true, lobby: true });
assert.equal(interrupted.animator.activeClip, entry, 'selecting Pavitr did not replay his native entry');
console.log(`PASS: Pavitr native entry, lobby, leap, two release acrobatics, swing, zip, fall, dive, landing and interruptible transitions; ${samples} full-mesh grounded poses; ${provenance} source-value comparisons.`);
