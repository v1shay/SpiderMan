import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WebStrand, WEB_STRAND_MAX_SEGMENTS } from '../lib/web-strand.ts';

const bytes = fs.readFileSync(new URL('../public/assets/effects/spiderman-web.glb', import.meta.url));
assert.equal(bytes.toString('utf8', 0, 4), 'glTF');
const jsonLength = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
assert.ok(gltf.meshes?.length > 0, 'downloaded GLB contains renderable web meshes');
assert.ok(gltf.images?.length > 0 && gltf.textures?.length > 0, 'downloaded GLB embeds texture data');
assert.ok(gltf.materials?.some(material => material.pbrMetallicRoughness?.baseColorTexture || material.normalTexture),
  'the web uses an authored texture-bearing material');

const loader = new GLTFLoader();
loader.register(parser => {
  parser.loadTextureImage = () => Promise.resolve(new THREE.Texture());
  return { name: 'web_test_skip_images', loadTexture: () => Promise.resolve(new THREE.Texture()) };
});
const parsed = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const strand = new WebStrand(parsed.scene);
strand.update(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, 8, -149), true, .85);
assert.equal(strand.segmentCount, Math.ceil(Math.hypot(6, 149) / 8));
assert.ok(strand.segmentCount <= WEB_STRAND_MAX_SEGMENTS);
assert.ok(strand.meshes.every(mesh => mesh.count === strand.segmentCount), 'every source tube repeats for the full gameplay rope');
assert.ok(strand.sourceTriangleCount > 0 && strand.maximumTriangles === strand.sourceTriangleCount * WEB_STRAND_MAX_SEGMENTS);
assert.ok(strand.maximumTriangles < 60_000, 'a maximum-length textured rope stays within the realtime triangle budget');
strand.dispose();
console.log(`Downloaded textured web verification passed (${gltf.images.length} embedded image(s), ${strand.sourceTriangleCount} triangles/segment).`);
