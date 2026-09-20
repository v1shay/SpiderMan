import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SUITS } from '../lib/game-config.ts';
import { normalizeSuit, retargetMixamoClips } from '../lib/three-assets.ts';
const loader = new GLTFLoader();
loader.register((parser) => {
  parser.loadTextureImage = () => Promise.resolve(new THREE.Texture());
  return { name: 'CPU' };
});
const load = async (url) => {
  const bytes = await fs.readFile(`public${url}`);
  return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
};
for (const id of process.argv.slice(2)) {
  const suit = SUITS.find((item) => item.id === id);
  const model = await load(suit.model);
  const library = await load(suit.animationSource);
  const clips = retargetMixamoClips(library.animations, library.scene, model.scene);
  const idle = clips.find((clip) => clip.name === 'mixamo:Idle');
  const mixer = new THREE.AnimationMixer(model.scene);
  const action = mixer.clipAction(idle).play();
  action.time = idle.duration * .35;
  mixer.update(0);
  model.scene.updateMatrixWorld(true);
  const normalized = normalizeSuit(model.scene, suit, 2.1);
  model.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model.scene, true);
  console.log(`\n${id}`, {
    normalized: normalized.getSize(new THREE.Vector3()).toArray(),
    box: box.getSize(new THREE.Vector3()).toArray(),
    center: box.getCenter(new THREE.Vector3()).toArray(),
  });
  model.scene.traverse((object) => {
    if (!object.isMesh || !object.visible) return;
    const meshBox = new THREE.Box3().setFromObject(object, true);
    console.log(object.name, meshBox.getSize(new THREE.Vector3()).toArray(), meshBox.getCenter(new THREE.Vector3()).toArray());
  });
}
