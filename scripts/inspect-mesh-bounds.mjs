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
  gltf.scene.updateMatrixWorld(true);
  console.log(`\n${file}`);
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    const box = new THREE.Box3().setFromObject(object, true);
    const size = box.getSize(new THREE.Vector3());
    console.log(`${object.name}\t${object.geometry.attributes.position.count}\t${size.toArray().map((v) => v.toFixed(3)).join('x')}`);
  });
}
