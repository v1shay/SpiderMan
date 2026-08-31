import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldMeshQuery, capsuleSupportHeight } from '../lib/mesh-world.ts';

const material = new THREE.MeshBasicMaterial();
const scene = new THREE.Group();
const floor = new THREE.Mesh(new THREE.BoxGeometry(100, .2, 100), material);
floor.position.y = -.1;
const wall = new THREE.Mesh(new THREE.PlaneGeometry(20, 12), material);
wall.rotation.y = Math.PI / 2;
wall.position.set(4, 6, 0);
const roof = new THREE.Mesh(new THREE.BoxGeometry(8, 12, 8), material);
roof.position.set(-12, 6, 0);
const canopy = new THREE.Mesh(new THREE.BoxGeometry(4, .12, 4), material);
canopy.position.set(12, 3, 0);
scene.add(floor, wall, roof, canopy);
const proxy = new THREE.Mesh(new THREE.BoxGeometry(20, 50, 20), new THREE.MeshBasicMaterial({ colorWrite: false }));
proxy.position.set(30, 25, 0);
scene.add(proxy);
const hidden = new THREE.Mesh(new THREE.BoxGeometry(10, 100, 10), material);
hidden.visible = false;
scene.add(hidden);
const query = await WorldMeshQuery.fromObject(scene);
assert.equal(query.triangleCount, 38, 'ignore hidden meshes and proxy faces');
const surface = query.supportAt({ x: -12, y: 12.02, z: 0 });
assert.ok(surface && Math.abs(surface.point.y - 12) < 1e-6);
assert.equal(query.hasSurface({ x: -12, y: 12, z: 0 }), true);
assert.equal(query.hasSurface({ x: 30, y: 50, z: 0 }), false, 'proxy top is not a rendered roof');
assert.equal(query.raycast({ x: 0, y: 4, z: 0 }, { x: 1, y: 0, z: 0 }, 10)?.point.x, 4);

for (const distance of [6, 20, 100]) {
  const hit = query.sweepCapsule({ x: 0, y: 3, z: 0 }, { x: distance, y: 3, z: 0 }, { x: 150, y: 0, z: 0 });
  assert.ok(hit.position.x <= 4 - .459, `cannot tunnel through thin wall at ${distance}m displacement`);
  assert.ok(Math.abs(hit.velocity.x) < 1e-6, 'remove incoming normal velocity');
  assert.equal(hit.grounded, false);
}
const backFace = query.sweepCapsule({ x: 8, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }, { x: -150, y: 0, z: 0 });
assert.ok(backFace.position.x >= 4 + .459, 'collision is double-sided even for one-sided imported walls');
const slide = query.sweepCapsule({ x: 0, y: 3, z: -4 }, { x: 10, y: 3, z: 4 }, { x: 30, y: 0, z: 24 });
assert.ok(slide.position.x < 3.55 && slide.position.z > 3.5, 'preserve wall tangent motion');
assert.ok(slide.velocity.z > 23);
const parallel = query.sweepCapsule({ x: 3.5, y: 3, z: -8 }, { x: 3.5, y: 3, z: 8 }, { x: 0, y: 0, z: 60 });
assert.equal(parallel.contacts, 0, 'nearby facades do not bump the avatar without actual capsule contact');
assert.ok(Math.abs(parallel.position.z - 8) < 1e-6 && Math.abs(parallel.position.x - 3.5) < 1e-6);
const landing = query.sweepCapsule({ x: -12, y: 30, z: 0 }, { x: -12, y: 1, z: 0 }, { x: 0, y: -150, z: 0 });
assert.ok(Math.abs(landing.position.y - 12.002) < .01, 'feet stop on visible roof');
assert.equal(landing.grounded, true);
const ceiling = query.sweepCapsule({ x: 12, y: 0, z: 0 }, { x: 12, y: 5, z: 0 }, { x: 0, y: 15, z: 0 });
assert.ok(ceiling.position.y + 2.05 < 2.941, 'full 2.05m avatar head stops under overhang');
assert.ok(ceiling.velocity.y <= .001);
const floorSlide = query.sweepCapsule({ x: 0, y: .002, z: 20 }, { x: 10, y: -.2, z: 20 }, { x: 30, y: -3, z: 0 });
assert.ok(floorSlide.position.x > 9.9 && Math.abs(floorSlide.position.y - .002) < .01, 'floor contact never freezes horizontal traversal');
assert.equal(floorSlide.grounded, true);
const edge = query.sweepCapsule({ x: -12, y: 12.002, z: 0 }, { x: -12, y: 12.002, z: 10 }, { x: 0, y: 0, z: 30 });
assert.equal(edge.grounded, false, 'walking off roof clears old support');
const roofSpawn = query.findRoofSpawn([new THREE.Box3(new THREE.Vector3(-16, 0, -4), new THREE.Vector3(-8, 12, 4))]);
assert.ok(roofSpawn && Math.abs(roofSpawn.y - 12.002) < .001);
assert.equal(query.isCapsuleClear(roofSpawn), true);
assert.equal(query.isCapsuleClear({ x: 4, y: 3, z: 0 }), false);
assert.equal(query.isCapsuleClear({ x: -12, y: 4, z: 0 }), false, 'reject invalid spawn deep inside closed building, away from its faces');
assert.equal(query.findRoofSpawn([new THREE.Box3(new THREE.Vector3(20, 0, -10), new THREE.Vector3(40, 50, 10))]), null, 'do not spawn on an invisible AABB');

// Instanced geometry has real transformed support, not its base geometry bounds.
const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(4, 6, 4), material, 2);
instanced.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 3, 0));
instanced.setMatrixAt(1, new THREE.Matrix4().makeTranslation(10, 6, 0));
const instanceQuery = await WorldMeshQuery.fromObject(instanced);
assert.equal(instanceQuery.triangleCount, 24);
assert.ok(instanceQuery.hasSurface({ x: 10, y: 9, z: 0 }));
assert.ok(instanceQuery.hasSurface({ x: 0, y: 6, z: 0 }));
assert.equal(instanceQuery.hasSurface({ x: 5, y: 6, z: 0 }), false);

const cornerScene = new THREE.Group();
const cornerA = new THREE.Mesh(new THREE.PlaneGeometry(20, 12), material);
cornerA.rotation.y = Math.PI / 2;
cornerA.position.set(4, 6, 0);
const cornerB = new THREE.Mesh(new THREE.PlaneGeometry(20, 12), material);
cornerB.position.set(0, 6, 4);
cornerScene.add(cornerA, cornerB);
const cornerQuery = await WorldMeshQuery.fromObject(cornerScene);
const cornerHit = cornerQuery.sweepCapsule({ x: 0, y: 3, z: 0 }, { x: 15, y: 3, z: 15 }, { x: 80, y: 0, z: 80 });
assert.ok(cornerHit.position.x <= 3.541 && cornerHit.position.z <= 3.541, 'dual facade corner cannot push the capsule through either plane');
assert.ok(cornerQuery.isCapsuleClear(cornerHit.position));
// The same geometric sweep must own a rope-constraint correction, not only
// velocity integration. A projected rope endpoint on the far side stays blocked.
const ropeProjection = cornerQuery.sweepCapsule({ x: 0, y: 4, z: 0 }, { x: 7, y: 8, z: 0 }, { x: 30, y: 12, z: 0 });
assert.ok(ropeProjection.position.x <= 3.541 && ropeProjection.position.y > 7.9);
const raisedScene = new THREE.Group();
raisedScene.add(floor.clone());
const raised = new THREE.Mesh(new THREE.BoxGeometry(8, .18, 8), material);
raised.position.set(6, .09, 0);
raisedScene.add(raised);
const raisedQuery = await WorldMeshQuery.fromObject(raisedScene);
const raisedSupport = raisedQuery.supportAt({ x: 6, y: 0, z: 0 }, { maxRise: .25, maxDrop: .05 });
assert.ok(raisedSupport && Math.abs(raisedSupport.point.y - .18) < 1e-6);
const stepUp = raisedQuery.sweepCapsule({ x: 0, y: .002, z: 0 }, { x: 6, y: -.04, z: 0 }, { x: 12, y: -.1, z: 0 });
assert.ok(stepUp.position.x > 5.9 && stepUp.position.y >= .179, 'small raised sidewalk cannot be walked through');

const ledgeScene = new THREE.Group();
const tower = new THREE.Mesh(new THREE.BoxGeometry(16, 20, 16), material);
tower.position.y = 10;
const cornice = new THREE.Mesh(new THREE.BoxGeometry(20, .2, 20), material);
cornice.position.y = 14.9;
ledgeScene.add(tower, cornice);
const ledgeQuery = await WorldMeshQuery.fromObject(ledgeScene);
const ledgeBounds = new THREE.Box3(new THREE.Vector3(7, 0, -2), new THREE.Vector3(11, 15, 2));
const broadRoofSpawn = ledgeQuery.findRoofSpawn([ledgeBounds]);
assert.ok(broadRoofSpawn && Math.abs(broadRoofSpawn.y - 20.002) < .001, 'facade cornice bounds must find actual broad rooftop above ledge');
for (let direction = 0; direction < 8; direction++) {
  const angle = direction * Math.PI / 4;
  assert.ok(ledgeQuery.hasSurface({ x: broadRoofSpawn.x + Math.cos(angle) * 2, y: broadRoofSpawn.y, z: broadRoofSpawn.z + Math.sin(angle) * 2 }));
}

// A center-downward ray on a slope lies below the capsule's actual tangent
// support. Snapping to rayY made every frame re-penetrate and falsely fall/jump.
const grade = Math.tan(Math.PI / 6);
const rampGeometry = new THREE.BufferGeometry();
rampGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-12, -12 * grade, -8, 12, 12 * grade, -8, 12, 12 * grade, 8, -12, -12 * grade, 8], 3));
rampGeometry.setIndex([0, 2, 1, 0, 3, 2]);
const rampQuery = await WorldMeshQuery.fromObject(new THREE.Mesh(rampGeometry, material));
const rampSurface = rampQuery.supportAt({ x: 0, y: .05, z: 0 });
let rampPosition = new THREE.Vector3(0, capsuleSupportHeight(rampSurface), 0);
for (let frame = 0; frame < 90; frame++) {
  const result = rampQuery.sweepCapsule(rampPosition, rampPosition.clone().add(new THREE.Vector3(.06, -.008, 0)), new THREE.Vector3(3.6, -.5, 0));
  assert.equal(result.grounded, true, 'walkable slope must keep support across every frame');
  assert.ok(rampQuery.isCapsuleClear(result.position), 'slope support must not reinsert capsule into the floor');
  assert.ok(Math.abs(result.position.y - (grade * result.position.x + .002 + .46 * (1 / Math.cos(Math.PI / 6) - 1))) < .003);
  rampPosition = result.position;
}
assert.ok(rampPosition.x > 4, 'grounding must preserve uphill movement');
for (let index = 0; index < 16; index++) {
  const angle = index * Math.PI / 8;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), material);
  panel.position.y = 10;
  panel.rotation.y = angle;
  const panelQuery = await WorldMeshQuery.fromObject(panel);
  const normal = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
  const start = normal.clone().multiplyScalar(8).add(new THREE.Vector3(0, 5, 0));
  const end = normal.clone().multiplyScalar(-8).add(new THREE.Vector3(0, 5, 0));
  const result = panelQuery.sweepCapsule(start, end, normal.clone().multiplyScalar(-120));
  assert.ok(result.position.clone().sub(new THREE.Vector3(0, 5, 0)).dot(normal) >= .458, `rotated thin facade ${index} cannot be tunneled through`);
  assert.ok(panelQuery.isCapsuleClear(result.position));
}
console.log('PASS: true roof/foot support, proxy exclusion, thin-wall sweeps both sides, corners, rope projection, raised sidewalks, ceilings, roof edges, interior spawn rejection, instanced transforms.');
