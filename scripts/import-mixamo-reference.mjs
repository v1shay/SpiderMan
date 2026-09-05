import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { retargetWorldSpace } from './retarget-world-space.mjs';

// Browser port of the reference's HumanoidRetargetingPipeline: anatomical
// bone mapping, rest-pose deltas, controller-owned translation, reverse flip.
// Usage: node scripts/import-mixamo-reference.mjs /path/to/SpiderMan
const reference = process.argv[2];
if (!reference) throw new Error('Pass the reference repository checkout');
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then(result => { this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`; this.onloadend?.(); }); }
};
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(parser => { parser.loadTextureImage = () => Promise.resolve(new THREE.Texture()); return { name: 'OfflineTextures' }; });
const buffer = await fs.readFile('public/assets/suits/miguel-2099.glb');
const target = (await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '')).scene;
const clips = [], manifest = [];
const directory = path.join(reference, 'Assets/Animations/Mixamo');
for (const filename of (await fs.readdir(directory)).filter(name => name.endsWith('.fbx')).sort()) {
  const bytes = await fs.readFile(path.join(directory, filename));
  const rig = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const name = filename.replace(/^X Bot@/, '').replace(/\.fbx$/, '');
  const clip = retargetWorldSpace(rig.animations[0], rig, target);
  if (!clip) throw new Error(`Unmapped animation: ${name}`);
  clip.name = `mixamo:${name}`;
  for (const track of clip.tracks) if (track.times.length === 1) {
    track.times = new Float32Array([0, Math.max(.35, clip.duration)]);
    track.values = new Float32Array([...track.values, ...track.values]);
  }
  clips.push(clip);
  manifest.push({ name, file: filename, sha256: createHash('sha256').update(bytes).digest('hex'), duration: clip.duration, tracks: clip.tracks.length });
}
const front = clips.find(clip => clip.name === 'mixamo:Front Flip');
const back = front.clone(); back.name = 'mixamo:Backflip';
for (const track of back.tracks) {
  const size = track.getValueSize(), count = track.times.length;
  const times = track.times.slice(), values = track.values.slice();
  for (let i = 0; i < count; i++) {
    track.times[i] = back.duration - times[count - 1 - i];
    for (let j = 0; j < size; j++) track.values[i * size + j] = values[(count - 1 - i) * size + j];
  }
}
clips.push(back);
// Export just the calibrated hierarchy and rotations, no duplicate character,
// textures, FBX runtime parser, or Unity-specific muscle curves.
const remove = []; target.traverse(o => { if (o.isMesh) remove.push(o); }); remove.forEach(o => o.removeFromParent());
const glb = await new GLTFExporter().parseAsync(target, { binary: true, animations: clips, onlyVisible: false });
await fs.writeFile('public/assets/animations/mixamo-2099.glb', Buffer.from(glb));
await fs.writeFile('public/assets/animations/manifest.json', JSON.stringify({ source: 'https://github.com/v1shay/SpiderMan', model: 'miguel-2099.glb', method: 'rest-pose quaternion retarget; translation removed; Backflip reverses Front Flip', clips: manifest, generated: ['Backflip'] }, null, 2) + '\n');
console.log(`Imported ${manifest.length} source clips + Backflip; ${(glb.byteLength / 1048576).toFixed(2)} MB`);
