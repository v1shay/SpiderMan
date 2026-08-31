import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SUITS } from '../lib/game-config.ts';
import { applySuitRestPose, normalizeSuit, retargetMixamoClips, suitAnimationClips, boneRole } from '../lib/three-assets.ts';
import { AvatarAnimator } from '../lib/avatar-animation.ts';
import { WallPose } from '../lib/wall-pose.ts';

// Evaluate real skinned geometry, not just the controller/collision capsule.
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(parser => { parser.loadTextureImage = () => Promise.resolve(new THREE.Texture()); return { name: 'TextureStub' }; });
async function load(model) {
  const bytes = await fs.readFile(new URL(`../public${model}`, import.meta.url));
  return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}
let checks = 0;
for (const suit of SUITS.filter(suit => suit.traversal === 'spider')) {
  const gltf = await load(suit.model), root = gltf.scene;
  const clips = suitAnimationClips(gltf.animations, suit);
  applySuitRestPose(root, suit, clips);
  if (suit.animationSource && suit.animationSource !== suit.model) {
    const library = await load(suit.animationSource);
    clips.push(...retargetMixamoClips(library.animations, library.scene, root));
  }
  normalizeSuit(root, suit, 2.05);
  const actor = new THREE.Group(), frame = new THREE.Group();
  frame.add(root); actor.add(frame);
  const animator = new AvatarAnimator(root, suit, clips), pose = new WallPose(root);
  const ownNames = new Set(gltf.animations.map(clip => clip.name));
  if (suit.id === 'pavitr') assert.ok(!animator.clips.some(clip => clip.name === 'retargeted-wall-crawl'), 'Pavitr must not borrow the reference');
  let minimumDepth = Infinity, maximumGap = 0, lowestUp = 1;
  for (const normal of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)]) {
    actor.position.set(13, 42, -8);
    actor.rotation.set(.2, .63, -.18);
    const wall = { point: actor.position.clone().addScaledVector(normal, -.462), normal, feetTouching: true };
    const limbPositions = new Map(['leftHand', 'rightHand', 'leftFoot', 'rightFoot'].map(role => [role, []]));
    for (let step = 0; step < 75; step++) {
      pose.reset(frame); actor.updateMatrixWorld(true);
      animator.update(1 / 30, { pose: 'crawl', speed: 5.2, grounded: false });
      pose.apply(frame, animator.bones, wall);
      actor.updateMatrixWorld(true);
      assert.ok(!animator.activeClip.startsWith('procedural:'), `${suit.id}: missing keyed crawl animation`);
      const active = animator.clips.find(clip => clip.name === animator.activeClip);
      assert.ok(ownNames.has(active.name) || ['retargeted-wall-crawl', 'local-wall-crawl'].includes(active.name), `${suit.id}: unexpected crawl clip`);
      for (const [role, positions] of limbPositions) {
        positions.push(animator.bones.find(entry => entry.role === role).bone.getWorldPosition(new THREE.Vector3()));
      }
      if (step % 5) continue;
      const p = role => animator.bones.find(entry => entry.role === role).bone.getWorldPosition(new THREE.Vector3());
      const up = p('head').sub(p('leftFoot').add(p('rightFoot')).multiplyScalar(.5)).normalize();
      lowestUp = Math.min(lowestUp, up.y);
      const surfaceUp = up.clone().addScaledVector(normal, -up.dot(normal)).normalize();
      assert.ok(up.y > .93 && surfaceUp.y > .995, `${suit.id}: sideways crawl ${up.toArray().join(',')}`);
      let bodyDepth = Infinity, footDepth = Infinity, lowestFoot = Infinity;
      const v = new THREE.Vector3();
      root.traverseVisible(mesh => {
        if (!(mesh instanceof THREE.Mesh)) return;
        const joints = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
        const footBones = mesh instanceof THREE.SkinnedMesh ? mesh.skeleton.bones.map(bone => boneRole(bone.name).endsWith('Foot')) : [];
        for (let index = 0; index < mesh.geometry.getAttribute('position').count; index++) {
          mesh.getVertexPosition(index, v).applyMatrix4(mesh.matrixWorld);
          const depth = v.clone().sub(wall.point).dot(normal);
          bodyDepth = Math.min(bodyDepth, depth);
          let footWeight = 0;
          if (joints && weights) for (let j = 0; j < 4; j++) if (footBones[joints.getComponent(index, j)]) footWeight += weights.getComponent(index, j);
          if (footWeight > .35) { footDepth = Math.min(footDepth, depth); lowestFoot = Math.min(lowestFoot, v.y); }
        }
      });
      minimumDepth = Math.min(minimumDepth, bodyDepth); maximumGap = Math.max(maximumGap, footDepth);
      assert.ok(bodyDepth >= -.025, `${suit.id}: rendered mesh inside wall ${bodyDepth}`);
      assert.ok(Math.abs(lowestFoot - actor.position.y) < .05, `${suit.id}: feet below controller ${lowestFoot - actor.position.y}`);
      assert.ok(footDepth < .08 && footDepth > -.025, `${suit.id}: sole misses facade by ${footDepth}`);
      checks++;
    }
    for (const [role, positions] of limbPositions) {
      const extent = new THREE.Box3().setFromPoints(positions).getSize(new THREE.Vector3());
      assert.ok(extent.length() > .03, `${suit.id}: ${role} never moves during a complete crawl cycle`);
    }
    const active = animator.clips.find(clip => clip.name === animator.activeClip);
    const action = animator.mixer.existingAction(active);
    const pausedTime = action.time;
    for (let step = 0; step < 30; step++) {
      pose.reset(frame); actor.updateMatrixWorld(true);
      animator.update(1 / 30, { pose: 'crawl', speed: 0, grounded: false });
      pose.apply(frame, animator.bones, wall);
    }
    assert.equal(action.time, pausedTime, `${suit.id}: crawl keeps walking when stationary`);
    pose.reset(frame);
    animator.update(.04, { pose: 'crawl', speed: 4, crawlDirection: -1, grounded: false });
    const backwardDelta = (pausedTime - action.time + active.duration) % active.duration;
    assert.ok(Math.abs(backwardDelta - .04) < 1e-4, `${suit.id}: descending crawl does not reverse playback`);
    for (let step = 0; step < 30; step++) animator.update(1 / 30, { pose: 'jump', grounded: false, verticalSpeed: 8 });
    assert.ok(!action.isRunning() || action.getEffectiveWeight() < .001, `${suit.id}: crawl still contributes after jumping`);
  }
  console.log(`${suit.id}: keyed crawl + four moving limbs + stop/reverse/detach PASS; upright ${lowestUp.toFixed(3)}, full-mesh clearance ${minimumDepth.toFixed(3)}m, sole gap ${maximumGap.toFixed(3)}m`);
}
console.log(`Verified ${checks} full-geometry wall poses across four facade orientations.`);
