import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { SUITS } from '../lib/game-config.ts';
import { AvatarAnimator } from '../lib/avatar-animation.ts';
import { PAVITR_SEGMENTS } from '../lib/pavitr-animation.ts';
import { applySuitRestPose, boneRole, freezeClipPose, normalizeSuit, retargetMixamoClips, suitAnimationClips } from '../lib/three-assets.ts';

// CPU-only regression of the REAL optimized GLBs and runtime animator. Texture
// decoding is stubbed; this does not replace browser texture/visual verification.
// Run: node scripts/verify-avatar-motion.mjs [--suit=playstation]
const filter = process.argv.find(value => value.startsWith('--suit='))?.slice(7);
const suits = SUITS.filter(suit => !filter || suit.id === filter);
assert.ok(suits.length, `Unknown suit: ${filter}`);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(parser => {
  parser.loadTextureImage = () => Promise.resolve(new THREE.Texture());
  return { name: 'MotionRegressionTextureStub' };
});
const files = new Map();
async function load(model) {
  if (!files.has(model)) files.set(model, (async () => {
    const bytes = await fs.readFile(new URL(`../public${model}`, import.meta.url));
    return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  })());
  return files.get(model);
}

const failures = [];
const notices = [];
let checks = 0;
const check = (condition, message) => {
  checks++;
  if (!condition && !failures.includes(message)) failures.push(message);
};
const canonical = name => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const isEmote = name => /(?:shellfidget|fidgetvictoryin|hiphop|silly1|silly2|menuaction|menugoodbye)$/.test(canonical(name));
const isRunning = name => /^(?:run|runaboveground|walk|bullywalking)$/.test(canonical(name));
const vec = new THREE.Vector3();
const inverse = new THREE.Matrix4();

async function prepare(suit, profile) {
  const original = await load(suit.model);
  const root = clone(original.scene);
  const clips = suitAnimationClips(original.animations, suit);
  // Use a calibrated standing reference for exporters with a horizontal or
  // twisted rest pose before borrowing traversal; then measure the silhouette.
  const appendLibrary = async () => {
    if (!suit.animationSource || suit.animationSource === suit.model) return;
    const library = await load(suit.animationSource);
    clips.push(...retargetMixamoClips(library.animations, library.scene, root));
  };
  applySuitRestPose(root, suit, clips);
  await appendLibrary();
  normalizeSuit(root, suit, profile === 'lobby' ? 2.1 : 2.05);
  const holder = new THREE.Group();
  holder.position.set(13, 42, -8);
  holder.rotation.y = .63;
  holder.add(root);
  holder.updateMatrixWorld(true);
  const animator = new AvatarAnimator(root, suit, clips);
  const feet = [];
  root.traverseVisible(mesh => {
    if (!(mesh instanceof THREE.SkinnedMesh)) return;
    const joints = mesh.geometry.getAttribute('skinIndex');
    const weights = mesh.geometry.getAttribute('skinWeight');
    if (!joints || !weights) return;
    const footBones = mesh.skeleton.bones.map(bone => boneRole(bone.name).endsWith('Foot'));
    const indices = [];
    for (let i = 0; i < joints.count; i++) {
      let weight = 0;
      for (let component = 0; component < 4; component++) {
        if (footBones[joints.getComponent(i, component)]) weight += weights.getComponent(i, component);
      }
      if (weight > .35) indices.push(i);
    }
    if (indices.length) feet.push({ mesh, indices });
  });
  return { suit, profile, root, holder, animator, feet, base: root.position.clone(), controller: holder.position.clone() };
}

function readContacts(test) {
  test.holder.updateMatrixWorld(true);
  inverse.copy(test.holder.matrixWorld).invert();
  let sole = Infinity;
  // Deliberately sample ALL weighted shoe vertices, independently of the
  // animator's bounded probe subset, so missed low toe tips are detectable.
  for (const { mesh, indices } of test.feet) for (const index of indices) {
    mesh.getVertexPosition(index, vec).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
    sole = Math.min(sole, vec.y);
  }
  const points = {};
  for (const { bone, role } of test.animator.bones) {
    if (['head', 'hips', 'leftFoot', 'rightFoot', 'leftHand', 'rightHand'].includes(role)) {
      points[role] = bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse).toArray();
    }
  }
  return { sole, points };
}

function inspect(test, motion, label, contacts = false) {
  const prefix = `${test.suit.id}/${test.profile}/${label}`;
  test.holder.updateMatrixWorld(true);
  test.root.traverse(object => {
    const values = [...object.position, ...object.quaternion, ...object.scale, ...object.matrixWorld.elements];
    check(values.every(Number.isFinite), `${prefix}: non-finite transform on ${object.name}`);
    check(Math.abs(object.quaternion.lengthSq() - 1) < .025, `${prefix}: non-unit quaternion on ${object.name}`);
  });
  check(test.holder.position.distanceTo(test.controller) < 1e-9, `${prefix}: animation moved controller root`);
  check(Math.abs(test.root.position.x - test.base.x) < 1e-9 && Math.abs(test.root.position.z - test.base.z) < 1e-9,
    `${prefix}: animation drifted model horizontally`);
  const hand = test.animator.webHand(new THREE.Vector3());
  check(hand.toArray().every(Number.isFinite), `${prefix}: web hand is non-finite`);
  const hands = test.animator.bones.filter(entry => entry.role.endsWith('Hand'));
  check(hands.length === 2, `${prefix}: missing actual left/right hand bones`);
  check(hands.some(({ bone }) => bone.getWorldPosition(vec).distanceTo(hand) < 1e-6), `${prefix}: web uses fallback point, not an actual hand`);
  check(hand.distanceTo(test.controller) < 5, `${prefix}: actual hand escaped normalized body bounds`);
  if (!motion.grounded) {
    check(!isRunning(test.animator.activeClip), `${prefix}: selected running clip while airborne`);
    check(Math.abs(test.root.position.y - test.base.y) < 1e-9, `${prefix}: sole-grounding correction leaked into air`);
    for (const clip of test.animator.clips) {
      const action = test.animator.mixer.existingAction(clip);
      if (isRunning(clip.name) && action) check(action.getEffectiveWeight() < .001 || !action.isRunning(), `${prefix}: running action still contributes in air`);
    }
  }
  if (contacts) {
    const sampled = readContacts(test);
    if (motion.grounded) {
      check(Number.isFinite(sampled.sole), `${prefix}: no finite actual sole vertices`);
      if (test.animator.supportMode === 'soles') check(Math.abs(sampled.sole) < .035, `${prefix}: shoe vertices miss floor by ${sampled.sole.toFixed(4)}m`);
      else check(sampled.sole >= -.035, `${prefix}: inverted-entry feet penetrate floor`);
      check(Math.abs(test.animator.contactError) < .001, `${prefix}: clamped ground correction leaves contact error`);
      if (sampled.points.head) check(sampled.points.head[1] > (test.animator.supportMode === 'body' ? .015 : .15), `${prefix}: head is at/below floor (${sampled.points.head[1].toFixed(3)}m)`);
      for (const hand of ['leftHand', 'rightHand']) {
        if (sampled.points[hand]) check(sampled.points[hand][1] > -.15, `${prefix}: ${hand} penetrates floor (${sampled.points[hand][1].toFixed(3)}m)`);
      }
    }
    return sampled;
  }
}

function advance(test, motion, seconds, label, step = 1 / 60) {
  for (let time = 0; time < seconds - 1e-9; time += step) test.animator.update(Math.min(step, seconds - time), motion);
  return inspect(test, motion, label, true);
}

function validateClips(test) {
  for (const clip of test.animator.clips) {
    check(Number.isFinite(clip.duration) && clip.duration > 0, `${test.suit.id}: invalid duration ${clip.name}`);
    for (const track of clip.tracks) {
      check(Array.from(track.times).every(Number.isFinite) && Array.from(track.values).every(Number.isFinite), `${test.suit.id}: non-finite source track ${clip.name}/${track.name}`);
      if (track.name.endsWith('.position')) {
        const node = track.name.slice(0, track.name.lastIndexOf('.'));
        check(boneRole(node) !== 'hips', `${test.suit.id}: moving hips translation remains in ${clip.name}`);
      }
    }
  }
}

function checkIdle(test) {
  // Let the intentional one-shot Pavitr entry finish before auditing standing.
  if (test.suit.id === 'pavitr') advance(test, { pose: 'idle', grounded: true }, 3, 'native-entry-complete');
  const contact = advance(test, { pose: 'idle', grounded: true }, 1, 'standing');
  const head = contact.points.head?.[1];
  const feetY = Math.max(contact.points.leftFoot?.[1] ?? Infinity, contact.points.rightFoot?.[1] ?? Infinity);
  check(Number.isFinite(head) && head - feetY > 1.1, `${test.suit.id}/${test.profile}: standing head is not clearly above feet (head ${head}, feet ${feetY})`);
  const expected = test.profile === 'lobby' ? 2.1 : 2.05;
  check(head > expected * .65 && head < expected * 1.12, `${test.suit.id}/${test.profile}: standing head scale ${head?.toFixed(3)}m exceeds normalized ${expected}m body`);
  const idle = test.animator.clips.find(clip => clip.name === test.animator.activeClip);
  if (idle) {
    const authoredAction = test.animator.mixer.existingAction(idle);
    check(authoredAction?.isRunning() && authoredAction.getEffectiveWeight() > .99,
      `${test.suit.id}/${test.profile}: displayed idle name hides another same-name clip playing instead of first/authored clip`);
  }
  return contact;
}

function checkTranslatedRoof(test) {
  const scene = new THREE.Scene();
  test.holder.position.set(2.951, 161.511, 6.964);
  test.holder.rotation.set(0, 2.35, 0);
  test.controller.copy(test.holder.position);
  scene.add(test.holder);
  const motion = { pose: 'perch', grounded: true };
  for (let frame = 0; frame < 120; frame++) {
    test.animator.update(1 / 60, motion);
    scene.updateMatrixWorld(true);
    test.root.traverse(mesh => { if (mesh instanceof THREE.SkinnedMesh) mesh.skeleton.update(); });
  }
  inspect(test, motion, 'translated-rooftop', true);
  const cpu = new THREE.Box3();
  const gpu = new THREE.Box3();
  const position = new THREE.Vector3();
  const base = new THREE.Vector3();
  const blended = new THREE.Vector3();
  const componentPoint = new THREE.Vector3();
  const boneMatrix = new THREE.Matrix4();
  let meshCount = 0;
  test.root.traverseVisible(mesh => {
    if (!(mesh instanceof THREE.SkinnedMesh)) return;
    meshCount++;
    const vertices = mesh.geometry.getAttribute('position');
    const indices = mesh.geometry.getAttribute('skinIndex');
    const weights = mesh.geometry.getAttribute('skinWeight');
    for (let index = 0; index < vertices.count; index++) {
      mesh.getVertexPosition(index, position).applyMatrix4(mesh.matrixWorld);
      cpu.expandByPoint(position);
      // Reproduce the shader's float32 skeleton palette, not only CPU
      // getVertexPosition, after the same scene/skeleton updates as rendering.
      base.fromBufferAttribute(vertices, index).applyMatrix4(mesh.bindMatrix);
      blended.set(0, 0, 0);
      for (let component = 0; component < 4; component++) {
        const weight = weights.getComponent(index, component);
        if (!weight) continue;
        boneMatrix.fromArray(mesh.skeleton.boneMatrices, indices.getComponent(index, component) * 16);
        componentPoint.copy(base).applyMatrix4(boneMatrix);
        blended.addScaledVector(componentPoint, weight);
      }
      blended.applyMatrix4(mesh.bindMatrixInverse).applyMatrix4(mesh.matrixWorld);
      gpu.expandByPoint(blended);
    }
  });
  const center = gpu.getCenter(new THREE.Vector3());
  check(meshCount > 0 && !gpu.isEmpty(), `${test.suit.id}: no visible skinned meshes on translated roof`);
  check(gpu.min.toArray().every(Number.isFinite) && gpu.max.toArray().every(Number.isFinite), `${test.suit.id}: non-finite GPU rooftop bounds`);
  check(Math.hypot(center.x - test.controller.x, center.z - test.controller.z) < 1.5, `${test.suit.id}: rendered rooftop body escaped player XZ (${center.toArray().join(',')})`);
  check(Math.abs(gpu.min.y - test.controller.y) < .15, `${test.suit.id}: rendered rooftop body floor mismatch ${gpu.min.y - test.controller.y}m`);
  check(cpu.min.distanceTo(gpu.min) < .005 && cpu.max.distanceTo(gpu.max) < .005, `${test.suit.id}: renderer palette differs from CPU skinned bounds`);
  const feet = test.animator.bones.filter(entry => entry.role.endsWith('Foot'));
  const worldFeet = feet.map(({ bone }) => bone.getWorldPosition(new THREE.Vector3()));
  for (const foot of worldFeet) check(Math.hypot(foot.x - test.controller.x, foot.z - test.controller.z) < 1.5, `${test.suit.id}: real foot escaped physical player XZ`);
  console.log(JSON.stringify({ test: 'translated-rooftop', suit: test.suit.id, player: test.controller.toArray(), gpuMin: gpu.min.toArray(), gpuMax: gpu.max.toArray(), worldFeet: worldFeet.map(foot => foot.toArray()), visibleSkinnedMeshes: meshCount }));
}

async function gameplay(suit) {
  const test = await prepare(suit, 'game');
  validateClips(test);
  if (suit.id === 'pavitr') {
    check(!suit.animationSource, 'pavitr: must not load another suit animation library');
    const original = await load(suit.model);
    const nativeNames = new Set(original.animations.map(clip => clip.name));
    for (const clip of test.animator.clips) {
      check(nativeNames.has(clip.name) || ['rooftop-perch', 'local-wall-crawl', ...Object.keys(PAVITR_SEGMENTS).map(key => `pavitr-native:${key}`)].includes(clip.name), `pavitr: foreign animation entered runtime: ${clip.name}`);
    }
    for (const native of original.animations) {
      const runtime = test.animator.clips.find(clip => clip.name === native.name);
      check(Boolean(runtime), `pavitr: discarded original clip ${native.name}`);
      if (native.duration <= .15 || !runtime) continue;
      // Root-motion translation is intentionally removed for collision-safe
      // controller movement; the original joint animation is not retargeted.
      for (const sourceTrack of native.tracks.filter(track => track.name.endsWith('.quaternion'))) {
        const targetTrack = runtime.tracks.find(track => track.name === sourceTrack.name);
        check(Boolean(targetTrack) && targetTrack.values.length === sourceTrack.values.length
          && Array.from(sourceTrack.values).every((value, index) => value === targetTrack.values[index]),
        `pavitr: original joint keyframes changed: ${native.name}/${sourceTrack.name}`);
      }
    }
    const foreign = original.animations[0].clone(); foreign.name = 'run';
    const guarded = new AvatarAnimator(test.root, suit, [...suitAnimationClips(original.animations, suit), foreign]);
    check(!guarded.clips.some(clip => clip.name === 'run'), 'pavitr: animator accepted an accidentally appended foreign clip');
    guarded.mixer.uncacheRoot(test.root);
    const run = original.animations.find(clip => canonical(clip.name).endsWith('runaboveground'));
    if (run?.duration === 0) {
      advance(test, { pose: 'run', grounded: true, speed: 12 }, .5, 'single-frame-run-fallback');
      check(test.animator.activeClip === 'procedural:run', 'pavitr: frozen export falsely used as a running loop');
      const thigh = test.animator.bones.find(entry => entry.role === 'leftUpLeg').bone;
      const first = thigh.quaternion.clone();
      advance(test, { pose: 'run', grounded: true, speed: 12 }, .2, 'local-gait-motion');
      check(first.angleTo(thigh.quaternion) > .05, 'pavitr: procedural missing-run fallback is frozen');
    }
    console.log(`Pavitr source-only audit: all ${nativeNames.size} native clips retained; original joint keyframes unchanged; foreign clips rejected.`);
  }
  const idle = checkIdle(test);
  const perchMotion = { pose: 'perch', grounded: true };
  const perch = advance(test, perchMotion, 2, 'perch');
  const perchClip = test.animator.clips.find(clip => clip.name === 'rooftop-perch');
  if (perchClip) {
    check(test.animator.activeClip === 'rooftop-perch', `${suit.id}: authored rooftop perch not selected`);
    const sourceNames = suit.id === 'tobey' ? ['mixamocomlayer0']
      : suit.id === 'pavitr' ? ['specialattack']
      : ['playstation', 'symbiote'].includes(suit.id) ? ['swingtoland'] : ['swingend', 'lowcrawl', 'crawl'];
    const source = sourceNames.map(name => test.animator.clips.find(clip => canonical(clip.name).endsWith(name))).find(Boolean);
    check(Boolean(source), `${suit.id}: authored perch has no identifiable source clip`);
    if (source) {
      const sample = suit.id === 'tobey' ? 1.473 : suit.id === 'pavitr' ? 2.3075 : ['playstation', 'symbiote'].includes(suit.id) ? 1.52
        : canonical(source.name) === 'swingend' ? 1.568 : .568;
      const expected = freezeClipPose(source, Math.min(sample, source.duration), 'expected');
      check(perchClip.tracks.every((track, index) => track.name === expected.tracks[index]?.name
        && Array.from(track.values).every((value, component) => value === expected.tracks[index].values[component])),
      `${suit.id}: perch does not preserve the verified source frame`);
    }
    for (const track of perchClip.tracks) {
      const size = track.getValueSize();
      check(Array.from(track.values.slice(0, size)).every((value, index) => value === track.values[size + index]), `${suit.id}: perch is not a held actual source pose`);
    }
  } else if (suit.traversal === 'spider') notices.push(`${suit.id}: no compatible authored perch; uses procedural fallback (not certified four-point contact)`);
  const beforeY = test.root.position.y;
  advance(test, perchMotion, 5, 'perch-hold');
  if (suit.traversal === 'spider') check(Math.abs(test.root.position.y - beforeY) < .002, `${suit.id}: static perch sole offset accumulates drift`);
  if (perchClip) check(perch.points.head?.[1] < idle.points.head?.[1] - .15, `${suit.id}: authored perch does not visibly lower head`);
  for (let repeat = 0; repeat < 3; repeat++) {
    advance(test, { pose: 'run', grounded: true, speed: 12 }, .5, `run-${repeat}`);
    for (const [phase, verticalSpeed] of [['down', -18], ['trough', 0], ['up', 20]]) {
      const motion = { pose: 'swing', grounded: false, speed: 24, verticalSpeed, tension: .9, anchor: new THREE.Vector3(25, 62, -15) };
      advance(test, motion, .6, `swing-${phase}-${repeat}`);
      if (test.animator.clips.some(clip => clip.name === 'arc-downswing')) {
        check(test.animator.activeClip === (phase === 'up' ? 'arc-upswing' : 'arc-downswing'), `${suit.id}: wrong arc phase selected`);
      }
      const swingClip = test.animator.clips.find(clip => clip.name === test.animator.activeClip);
      const action = swingClip && test.animator.mixer.existingAction(swingClip);
      if (swingClip?.name === 'arc-upswing') check(action.time <= .451, `${suit.id}: attached upswing entered released backflip frames`);
      if (swingClip?.name === 'arc-downswing') check(action.time >= .7 && action.time <= 1.901, `${suit.id}: downswing left verified safe pose interval`);
    }
    for (const pose of ['jump', 'fall', 'dive', 'zip']) advance(test, { pose, grounded: false, speed: 26, verticalSpeed: -10 }, .5, `${pose}-${repeat}`);
    advance(test, perchMotion, 1.5, `land-${repeat}`);
    if (suit.traversal === 'spider') check(Math.abs(test.root.position.y - beforeY) < .003, `${suit.id}: landing/perch offset changes across repeated swing cycles`);
  }
  if (suit.traversal === 'ironman') {
    for (const pose of ['hover', 'fly', 'fall']) advance(test, { pose, grounded: false, speed: 20 }, .8, `ironman-${pose}`);
  }
  const rounded = value => Number.isFinite(value) ? +value.toFixed(3) : null;
  const summary = { suit: suit.id, sourceClips: test.animator.clips.length, perch: perchClip ? 'authored' : suit.traversal === 'ironman' ? 'native standing idle' : 'procedural', idleHead: rounded(idle.points.head?.[1]), perchHead: rounded(perch.points.head?.[1]), perchHands: [perch.points.leftHand?.[1], perch.points.rightHand?.[1]].map(rounded) };
  if (suit.id === 'tobey') checkTranslatedRoof(test);
  test.animator.mixer.stopAllAction();
  return summary;
}

async function lobby(suit) {
  const test = await prepare(suit, 'lobby');
  checkIdle(test);
  const allowed = [...new Set(test.animator.clips.filter(clip => isEmote(clip.name)).map(clip => clip.name))];
  const seen = new Set();
  const duration = allowed.length ? allowed.length * 22 + 1 : 15;
  for (let time = 0; time < duration; time += .1) {
    test.animator.update(.1, { pose: 'idle', grounded: true, lobby: true });
    if (isEmote(test.animator.activeClip)) seen.add(test.animator.activeClip);
    if (Math.round(time * 10) % 10 === 0) inspect(test, { pose: 'idle', grounded: true, lobby: true }, 'selected-lobby', true);
    const active = test.animator.clips.find(clip => clip.name === test.animator.activeClip);
    if (active && isEmote(active.name)) {
      const action = test.animator.mixer.existingAction(active);
      check(action?.loop === THREE.LoopOnce && action.clampWhenFinished, `${suit.id}: lobby emote is not finite/one-shot`);
    }
  }
  for (const name of allowed) check(seen.has(name), `${suit.id}: safe authored lobby emote was never selected: ${name}`);
  advance(test, { pose: 'run', grounded: true, speed: 10 }, .4, 'emote-interrupted');
  check(!isEmote(test.animator.activeClip), `${suit.id}: emote did not cancel on movement`);
  advance(test, { pose: 'idle', grounded: true, lobby: false }, 4, 'unselected-idle');
  check(!isEmote(test.animator.activeClip), `${suit.id}: unselected hero keeps emoting`);
  if (!allowed.length) notices.push(`${suit.id}: no compatible authored whitelist emote; selected-lobby procedural gesture only`);
  test.animator.mixer.stopAllAction();
  return [...seen];
}

for (const suit of suits) {
  try {
    const report = await gameplay(suit);
    report.emotes = await lobby(suit);
    console.log(JSON.stringify(report));
  } catch (error) {
    failures.push(`${suit.id}: fatal regression error: ${error.stack ?? error}`);
  }
}
for (const notice of notices) console.log(`NOTE: ${notice}`);
if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  console.error(`${failures.length} failures across ${suits.length} actual GLBs (${checks} checks).`);
  process.exitCode = 1;
} else console.log(`PASS: ${suits.length} actual GLBs; ${checks} checks covering upright/scale, finite transforms, real soles/hands, perch drift, arc swing/release, and selected lobby emotes.`);
