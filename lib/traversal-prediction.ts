import * as THREE from 'three';
import type { RepeatingMeshWorld } from './repeating-mesh-world';
import type { Vector3Like } from './traversal-physics';

/** Recalculates a ballistic capsule trajectory against actual triangles. */
export function predictTraversalLanding(world: RepeatingMeshWorld, position: Vector3Like, velocity: Vector3Like) {
  const point = new THREE.Vector3().copy(position), speed = new THREE.Vector3().copy(velocity);
  const dt = .12;
  let time = 0;
  for (let i = 0; i < 20; i++) {
    speed.y -= 29 * dt;
    const next = point.clone().addScaledVector(speed, dt);
    const hit = world.sweepCapsule(point, next, speed);
    time += dt;
    if (hit.grounded || hit.blocked) return { time, point: hit.position, impact: Math.max(0, -speed.y), clear: !hit.wallNormal };
    point.copy(hit.position);
  }
  return { time, point, impact: Math.max(0, -speed.y), clear: true };
}

export function hasRollCorridor(world: RepeatingMeshWorld, position: Vector3Like, velocity: Vector3Like) {
  const direction = new THREE.Vector3(velocity.x, 0, velocity.z).normalize();
  if (direction.lengthSq() < .1) return false;
  const start = new THREE.Vector3().copy(position);
  // The motor retains landing speed. Validate the distance it will actually
  // travel over the roll, including an extra blend-out reserve.
  const distance = Math.max(4, Math.hypot(velocity.x, velocity.z) * .85);
  const end = start.clone().addScaledVector(direction, distance);
  const sweep = world.sweepCapsule(start, end, direction);
  // A supported capsule touches the floor by design. Ground contact is not
  // an obstructed roll corridor; measure the reached endpoint and wall normal.
  if (sweep.wallNormal || sweep.position.distanceTo(end) > .3) return false;
  for (let i = 1; i <= 6; i++) {
    const point = start.clone().lerp(end, i / 6);
    const floor = world.supportAt(point, .12, .25);
    if (!floor || floor.normal.y < .85) return false;
  }
  return true;
}
