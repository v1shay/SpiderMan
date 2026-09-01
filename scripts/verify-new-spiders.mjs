import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { getSuit } from '../lib/game-config.ts';
import { MuaSpiderAnimationGraph } from '../lib/mua-spider-animation.ts';
import { applySuitRestPose, boneRole, normalizeSuit, suitAnimationClips } from '../lib/three-assets.ts';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(parser => {
  parser.loadTextureImage = () => Promise.resolve(new THREE.Texture());
  return { name: 'NewSpiderTextureStub' };
});
async function load(file) {
  const bytes = await fs.readFile(file);
  return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}
const production = new URL('../public/assets/suits/', import.meta.url);
const muaSuit = getSuit('mua-spider');
const venomSuit = getSuit('venom');
const mua = await load(new URL('ultimate-alliance-spider.glb', production));
const venom = await load(new URL('venom.glb', production));
assert.equal(mua.animations.length, 52);
assert.deepEqual(venom.animations.map(clip => clip.name), ['Scream', 'Jump']);
assert.ok(mua.scene.getObjectByProperty('type', 'SkinnedMesh'));
assert.ok(venom.scene.getObjectByProperty('type', 'SkinnedMesh'));

const muaRoot = clone(mua.scene);
const clips = suitAnimationClips(mua.animations, muaSuit);
applySuitRestPose(muaRoot, muaSuit, clips);
const bounds = normalizeSuit(muaRoot, muaSuit);
assert.ok(Math.abs(bounds.getSize(new THREE.Vector3()).y - 2.05) < .01, 'MUA standing pose must normalize to human height');
assert.ok(Math.abs(bounds.min.y) < .01, 'MUA soles must be grounded');
const graph = new MuaSpiderAnimationGraph(clips);
const select = (pose, extra = {}) => graph.select(1 / 60, { pose, grounded: false, ...extra });
assert.equal(select('run').clip.name, 'run');
assert.equal(select('jump').clip.name, 'jump_start');
assert.equal(select('swing', { tension: .7 }).clip.name, 'power_8_loop');
assert.equal(select('zip').clip.name, 'power_8_start');
assert.equal(select('fall').clip.name, 'power_10');
assert.equal(graph.select(1 / 60, { pose: 'crawl', grounded: false }), undefined, 'shared wall crawl remains authoritative');
assert.equal(graph.select(1 / 60, { pose: 'idle', grounded: true }).clip.name, 'mua-native:stand');
assert.equal(graph.select(1 / 60, { pose: 'perch', grounded: true }).clip.name, 'mua-native:perch');
assert.equal(graph.select(1 / 60, { pose: 'idle', grounded: true, lobby: true }).clip.name, 'mua-native:stand');
assert.ok(!graph.derived.some(clip => clip.name === 'power_4_end'), 'cinematic landing root drop must not become a runtime support pose');

const roles = new Set();
venom.scene.traverse(object => { if (object instanceof THREE.Bone) roles.add(boneRole(object.name)); });
for (const role of ['hips', 'head', 'leftArm', 'rightArm', 'leftUpLeg', 'rightUpLeg', 'leftFoot', 'rightFoot']) {
  assert.ok(roles.has(role), `Venom rig missing ${role}`);
}
const venomClips = suitAnimationClips(venom.animations, venomSuit);
assert.ok(venomClips.some(clip => clip.name === 'Jump'));
assert.ok(venomClips.some(clip => clip.name === 'Scream'));
console.log('PASS two new Spider rigs: native inventories, MUA routing/standing normalization, Venom anatomical roles, shared spawn/crawl ownership.');
