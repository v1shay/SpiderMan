import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { retargetWorldSpace } from './retarget-world-space.mjs';

const sourceDirectory = process.argv[2] ?? 'source-assets/mixamo-combat';
const imports = [
  ['Shooting', 'X Bot@Shooting.fbx'],
  ['Block', 'X Bot@Block.fbx'],
  ['Body Block', 'X Bot@Body Block.fbx'],
  ['Punching', 'X Bot@Punching.fbx'],
  ['Fist Fight A', 'X Bot@Fist Fight A.fbx'],
  ['Kicking', 'X Bot@Kicking.fbx'],
  ['Hurricane Kick', 'X Bot@Hurricane Kick.fbx'],
  ['Receive Uppercut To The Face', 'X Bot@Receive Uppercut To The Face.fbx'],
  ['Taunt', 'X Bot@Taunt.fbx'],
  ['Defeated', 'X Bot@Defeated.fbx'],
  ['Flying Shoulder Throw', 'X Bot@Flying Shoulder Throw.fbx'],
  ['Getting Thrown', 'X Bot@Getting Thrown.fbx'],
  ['Spin Flip Kick', 'X Bot@Spin Flip Kick.fbx'],
  ['Flip Kick', 'X Bot@Flip Kick.fbx'],
  ['Big Body Blow', 'Big Body Blow.fbx'],
  ['Corkscrew Kip Up', 'Corkscrew Kip Up.fbx'],
  ['Wall Crash', 'Wall Crash.fbx'],
  ['Grab And Slam', 'Grab And Slam.fbx'],
  ['Butterfly Twirl', 'Butterfly Twirl.fbx'],
  ['Drop Kick', 'Drop Kick.fbx'],
];
const suits = [
  ['2099', 'miguel-2099'],
  ['amazing', 'amazing'],
  ['classic-spider', 'classic-spider'],
  ['classic-suit', 'classic-suit'],
  ['homecoming-tech', 'homecoming-tech'],
  ['miles-animated', 'miles-animated'],
  ['miles-new', 'miles-new'],
  ['no-way-home', 'no-way-home'],
  ['pavitr-prabhakar', 'pavitr-prabhakar'],
  ['spider-woman-atsv', 'spider-woman-atsv'],
  ['symbiote-ps5', 'symbiote-ps5'],
  ['tobey', 'tobey'],
];

globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`;
      this.onloadend?.();
    });
  }
};

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register((parser) => {
  parser.loadTextureImage = () => Promise.resolve(new THREE.Texture());
  return { name: 'OfflineCombatTextures' };
});
const bytesToArrayBuffer = (bytes) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const loadGltf = async (filename) =>
  loader.parseAsync(bytesToArrayBuffer(await fs.readFile(filename)), '');

const sources = [];
for (const [name, filename] of imports) {
  const bytes = await fs.readFile(path.join(sourceDirectory, filename));
  const scene = new FBXLoader().parse(bytesToArrayBuffer(bytes), '');
  const clip = scene.animations[0];
  if (!clip) throw new Error(`${filename} has no animation`);
  sources.push({
    name,
    filename,
    bytes,
    scene,
    clip,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

const report = [];
for (const [packId, modelId] of suits) {
  const packPath = `public/assets/animations/mixamo-${packId}.glb`;
  const modelPath = `public/assets/suits/${modelId}.glb`;
  const [pack, model] = await Promise.all([loadGltf(packPath), loadGltf(modelPath)]);
  const names = new Set(imports.map(([name]) => `mixamo:${name}`));
  const animations = pack.animations.filter((clip) => !names.has(clip.name));
  const imported = [];

  for (const source of sources) {
    const clip = retargetWorldSpace(source.clip, source.scene, model.scene, 30);
    clip.name = `mixamo:${source.name}`;
    if (clip.tracks.length < 18)
      throw new Error(`${packId}/${source.name}: only ${clip.tracks.length} mapped tracks`);
    animations.push(clip);
    imported.push({
      name: source.name,
      file: source.filename,
      sha256: source.sha256,
      duration: clip.duration,
      tracks: clip.tracks.length,
    });
  }

  const meshes = [];
  model.scene.traverse((object) => {
    if (object.isMesh) meshes.push(object);
  });
  meshes.forEach((mesh) => mesh.removeFromParent());
  const glb = await new GLTFExporter().parseAsync(model.scene, {
    binary: true,
    animations,
    onlyVisible: false,
  });
  await fs.writeFile(packPath, Buffer.from(glb));
  report.push({ packId, modelId, clips: animations.length, bytes: glb.byteLength, imported });
  console.log(`${packId}: ${animations.length} clips, ${(glb.byteLength / 1048576).toFixed(2)} MB`);
}

await fs.writeFile(
  'docs/verification/combat-animation-imports.json',
  `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    method: 'Mixamo FBX source rig sampled at 30fps and retargeted in world space; source meshes and materials discarded',
    report,
  }, null, 2)}\n`,
);
