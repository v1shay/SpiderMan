import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  WebStrand,
  WEB_STRAND_MAX_SEGMENTS,
  WEB_STRAND_MODEL,
} from '../lib/web-strand.ts';

const bytes = await fs.readFile(`public${WEB_STRAND_MODEL}`);
assert.equal(
  crypto.createHash('sha256').update(bytes).digest('hex'),
  'dc10e1e089add986da1e758a33438a286542a486834362320a75a328110331d2',
  'the shipped effect must remain the downloaded Spider-Man web GLB',
);
const loader = new GLTFLoader();
loader.register((parser) => {
  parser.loadTextureImage = () => Promise.resolve(new THREE.Texture());
  return { name: 'CPU texture placeholder' };
});
const gltf = await loader.parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  '',
);
const strand = new WebStrand(gltf.scene);
assert.ok(strand.sourceTriangleCount > 0);
assert.ok(strand.maximumTriangles <= strand.sourceTriangleCount * WEB_STRAND_MAX_SEGMENTS);
strand.update(new THREE.Vector3(1, 2, 3), new THREE.Vector3(1, 10, -25), true, .7);
assert.equal(strand.group.visible, true);
assert.ok(strand.segmentCount > 1 && strand.segmentCount <= WEB_STRAND_MAX_SEGMENTS);
for (const mesh of strand.meshes) {
  assert.equal(mesh.count, strand.segmentCount);
  for (let index = 0; index < mesh.count; index++) {
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(index, matrix);
    assert.ok(matrix.elements.every(Number.isFinite));
  }
}
strand.update(new THREE.Vector3(), new THREE.Vector3(), false);
assert.equal(strand.group.visible, false);
strand.dispose();
console.log('PASS: downloaded web GLB is instanced into finite, bounded swing and zip strands.');
