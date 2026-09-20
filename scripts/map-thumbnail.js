import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DISTRICTS, SUITS } from '/lib/game-config.ts';
import { normalizeSuit, prepareMaterials, retargetMixamoClips } from '/lib/three-assets.ts';
import {
  supportLegacyMaterials,
  calibrate2099Materials,
} from '/lib/gltf-materials.ts';
const params = new URLSearchParams(location.search),
  suit = SUITS.find((s) => s.id === params.get('suit')),
  config = DISTRICTS.find((c) => c.id === params.get('city')) ?? DISTRICTS[0];
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
const renderWidth = suit ? 512 : 960;
const renderHeight = suit ? 512 : 600;
renderer.setSize(renderWidth, renderHeight);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(suit ? '#071421' : '#8da9bb');
const camera = new THREE.PerspectiveCamera(
  suit ? 36 : 52,
  renderWidth / renderHeight,
  0.1,
  10000,
);
scene.add(
  new THREE.HemisphereLight('#d9efff', '#280b11', 2),
  new THREE.DirectionalLight('#ffffff', 3),
);
const loader = supportLegacyMaterials(new GLTFLoader());
const g = await loader.loadAsync(suit?.model ?? config.model);
prepareMaterials(g.scene, renderer, suit ? 'character' : 'baked');
scene.add(g.scene);
if (suit) {
  calibrate2099Materials(g.scene);
  if (suit.animationSource && params.get('pose') !== 'rest') {
    const library = await loader.loadAsync(suit.animationSource);
    const clips = retargetMixamoClips(library.animations, library.scene, g.scene);
    const idle = clips.find((clip) => clip.name === 'mixamo:Idle');
    if (idle) {
      const mixer = new THREE.AnimationMixer(g.scene);
      const action = mixer.clipAction(idle).play();
      action.time = idle.duration * .35;
      mixer.update(0);
      g.scene.updateMatrixWorld(true);
    }
  }
  normalizeSuit(g.scene, suit, 2.1);
  const framingRoot = (suit.normalizationMesh && g.scene.getObjectByName(suit.normalizationMesh)) || g.scene;
  const box = new THREE.Box3().setFromObject(framingRoot, true),
    size = box.getSize(new THREE.Vector3()),
    center = box.getCenter(new THREE.Vector3()),
    targetY = box.min.y + size.y * 0.72,
    distance = Math.max(2.15, size.y * 0.92, size.x * 1.2);
  camera.position.set(center.x, targetY, center.z - distance);
  camera.lookAt(center.x, targetY, center.z);
} else {
  const box = new THREE.Box3().setFromObject(g.scene),
    size = box.getSize(new THREE.Vector3()),
    center = box.getCenter(new THREE.Vector3());
  camera.position
    .copy(center)
    .add(
      new THREE.Vector3(
        size.x * 0.6,
        size.y * 0.8 + size.z * 0.28,
        size.z * 0.7,
      ),
    );
  camera.lookAt(center.x, box.min.y + size.y * 0.3, center.z);
}
camera.updateProjectionMatrix();
renderer.render(scene, camera);
window.thumbnailReady = true;
