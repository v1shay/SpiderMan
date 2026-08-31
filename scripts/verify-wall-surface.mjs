import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldMeshQuery } from '../lib/mesh-world.ts';
import { probeWallFeet, findMantleTarget } from '../lib/wall-surface.ts';
import { createTraversalState, stepTraversal, refreshTraversalContext } from '../lib/traversal-physics.ts';

const scene = new THREE.Group();
const tower = new THREE.Mesh(new THREE.BoxGeometry(16, 20, 16), new THREE.MeshBasicMaterial());
tower.position.y = 10; scene.add(tower);
const world = await WorldMeshQuery.fromObject(scene);
const cast = (origin, direction, maximum, minNormalY = -1) => world.raycast(origin, direction, maximum, { minNormalY });
for (const normal of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)]) {
  const start = normal.clone().multiplyScalar(8.462); start.y = 16.5;
  let state = createTraversalState(start), reachedMantle = false;
  for (let tick = 0; tick < 240; tick++) {
    const wall = probeWallFeet(state.position, normal, cast);
    if (state.wallCrawlActive) {
      const target = findMantleTarget(state.position, normal, cast, point => world.isCapsuleClear(point));
      if (target) { state.mantle = { target, elapsed: 0 }; state.wallCrawlActive = false; reachedMantle = true; }
    }
    const before = new THREE.Vector3().copy(state.position);
    const input = { wallCrawlPressed: tick === 0, wallClimb: 1 };
    state = stepTraversal(state, input, { groundY: -1000, wallContact: wall,
      sampleGround: (point, maxRise, maxDrop) => world.supportAt(point, { maxRise, maxDrop: maxDrop ?? .1 })?.point.y ?? null }, 1 / 120).state;
    const sweep = world.sweepCapsule(before, state.position, state.velocity);
    state.position = sweep.position; state.velocity = sweep.velocity;
    assert.ok(world.isCapsuleClear(state.position), `crossed real facade/rim: ${JSON.stringify(state.position)}`);
    const support = state.velocity.y <= .1 ? world.supportAt(state.position, { maxRise: .015, maxDrop: .045 }) : null;
    state.grounded = Boolean(support);
    if (support) { state.position.y = support.point.y; state.velocity.y = 0; }
    const nextContact = probeWallFeet(state.position, normal, cast);
    if (!nextContact) { state.wall = null; state.wallCrawlActive = false; }
    refreshTraversalContext(state, input);
  }
  assert.ok(reachedMantle, 'real mesh roof edge was not detected');
  assert.equal(state.mantle, null);
  assert.equal(state.grounded, true);
  assert.ok(Math.abs(state.position.y - 20) < .005);
  assert.ok(Math.abs(state.position.x) < 7.6 && Math.abs(state.position.z) < 7.6);
  console.log(`PASS actual-mesh Q crawl -> rim -> roof (${normal.toArray().join(',')})`);
}
assert.equal(probeWallFeet(new THREE.Vector3(9, 4, 0), new THREE.Vector3(1, 0, 0), cast), null, 'remote walls must not attach');
assert.equal(probeWallFeet(new THREE.Vector3(8.46, 20.2, 0), new THREE.Vector3(1, 0, 0), cast), null, 'feet above the building cannot attach');
assert.equal(findMantleTarget(new THREE.Vector3(8.462, 6, 0), new THREE.Vector3(1, 0, 0), cast, point => world.isCapsuleClear(point)), null, 'no imaginary rooftop halfway up a facade');
const holeCast = (o, d, m, n) => Math.abs(o.z) > .3 ? null : cast(o, d, m, n);
assert.equal(findMantleTarget(new THREE.Vector3(8.462, 19, 0), new THREE.Vector3(1, 0, 0), holeCast, () => true), null, 'reject roof edge without full sole support');
console.log('PASS wall-contact reach, roof support, missing surface and invalid mantle guards');
