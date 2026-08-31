import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldMeshQuery } from '../lib/mesh-world.ts';
import { createSwingAssistanceState, stepSwingAssistance } from '../lib/swing-assistance.ts';

const input = { position: { x: 0, y: 10, z: 0 }, velocity: { x: 32, y: -4, z: 0 }, dt: 1 / 60, swinging: true, diving: false };
const openState = createSwingAssistanceState();
let rays = 0;
const emptyProbe = () => { rays++; return null; };
for (let frame = 0; frame < 60; frame++) {
  const result = stepSwingAssistance(openState, input, emptyProbe);
  assert.equal(result, openState, 'reuse one mutable result/state buffer');
  assert.deepEqual(result.velocity, input.velocity, 'open air leaves momentum untouched');
  assert.equal(result.groundLift, 0, 'ground assist belongs to traversal solver only');
  assert.equal(result.active, false);
  assert.ok(result.probeCount <= 9);
}
assert.ok(rays <= 55, `cache should limit one stationary second to <=55 probes, got ${rays}`);

const material = new THREE.MeshBasicMaterial();
const building = new THREE.Mesh(new THREE.BoxGeometry(2, 24, 6), material);
building.position.set(20, 12, 0);
const world = await WorldMeshQuery.fromObject(building);
const probe = (origin, direction, maximum) => world.raycast(origin, direction, maximum);
const state = createSwingAssistanceState();
const immutablePosition = { ...input.position };
let result = stepSwingAssistance(state, { ...input, desiredDirection: { x: .7, y: 0, z: .7 } }, probe);
assert.ok(result.active && result.velocity.z > 0, 'predictive fan respects intent toward the open right lane');
assert.deepEqual(input.position, immutablePosition, 'assistance never mutates/teleports position');
assert.equal(result.velocity.y, input.velocity.y, 'assistance must not add ascent or fight gravity');
assert.ok(Math.hypot(result.velocity.x, result.velocity.z) <= 32 + 1e-9);
assert.ok(Math.abs(result.steering) <= 1.25, 'steering rate is bounded');

// Integrate assistance then apply real mesh collision, exactly the authority
// order expected by SpiderGame. A narrow tower should route into the clear lane.
const position = new THREE.Vector3(0, 10, 0);
const velocity = new THREE.Vector3(32, 0, 0);
const routeState = createSwingAssistanceState();
let routeContacts = 0;
for (let frame = 0; frame < 90; frame++) {
  result = stepSwingAssistance(routeState, { position, velocity, dt: 1 / 60, swinging: true, diving: false, desiredDirection: { x: .7, y: 0, z: .7 } }, probe);
  const proposed = position.clone().addScaledVector(new THREE.Vector3().copy(result.velocity), 1 / 60);
  const hit = world.sweepCapsule(position, proposed, result.velocity);
  position.copy(hit.position);
  velocity.copy(hit.velocity);
  routeContacts += hit.contacts;
  assert.ok(world.isCapsuleClear(position), 'assistance can never bypass collision authority');
}
assert.ok(position.x > 26 && position.z > 3.46, 'clear-lane steering should pass the narrow tower');
assert.equal(routeContacts, 0, 'predict before contact instead of bouncing off the wall');

const diveState = createSwingAssistanceState();
result = stepSwingAssistance(diveState, { ...input, diving: true }, () => { throw new Error('deliberate dive must not query assistance'); });
assert.deepEqual(result.velocity, input.velocity);
assert.equal(result.active, false);
assert.equal(result.probeCount, 0);
result = stepSwingAssistance(state, { ...input, swinging: false }, () => { throw new Error('walking must not run swing assistance'); });
assert.deepEqual(result.velocity, input.velocity);

const shoulderState = createSwingAssistanceState();
result = stepSwingAssistance(shoulderState, input, (origin, direction) =>
  Math.abs(direction.z) < .001 && origin.z > .3 ? { distance: 8, normal: { x: -1, y: 0, z: 0 } } : null);
assert.ok(result.active, 'shoulder envelope detects a corner missed by the center line');
assert.equal(result.probeCount, 9);
const floorState = createSwingAssistanceState();
result = stepSwingAssistance(floorState, input, () => ({ distance: 1, normal: { x: 0, y: 1, z: 0 } }));
assert.equal(result.active, false, 'ground triangles must not trigger horizontal building avoidance');
assert.deepEqual(result.velocity, input.velocity);

const closed = createSwingAssistanceState();
const imminent = { ...input, velocity: { x: 60, y: -11, z: 0 } };
result = stepSwingAssistance(closed, imminent, () => ({ distance: 1, normal: { x: -1, y: 0, z: 0 } }));
assert.ok(result.velocity.x > 0, 'bounded braking never reflects/bounces the velocity');
assert.ok(60 - Math.hypot(result.velocity.x, result.velocity.z) <= 18 / 60 + 1e-6);
assert.equal(result.velocity.y, -11);
const budget = createSwingAssistanceState();
stepSwingAssistance(budget, input, probe);
assert.equal(stepSwingAssistance(budget, input, probe).probeCount, 0, 'reuse the unchanged fan');
assert.ok(stepSwingAssistance(budget, { ...input, position: { x: 8, y: 10, z: 0 } }, probe).probeCount > 0, 'large movement invalidates stale cached lanes');
console.log(JSON.stringify({ passed: true, openAirProbeCountPerSecond: rays, routedPosition: position.toArray(), routeContacts, maximumRaysPerRefresh: 9 }));
