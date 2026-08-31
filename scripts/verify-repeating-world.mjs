import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldMeshQuery } from '../lib/mesh-world.ts';
import { RepeatingMeshWorld } from '../lib/repeating-mesh-world.ts';
const root = new THREE.Group(), material = new THREE.MeshBasicMaterial();
const floor = new THREE.Mesh(new THREE.BoxGeometry(24, .2, 24), material); floor.position.y = -.1; root.add(floor);
const wall = new THREE.Mesh(new THREE.BoxGeometry(.12, 18, 12), material); wall.position.set(8, 9, 0); root.add(wall);
const query = await WorldMeshQuery.fromObject(root), world = new RepeatingMeshWorld(query, 20, 20);
for (const tile of [-500, -1, 0, 1, 500]) {
  const x = tile * 20;
  assert.ok(world.supportAt({ x, y: .01, z: 0 }), 'support is independent of rendered tile membership');
  const ray = world.raycast({ x, y: 6, z: 0 }, { x: 1, y: 0, z: 0 }, 15);
  assert.ok(ray && Math.abs(ray.point.x - (x + 7.94)) < .001);
  const hit = world.sweepCapsule({ x, y: 6, z: 0 }, { x: x + 30, y: 6, z: 0 }, { x: 100, y: 0, z: 0 });
  assert.ok(hit.position.x < x + 7.49 && hit.position.x > x + 7.4, 'cannot tunnel into a not-yet-rendered tile');
  assert.ok(world.isCapsuleClear(hit.position));
}
const seam = world.sweepCapsule({ x: 9.1, y: .002, z: -9 }, { x: 13, y: -.01, z: -9 }, { x: 30, y: -1, z: 0 });
assert.ok(seam.position.x > 12.9 && seam.position.y >= -.001, 'overlapping floor seams preserve forward motion');
assert.ok(seam.grounded && world.isCapsuleClear(seam.position));
const corner = new THREE.Group(); corner.add(floor.clone());
const a = new THREE.Mesh(new THREE.PlaneGeometry(12, 15), material); a.rotation.y = Math.PI / 2; a.position.set(9.7, 7.5, 0);
const b = new THREE.Mesh(new THREE.PlaneGeometry(12, 15), material); b.position.set(-9.7, 7.5, 4); corner.add(a,b);
const cornerWorld = new RepeatingMeshWorld(await WorldMeshQuery.fromObject(corner), 20, 20);
const result = cornerWorld.sweepCapsule({ x: 8, y: 3, z: 0 }, { x: 13, y: 4, z: 9 }, { x: 90, y: 12, z: 90 });
assert.ok(cornerWorld.isCapsuleClear(result.position), 'neighbor correction must remain outside every tile');
assert.ok(result.position.x < 9.25, 'corner slide cannot cross the first tile wall');
console.log('PASS repeated-world collision: unseen/negative/far tiles, thin walls, seam ground continuity, multi-tile corners.');
