import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CityHorizon } from '../lib/city-horizon.ts';
import { DISTRICTS } from '../lib/game-config.ts';
const loader = new GLTFLoader();
for (const config of DISTRICTS) {
  const bytes = fs.readFileSync(`public${config.horizonModel}`);
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  const box = new THREE.Box3().setFromObject(gltf.scene),
    size = box.getSize(new THREE.Vector3());
  assert.ok(size.y > 0 && size.x > 0 && size.z > 0);
  const scale = config.targetWidth / Math.max(size.x, size.z);
  const horizon = new CityHorizon(
    gltf.scene,
    new THREE.Matrix4().makeScale(scale, scale, scale),
    gltf.scene,
    config.targetWidth + 8,
    size.z * scale + 8,
  );
  const camera = new THREE.PerspectiveCamera(66, 1, 0.08, 2800);
  const full = new Map([['0:0', true]]);
  for (const x of [0, config.targetWidth, 100000, -100000]) {
    const position = new THREE.Vector3(x, 150, 0);
    camera.position.copy(position);
    camera.lookAt(x, 80, -1000);
    horizon.update(camera, position, full);
    assert.ok(
      horizon.root.userData.tileCount > 10,
      `${config.id} distant skyline visible at ${x}`,
    );
    for (const mesh of horizon.root.children) {
      assert.ok(mesh.count <= mesh.instanceMatrix.count);
      for (let i = 0; i < mesh.count; i++) {
        const matrix = new THREE.Matrix4();
        mesh.getMatrixAt(i, matrix);
        assert.ok(matrix.elements.every(Number.isFinite));
        assert.ok(
          matrix.elements[12] !== 0 || matrix.elements[14] !== 0,
          'full detail tile excluded',
        );
      }
    }
  }
  horizon.dispose();
  console.log(
    `PASS ${config.id}: horizon geometry, full-tile exclusion, capacity, distant positive/negative travel`,
  );
}
