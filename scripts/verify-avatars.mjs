import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { SUITS } from '../lib/game-config.ts';
import { animateRigBones, collectRigBones, normalizeSuit, poseOnlyClips, suitAnimationClips } from '../lib/three-assets.ts';
import { addSwingAttachment, emptyProgress, isSuitUnlocked, readProgress, swingsRemaining } from '../lib/progression.ts';

// Test an isolated storage stub, never the player's real browser progression.
const store = new Map();
globalThis.window = {
  localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
  dispatchEvent: () => true,
};
const locked = SUITS.find(suit => suit.id === 'spider-woman');
assert.equal(isSuitUnlocked(locked, emptyProgress()), false);
for (let i = 0; i < 49; i++) addSwingAttachment();
assert.equal(readProgress().swingAttachments, 49);
assert.equal(isSuitUnlocked(locked, readProgress()), false);
assert.equal(swingsRemaining(locked, readProgress()), 1);
addSwingAttachment();
assert.equal(isSuitUnlocked(locked, readProgress()), true);
assert.equal(swingsRemaining(locked, readProgress()), 0);
for (const suit of SUITS) assert.ok(fs.existsSync(new URL(`../public${suit.model}`, import.meta.url)), suit.model);
for (const old of ['advanced', 'classic', 'ps4']) {
  assert.equal(fs.existsSync(new URL(`../public/assets/suits/${old}.glb`, import.meta.url)), false);
}

// A ninety-degree exporter parent must not turn forward leg motion sideways.
const root = new THREE.Group();
const parent = new THREE.Bone();
parent.rotation.z = Math.PI / 2;
const thigh = new THREE.Bone();
thigh.name = 'thigh_stretch.l';
parent.add(thigh);
root.add(parent);
const bones = collectRigBones(root);
assert.equal(bones[0].role, 'leftUpLeg');
const before = thigh.getWorldQuaternion(new THREE.Quaternion());
animateRigBones(bones, 'run', Math.PI / (2 * 9.5), 10);
const worldDelta = thigh.getWorldQuaternion(new THREE.Quaternion()).multiply(before.invert());
const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), .68);
assert.ok(worldDelta.angleTo(expected) < 1e-6, 'gait must rotate around character X, not exporter X');

// Keep authored limb translations while stripping locomotion root tracks.
const tracks = ['LeftArm', 'RightArm', 'LeftUpLeg', 'RightUpLeg', 'Head'].map(name =>
  new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]));
tracks.push(new THREE.VectorKeyframeTrack('LeftArm.position', [0, 1], [0, 0, 0, 0, 1, 0]));
tracks.push(new THREE.VectorKeyframeTrack('mixamorigHips.position', [0, 1], [0, 0, 0, 0, 1, 0]));
const [clip] = poseOnlyClips([new THREE.AnimationClip('Run', 1, tracks)]);
assert.ok(clip.tracks.some(track => track.name === 'LeftArm.position'));
assert.ok(!clip.tracks.some(track => track.name.includes('Hips.position')));
const playstation = SUITS.find(suit => suit.id === 'playstation');
const [stand] = suitAnimationClips([new THREE.AnimationClip('Jump', 1, tracks)], playstation);
assert.equal(stand.name, 'stand');
assert.equal(stand.duration, 1);
for (const track of stand.tracks) {
  assert.deepEqual(Array.from(track.values.slice(0, track.getValueSize())), Array.from(track.values.slice(track.getValueSize())));
}
assert.equal(tracks.find(track => track.name === 'LeftArm.position').values[4], 1, 'source clips stay unchanged');

// Attached rig props must not influence the human body's normalized size.
const model = new THREE.Group();
const body = new THREE.Mesh(new THREE.BoxGeometry(1, 2, .5));
body.name = 'Body';
body.position.y = 1;
const prop = new THREE.Mesh(new THREE.BoxGeometry(1, 20, 1));
prop.name = 'Strand';
prop.position.x = 10;
model.add(body, prop);
const bounds = normalizeSuit(model, { ...SUITS[0], normalizationMesh: 'Body', hiddenMeshes: ['Strand'] });
assert.ok(Math.abs(bounds.getSize(new THREE.Vector3()).y - 2.05) < 1e-6);
assert.ok(Math.abs(bounds.min.y) < 1e-6);
assert.ok(Math.abs(bounds.getCenter(new THREE.Vector3()).x) < 1e-6);
assert.equal(prop.visible, false);
// Precise skinned bounds must refresh bind inverses after scaling/recentering.
const skinnedRoot = new THREE.Group();
const geometry = new THREE.BoxGeometry(.6, 1.4, .4);
const vertexCount = geometry.getAttribute('position').count;
geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(vertexCount * 4), 4));
const weights = new Float32Array(vertexCount * 4);
for (let i = 0; i < vertexCount; i++) weights[i * 4] = 1;
geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
const skinned = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
const pelvis = new THREE.Bone();
skinned.add(pelvis);
skinned.bind(new THREE.Skeleton([pelvis]));
pelvis.position.set(.2, .9, -.15);
skinnedRoot.add(skinned);
normalizeSuit(skinnedRoot, SUITS[0]);
skinnedRoot.updateMatrixWorld(true);
const renderedBounds = new THREE.Box3().setFromObject(skinnedRoot, true);
assert.ok(Math.abs(renderedBounds.getSize(new THREE.Vector3()).y - 2.05) < 1e-6);
assert.ok(Math.abs(renderedBounds.min.y) < 1e-6, 'standing skin must remain grounded after render updates');
assert.ok(Math.abs(renderedBounds.getCenter(new THREE.Vector3()).x) < 1e-6);
console.log('PASS: roster assets, old suit removal, 49/50 unlock, rig-axis gait, authored limb tracks, silhouette normalization.');
