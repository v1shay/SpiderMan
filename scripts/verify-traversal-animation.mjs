import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { SUITS } from '../lib/game-config.ts';
import { AvatarAnimator } from '../lib/avatar-animation.ts';
import { PAVITR_SEGMENTS } from '../lib/pavitr-animation.ts';
import { applySuitRestPose, boneRole, normalizeSuit, retargetMixamoClips, suitAnimationClips } from '../lib/three-assets.ts';

// Real GLBs, actual skinning and runtime animation graph; only texture decode
// is stubbed for this CPU regression. Browser appearance/performance is separate.
// Run: node --experimental-strip-types scripts/verify-traversal-animation.mjs
const filter = process.argv.find(arg => arg.startsWith('--suit='))?.slice(7);
const suits = SUITS.filter(suit => suit.traversal === 'spider' && (!filter || suit.id === filter));
assert.ok(suits.length, `No Spider-Man suit matches ${filter ?? 'the roster'}`);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(parser => {
  parser.loadTextureImage = () => Promise.resolve(new THREE.Texture());
  return { name: 'TraversalAnimationTextureStub' };
});
const cache = new Map();
async function load(model) {
  if (!cache.has(model)) cache.set(model, (async () => {
    const data = await fs.readFile(new URL(`../public${model}`, import.meta.url));
    return loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
  })());
  return cache.get(model);
}

const failures = new Set();
let checks = 0;
function check(condition, message) { checks++; if (!condition) failures.add(message); }
const canonical = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const isRun = value => /(?:proceduralrun|runaboveground|bullywalking|crouchedwalking|run|walk)$/.test(canonical(value));
const point = new THREE.Vector3();
const inverse = new THREE.Matrix4();
const fixedStep = 1 / 60;

async function prepare(suit) {
  const original = await load(suit.model);
  const root = clone(original.scene);
  const clips = suitAnimationClips(original.animations, suit);
  applySuitRestPose(root, suit, clips);
  if (suit.animationSource && suit.animationSource !== suit.model) {
    const library = await load(suit.animationSource);
    clips.push(...retargetMixamoClips(library.animations, library.scene, root));
  }
  normalizeSuit(root, suit, 2.05);
  const holder = new THREE.Group();
  holder.position.set(13, 89.25, -31);
  holder.rotation.y = .73;
  holder.add(root);
  holder.updateMatrixWorld(true);
  const animator = new AvatarAnimator(root, suit, clips);
  const resets = new Map();
  for (const clip of animator.clips) {
    const action = animator.mixer.existingAction(clip);
    if (!action) continue;
    const reset = action.reset.bind(action);
    action.reset = (...args) => {
      resets.set(clip, (resets.get(clip) ?? 0) + 1);
      return reset(...args);
    };
  }
  const feet = [];
  root.traverseVisible(mesh => {
    if (!(mesh instanceof THREE.SkinnedMesh)) return;
    const joints = mesh.geometry.getAttribute('skinIndex');
    const weights = mesh.geometry.getAttribute('skinWeight');
    if (!joints || !weights) return;
    const indices = [];
    for (let index = 0; index < joints.count; index++) {
      let weight = 0;
      for (let slot = 0; slot < 4; slot++) {
        if (boneRole(mesh.skeleton.bones[joints.getComponent(index, slot)].name).endsWith('Foot')) {
          weight += weights.getComponent(index, slot);
        }
      }
      if (weight > .35) indices.push(index);
    }
    if (indices.length) feet.push({ mesh, indices });
  });
  return { suit, original, root, holder, animator, resets, feet, base: root.position.clone(), position: holder.position.clone(), phaseClips: {} };
}

const resetCount = test => [...test.resets.values()].reduce((sum, count) => sum + count, 0);
function inspect(test, motion, phase, frame) {
  const prefix = `${test.suit.id}/${phase}`;
  test.holder.updateMatrixWorld(true);
  check(test.holder.position.distanceTo(test.position) < 1e-9, `${prefix}: animation moved controller`);
  check(Math.abs(test.root.position.x - test.base.x) < 1e-9 && Math.abs(test.root.position.z - test.base.z) < 1e-9,
    `${prefix}: root-motion escaped horizontally`);
  check(Number.isFinite(test.animator.contactError), `${prefix}: non-finite contact error`);
  const hand = test.animator.webHand(point);
  check(hand.toArray().every(Number.isFinite), `${prefix}: non-finite real web hand`);
  if (!motion.grounded) {
    check(!isRun(test.animator.activeClip), `${prefix}: running selected while airborne`);
    check(Math.abs(test.root.position.y - test.base.y) < 1e-9, `${prefix}: grounding correction leaked into air`);
    // A brief outgoing gait crossfade is intentional; it must be completely
    // gone after the .16s blend, even when upstream still sends pose='run'.
    if (frame >= 12) {
      for (const clip of test.animator.clips) {
        if (!isRun(clip.name)) continue;
        const action = test.animator.mixer.existingAction(clip);
        check(!action?.isRunning() || action.getEffectiveWeight() < .001, `${prefix}: airborne gait contribution outlived transition`);
      }
    }
  }
  if (frame % 12 === 0) {
    test.root.traverse(object => {
      check([...object.position, ...object.quaternion, ...object.scale, ...object.matrixWorld.elements].every(Number.isFinite),
        `${prefix}: non-finite transform on ${object.name}`);
      check(Math.abs(object.quaternion.lengthSq() - 1) < .025, `${prefix}: non-unit rotation on ${object.name}`);
    });
    if (motion.grounded) {
      inverse.copy(test.holder.matrixWorld).invert();
      let sole = Infinity;
      // Independent complete shoe-vertex check, not the animator's probes.
      for (const { mesh, indices } of test.feet) for (const index of indices) {
        mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
        sole = Math.min(sole, point.y);
      }
      check(Number.isFinite(sole), `${prefix}: no finite actual soles`);
      check(Math.abs(test.animator.contactError) < .001, `${prefix}: unresolved contact correction`);
      if (test.animator.supportMode === 'soles') check(Math.abs(sole) < .04, `${prefix}: actual feet miss floor by ${sole.toFixed(4)}m`);
      else check(sole >= -.04, `${prefix}: feet penetrate while native hand/body support is active`);
    }
  }
}

function advance(test, name, motion, frames) {
  for (let frame = 0; frame < frames; frame++) {
    test.animator.update(fixedStep, motion);
    inspect(test, motion, name, frame);
  }
  test.phaseClips[name] = test.animator.activeClip;
}

function guardPavitr(test) {
  if (test.suit.id !== 'pavitr') return;
  check(!test.suit.animationSource, 'pavitr: foreign library configured');
  const originals = new Map(test.original.animations.map(clip => [clip.name, clip]));
  const allowedDerived = new Set(['rooftop-perch', 'local-wall-crawl', ...Object.keys(PAVITR_SEGMENTS).map(role => `pavitr-native:${role}`)]);
  for (const clip of test.animator.clips) {
    check(originals.has(clip.name) || allowedDerived.has(clip.name), `pavitr: foreign runtime clip ${clip.name}`);
    const original = originals.get(clip.name);
    if (!original || original.duration <= .15) continue;
    for (const track of original.tracks.filter(item => item.name.endsWith('.quaternion'))) {
      const runtime = clip.tracks.find(item => item.name === track.name);
      check(runtime && runtime.values.length === track.values.length
        && track.values.every((value, index) => value === runtime.values[index]), `pavitr: native joint keys modified in ${clip.name}/${track.name}`);
    }
  }
  const foreign = test.original.animations[0].clone();
  foreign.name = 'Run';
  const guardedRoot = clone(test.original.scene);
  const guarded = new AvatarAnimator(guardedRoot, test.suit, [...suitAnimationClips(test.original.animations, test.suit), foreign]);
  check(!guarded.clips.some(clip => clip.name === 'Run'), 'pavitr: foreign clip bypassed animator guard');
  guarded.mixer.stopAllAction();
  guarded.mixer.uncacheRoot(guardedRoot);
}

for (const suit of suits) {
  try {
    const test = await prepare(suit);
    guardPavitr(test);
    const anchor = new THREE.Vector3(29, 120, -45);
    const swing = { pose: 'swing', grounded: false, speed: 38, tension: .85, anchor };
    for (let cycle = 0; cycle < 3; cycle++) {
      advance(test, `run-${cycle}`, { pose: 'run', grounded: true, speed: 12 }, 30);
      advance(test, `jump-${cycle}`, { pose: 'jump', grounded: false, speed: 19, verticalSpeed: 14 }, 25);
      advance(test, `double-jump-${cycle}`, { pose: 'backflip', grounded: false, speed: 25, verticalSpeed: 14 }, 55);
      const ownsBackflip = test.animator.clips.some(clip => /(?:jumpdouble|swingend|swingtoland|basicsidehandspring|pavitr-native:release|jump)$/i.test(canonical(clip.name)));
      if (ownsBackflip) check(test.animator.activeClip !== 'procedural:backflip', `${suit.id}: authored double-jump animation was not selected`);
      advance(test, `swing-down-${cycle}`, { ...swing, verticalSpeed: -18 }, 36);
      advance(test, `swing-up-${cycle}`, { ...swing, verticalSpeed: 18 }, 36);
      advance(test, `release-${cycle}`, { pose: 'jump', grounded: false, speed: 46, verticalSpeed: 22 }, 27);
      advance(test, `fall-${cycle}`, { pose: 'fall', grounded: false, speed: 40, verticalSpeed: -14 }, 48);
      advance(test, `zip-${cycle}`, { pose: 'zip', grounded: false, speed: 55, verticalSpeed: 8, anchor }, 24);
      // The integration maps land to a supported idle/perch, not an airborne
      // run. Pavitr's native graph may insert its finite authored landing.
      advance(test, `land-${cycle}`, { pose: 'idle', grounded: true, speed: 0, verticalSpeed: 0 }, 66);
    }

    advance(test, 'run-before-stale-rise', { pose: 'run', grounded: true, speed: 12 }, 24);
    advance(test, 'stale-airborne-run-rising', { pose: 'run', grounded: false, speed: 28, verticalSpeed: 15 }, 36);
    advance(test, 'run-before-stale-fall', { pose: 'run', grounded: true, speed: 12 }, 24);
    advance(test, 'stale-airborne-run-falling', { pose: 'run', grounded: false, speed: 28, verticalSpeed: -15 }, 36);

    const hasDirectionalArcs = test.animator.clips.some(clip => clip.name === 'arc-downswing');
    for (const [direction, speed, expected] of [['down', -18, 'arc-downswing'], ['up', 18, 'arc-upswing']]) {
      advance(test, `establish-${direction}`, { ...swing, verticalSpeed: speed }, 36);
      if (hasDirectionalArcs) check(test.animator.activeClip === expected, `${suit.id}: strong ${direction} input did not select ${expected}`);
      const heldClip = test.animator.activeClip;
      const before = resetCount(test);
      for (let frame = 0; frame < 180; frame++) {
        const jitter = frame % 2 ? 1.4 : -1.4;
        const motion = { ...swing, verticalSpeed: jitter };
        test.animator.update(fixedStep, motion);
        inspect(test, motion, `hysteresis-${direction}`, frame);
        check(test.animator.activeClip === heldClip, `${suit.id}: ${direction} arc flickers around zero vertical speed`);
      }
      check(resetCount(test) === before, `${suit.id}: stable ${direction} swing restarted native action every frame`);
    }

    advance(test, 'steady-run-entry', { pose: 'run', grounded: true, speed: 12 }, 24);
    const beforeRun = resetCount(test);
    advance(test, 'steady-run-hold', { pose: 'run', grounded: true, speed: 12 }, 90);
    check(resetCount(test) === beforeRun, `${suit.id}: steady running repeatedly reset its native action`);
    console.log(JSON.stringify({ suit: suit.id, directionalArcs: hasDirectionalArcs,
      transitions: Object.fromEntries(Object.entries(test.phaseClips).filter(([name]) => name.endsWith('-0'))),
      nativeActionStarts: resetCount(test), hysteresis: 'stable', sourceOnlyPavitr: suit.id === 'pavitr' }));
    test.animator.mixer.stopAllAction();
    test.animator.mixer.uncacheRoot(test.root);
  } catch (error) {
    failures.add(`${suit.id}: ${error.stack ?? error}`);
  }
}

if (failures.size) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.error(`${failures.size} failures across ${suits.length} actual Spider-Man GLBs (${checks} assertions).`);
  process.exitCode = 1;
} else {
  console.log(`PASS ${suits.length} real Spider-Man GLBs, ${checks} assertions: traversal transitions, stale-airborne-run guard, swing hysteresis, native action continuity, finite transforms and sole contact.`);
}
