import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SUITS } from '../lib/game-config.ts';
import { applySuitRestPose, normalizeSuit, suitAnimationClips, collectRigBones } from '../lib/three-assets.ts';

// Emit a compact canonical-space motion reference. No textures, mesh vertices,
// root translation or extra GLB downloads are needed by the runtime retargeter.
const suit = SUITS.find(suit => suit.id === 'playstation');
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(parser => { parser.loadTextureImage = () => Promise.resolve(new THREE.Texture()); return { name: 'TextureStub' }; });
const bytes = await fs.readFile(new URL(`../public${suit.model}`, import.meta.url));
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const clips = suitAnimationClips(gltf.animations, suit);
applySuitRestPose(gltf.scene, suit, clips); normalizeSuit(gltf.scene, suit);
const bones = collectRigBones(gltf.scene);
const rest = bones.map(({ bone }) => bone.getWorldQuaternion(new THREE.Quaternion()).invert());
const crawl = clips.find(clip => clip.name === 'Crawl');
const mixer = new THREE.AnimationMixer(gltf.scene);
mixer.clipAction(crawl).setLoop(THREE.LoopOnce, 1).play();
const frames = Math.ceil(crawl.duration * 30);
const chains = { hips: 'spine', spine: 'spine2', spine2: 'chest', chest: 'neck', neck: 'head',
  leftShoulder: 'leftArm', rightShoulder: 'rightArm', leftArm: 'leftForeArm', rightArm: 'rightForeArm', leftForeArm: 'leftHand', rightForeArm: 'rightHand',
  leftUpLeg: 'leftLeg', rightUpLeg: 'rightLeg', leftLeg: 'leftFoot', rightLeg: 'rightFoot' };
const times = [], rotations = Object.fromEntries(bones.map(({ role }) => [role, []]));
const directions = Object.fromEntries(Object.keys(chains).map(role => [role, []]));
for (let frame = 0; frame <= frames; frame++) {
  const time = frame * crawl.duration / frames;
  times.push(+time.toFixed(7));
  mixer.setTime(frame === frames ? 0 : time); gltf.scene.updateMatrixWorld(true);
  bones.forEach(({ bone, role }, index) => {
    const rotation = bone.getWorldQuaternion(new THREE.Quaternion()).multiply(rest[index]).normalize();
    rotations[role].push(...rotation.toArray().map(value => +value.toFixed(7)));
    const child = bones.find(entry => entry.role === chains[role]);
    if (child) {
      const direction = child.bone.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
      directions[role].push(...direction.toArray().map(value => +value.toFixed(7)));
    }
  });
}
console.log(JSON.stringify({ source: 'playstation.glb / Crawl', duration: crawl.duration, times, rotations, chains, directions }));
