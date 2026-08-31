import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { WorldMeshQuery } from '../lib/mesh-world.ts';
import { DISTRICTS } from '../lib/game-config.ts';

// Geometry verification only: this intentionally skips image decoding, not mesh
// decoding, instance transforms, material visibility, or collision faces. Texture
// appearance and the procedural landmark placement still need browser checks.
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register((parser) => {
  parser.loadTextureImage = () => Promise.resolve(new THREE.Texture());
  return { name: 'geometry_audit_skip_images', loadTexture: () => Promise.resolve(new THREE.Texture()) };
});
const requested = new Set(process.argv.slice(2));
const maps = requested.size ? DISTRICTS.filter(map => requested.has(map.id)) : DISTRICTS;
assert.ok(maps.length, 'Pass a valid district id, or omit arguments for all maps.');
for (const config of maps) {
  const bytes = fs.readFileSync(new URL(`../public${config.model}`, import.meta.url));
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const embedded = [];
  gltf.scene.traverse(object => { if (object instanceof THREE.SkinnedMesh) embedded.push(object); });
  for (const object of embedded) object.parent?.remove(object);
  const originalBounds = new THREE.Box3().setFromObject(gltf.scene);
  const sourceSize = originalBounds.getSize(new THREE.Vector3());
  const modelScale = config.targetWidth / Math.max(sourceSize.x, sourceSize.z, .001);
  gltf.scene.scale.setScalar(modelScale);
  gltf.scene.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  gltf.scene.position.set(-center.x, -config.sourceGroundY * modelScale, -center.z);
  const root = new THREE.Group();
  root.position.set(...config.position);
  root.rotation.y = config.rotation ?? 0;
  root.add(gltf.scene);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(size.x + 12, .28, size.z + 12), new THREE.MeshBasicMaterial());
  floor.position.y = -.16;
  root.add(floor);
  root.updateWorldMatrix(true, true);
  const metadata = JSON.parse(fs.readFileSync(new URL(`../public${config.collisionData}`, import.meta.url)));
  const scale = config.targetWidth / metadata.sourceWidth;
  const sourceBoxes = metadata.colliders.map(source => {
    const box = new THREE.Box3().makeEmpty();
    for (const x of [source[0], source[3]]) for (const y of [source[1], source[4]]) for (const z of [source[2], source[5]]) {
      box.expandByPoint(new THREE.Vector3(x * scale, y * scale, z * scale)
        .add(gltf.scene.position).applyMatrix4(root.matrixWorld));
    }
    return box;
  }).filter(box => box.max.y > 4.12 && box.max.x - box.min.x > 1.2 && box.max.z - box.min.z > 1.2);
  if (!sourceBoxes.length) {
    // Match the game's broad search hints when tiny source components contain
    // no viable roof-sized box. These hints are never accepted as real support.
    const shortSide = Math.max(4, Math.min(size.x, size.z));
    const road = THREE.MathUtils.clamp(shortSide * .18, Math.min(2, shortSide * .2), shortSide * .45);
    const blockWidth = Math.max(2, (size.x - road) / 2);
    const blockDepth = Math.max(2, (size.z - road) / 2);
    for (const xSign of [-1, 1]) for (const zSign of [-1, 1]) {
      const x = config.position[0] + xSign * (road / 2 + blockWidth / 2);
      const z = config.position[2] + zSign * (road / 2 + blockDepth / 2);
      sourceBoxes.push(new THREE.Box3(new THREE.Vector3(x - blockWidth / 2, 0, z - blockDepth / 2),
        new THREE.Vector3(x + blockWidth / 2, Math.max(12, size.y), z + blockDepth / 2)));
    }
  }
  const worldBounds = new THREE.Box3().setFromObject(root);
  const worldCenter = worldBounds.getCenter(new THREE.Vector3());
  const worldSize = worldBounds.getSize(new THREE.Vector3());
  const centralBoxes = sourceBoxes.filter(box => {
    const point = box.getCenter(new THREE.Vector3());
    return Math.abs(point.x - worldCenter.x) < Math.max(8, worldSize.x * .34)
      && Math.abs(point.z - worldCenter.z) < Math.max(8, worldSize.z * .34);
  });
  const candidateBoxes = [...centralBoxes.sort((a, b) => b.max.y - a.max.y),
    ...sourceBoxes.filter(box => !centralBoxes.includes(box)).sort((a, b) => b.max.y - a.max.y)];
  const start = performance.now();
  const query = await WorldMeshQuery.fromObject(root);
  const buildMs = performance.now() - start;
  assert.ok(query.triangleCount > 100, `${config.id}: decoded real mesh triangles`);
  assert.ok(query.byteLength < 25 * 1024 * 1024, `${config.id}: bounded shared collision memory`);
  const spawn = query.findRoofSpawn(candidateBoxes);
  if (!spawn) console.error('No roof candidates', config.id, candidateBoxes.slice(0, 8).map(box => [...box.min.toArray(), ...box.max.toArray()]));
  assert.ok(spawn, `${config.id}: at least one real, stable rooftop spawn`);
  assert.ok(spawn.y > 2, `${config.id}: rooftop selection must not silently fall back to pavement`);
  assert.ok(query.hasSurface(spawn), `${config.id}: feet have real triangle support`);
  assert.ok(query.isCapsuleClear(spawn), `${config.id}: avatar clear of roof structures`);
  if (config.id === 'new-york-city') {
    assert.ok(spawn.y > 150, 'NYC must spawn on the actual broad tower roof, not the previous y135 facade ledge');
    for (let direction = 0; direction < 8; direction++) {
      const angle = direction * Math.PI / 4;
      assert.ok(query.hasSurface({ x: spawn.x + Math.cos(angle) * 2, y: spawn.y, z: spawn.z + Math.sin(angle) * 2 }, .12), 'NYC spawn has two meters of supported roof in every direction');
    }
  }
  const support = query.supportAt(spawn);
  assert.ok(support.normal.y > .85, `${config.id}: roof is walkable, not a facade`);
  const falling = query.sweepCapsule(spawn.clone().add(new THREE.Vector3(0, 6, 0)), spawn.clone().add(new THREE.Vector3(0, -1, 0)), new THREE.Vector3(0, -88, 0));
  assert.ok(falling.position.y >= spawn.y - .01, `${config.id}: dive cannot penetrate spawn roof`);
  assert.equal(falling.grounded, true, `${config.id}: roof contact is grounded`);
  assert.ok(query.isCapsuleClear(falling.position), `${config.id}: landing is outside visible mesh`);
  // Tight repeated samples near a rendered roof: timing is a Node geometry
  // benchmark, not a claim about browser FPS or GPU rendering performance.
  const before = performance.now();
  for (let i = 0; i < 120; i++) query.sweepCapsule(spawn, spawn.clone().add(new THREE.Vector3(.2, -.04, .05)), new THREE.Vector3(12, -2, 3));
  const sweepMs = (performance.now() - before) / 120;
  console.log(JSON.stringify({ map: config.id, triangles: query.triangleCount, memoryMB: +(query.byteLength / 1048576).toFixed(2), buildMs: +buildMs.toFixed(1), sweepMs: +sweepMs.toFixed(3), rooftopFeet: spawn.toArray().map(value => +value.toFixed(3)), grounded: falling.grounded }));
}
console.log(`PASS: ${maps.length} source maps have triangle-backed, capsule-clear rooftop spawns and no roof penetration in an 88 m/s descent.`);
