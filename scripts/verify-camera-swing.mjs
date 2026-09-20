import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldMeshQuery } from '../lib/mesh-world.ts';
import { createTraversalState, stepTraversalInPlace } from '../lib/traversal-physics.ts';
import { ADVANCED_TRAVERSAL_CONFIG as config } from '../lib/traversal-advanced.ts';
import { createSwingAssistanceState, stepSwingAssistance } from '../lib/swing-assistance.ts';
import { steerSwingHeading } from '../lib/traversal-feel.ts';

const dt = 1 / 120;
const forward = { x: 0, y: 0, z: -1 };
// A building directly beside either shoulder must support forward travel with
// no WASD input. Exercise the actual rope solver, including its constraint.
for (const side of [-1, 1]) {
  const state = createTraversalState({ x: 0, y: 25, z: 0 }, { x: 0, y: -6, z: -30 });
  const anchor = { id: 'side-facade', point: { x: side * 25, y: 65, z: 0 }, kind: 'facade' };
  for (let frame = 0; frame < 360; frame++) {
    stepTraversalInPlace(state, { swingHeld: true, cameraForward: forward },
      { groundY: -10000, anchorCandidates: [anchor] }, dt, config);
    if (frame < 180) assert.ok(state.swing, 'side anchor stays attached through the initial arc');
    assert.ok(-state.velocity.z > 20, 'rope solve must not cancel forward steering later in the arc');
    if (!frame) assert.ok(Math.abs(state.velocity.x) < .1, 'catch does not snap sideways toward the building');
  }
  assert.ok(state.position.z < -90 && Math.abs(state.position.x) < 3,
    `camera-forward progress must dominate side-anchor drift: ${JSON.stringify(state.position)}`);
}

// Turn the camera away from an already attached right-side building. The rope
// position projection must respect that turn as well as the velocity controller.
const veering = createTraversalState({ x: 0, y: 25, z: 0 }, { x: 0, y: -4, z: -32 });
for (let frame = 0; frame < 210; frame++) {
  const cameraForward = frame < 60 ? forward : { x: -.7071, y: 0, z: -.7071 };
  stepTraversalInPlace(veering, { swingHeld: true, cameraForward }, {
    groundY: -10000,
    anchorCandidates: [{ id: 'right-wall', point: { x: 25, y: 70, z: 0 }, kind: 'facade' }],
  }, dt, config);
}
assert.ok(veering.position.x < -20 && veering.velocity.x < -20,
  `camera turn must veer away from the right-hand anchor: ${JSON.stringify(veering.position)}`);

let velocity = { x: 0, y: -8, z: -50 };
for (let frame = 0; frame < 120; frame++) {
  velocity = steerSwingHeading(velocity, { x: 1, y: 0, z: 0 }, dt, config.swingSteerAcceleration);
  assert.equal(velocity.y, -8, 'camera yaw does not create lift');
  assert.ok(Math.abs(Math.hypot(velocity.x, velocity.z) - 50) < 1e-7, 'yaw preserves horizontal speed');
}
assert.ok(velocity.x > 48, 'camera can turn a fast swing without a new forward anchor');

// Include the shared assist budget, rope tension and actual swept mesh collision.
// A fan-only test can pass even when those forces cancel the avoidance in-game.
const routes = [];
for (const width of [6, 32, 100]) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 180, width), new THREE.MeshBasicMaterial());
  wall.position.set(45, 70, 0);
  const world = await WorldMeshQuery.fromObject(wall);
  const state = createTraversalState({ x: 0, y: 35, z: 0 }, { x: 50, y: -2, z: 0 });
  const assistance = createSwingAssistanceState();
  const cameraForward = { x: 1, y: 0, z: 0 };
  let contacts = 0;
  for (let frame = 0; frame < 180; frame++) {
    const before = { ...state.position };
    const assisted = stepSwingAssistance(assistance, {
      position: state.position, velocity: state.velocity, dt,
      swinging: Boolean(state.swing), diving: false, desiredDirection: cameraForward,
    }, (origin, direction, maximum) => world.raycast(origin, direction, maximum));
    stepTraversalInPlace(state, { swingHeld: true, cameraForward }, {
      groundY: -10000, externalCollision: true,
      anchorCandidates: [{ id: 'side', point: { x: 0, y: 110, z: -32 }, kind: 'facade' }],
      predictiveAssistAcceleration: assisted.acceleration,
    }, dt, config);
    const hit = world.sweepCapsule(before, state.position, state.velocity);
    contacts += hit.contacts;
    state.position = { ...hit.position }; state.velocity = { ...hit.velocity };
    assert.ok(world.isCapsuleClear(state.position), 'steering never bypasses collision');
  }
  assert.equal(contacts, 0, `steer before hitting the ${width}m facade`);
  assert.ok(Math.abs(state.position.z) > Math.min(width / 2 + .5, 24), `take a clear lane beside the facade: ${width} ${JSON.stringify(state.position)}`);
  if (width <= 32) assert.ok(state.position.x > 47, 'pass the building while attached');
  routes.push({ width, contacts, position: state.position });
  wall.geometry.dispose(); wall.material.dispose();
}
console.log(JSON.stringify({ passed: true, sideAnchors: 2, cameraTurn: true, routes }));
