import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const loader = new GLTFLoader();
loader.register((parser) => {
  parser.loadTextureImage = () => Promise.resolve(new THREE.Texture());
  return { name: 'CPU textures' };
});
for (const file of process.argv.slice(2)) {
  const bytes = await fs.readFile(file);
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const totals = new Map();
  gltf.scene.traverse((object) => {
    if (!object.isSkinnedMesh) return;
    const indices = object.geometry.getAttribute('skinIndex');
    const weights = object.geometry.getAttribute('skinWeight');
    for (let vertex = 0; vertex < indices.count; vertex++) {
      for (let component = 0; component < 4; component++) {
        const bone = object.skeleton.bones[indices.getComponent(vertex, component)];
        const weight = weights.getComponent(vertex, component);
        if (bone && weight > 0) totals.set(bone.name, (totals.get(bone.name) ?? 0) + weight);
      }
    }
  });
  console.log(`\n${file}`);
  for (const [name, weight] of [...totals].sort((a, b) => b[1] - a[1])) console.log(`${weight.toFixed(2)}\t${name}`);
}
