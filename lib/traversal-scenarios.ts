import * as THREE from 'three';
import type { RepeatingMeshWorld } from './repeating-mesh-world';
import { hasRollCorridor } from './traversal-prediction.ts';
import { capsuleSupportHeight } from './mesh-world.ts';

export function findRollScenario(world: RepeatingMeshWorld) {
  for (let x = -60; x <= 60; x += 10) for (let z = -60; z <= 60; z += 10) {
    const support = world.supportAt({ x, y: 3, z }, 0, 6);
    if (!support || support.normal.y < .95) continue;
    const point = support.point.clone(); point.y = capsuleSupportHeight(support);
    if (!world.isCapsuleClear(point)) continue;
    for (const direction of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)]) {
      if (!hasRollCorridor(world, point, direction.clone().multiplyScalar(40))) continue;
      const position = point.clone().add(new THREE.Vector3(0, 7, 0));
      if (!world.isCapsuleClear(position)) continue;
      return { position, velocity: direction.multiplyScalar(18).setY(-8) };
    }
  }
  return null;
}

/** Finds a broad real facade for repeatable wall-run/crawl/jump captures.
 * Uses the same triangle queries as gameplay, no invisible test colliders. */
export function findWallScenario(world: RepeatingMeshWorld) {
  for (const height of [18, 30, 8, 45]) for (let x = -60; x <= 60; x += 12) for (let z = -60; z <= 60; z += 12) {
    const origin = new THREE.Vector3(x, height, z);
    if (!world.isCapsuleClear(origin)) continue;
    for (const direction of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)]) {
      const hit = world.raycast(origin, direction, 18);
      if (!hit || hit.distance < 7 || Math.abs(hit.normal.y) > .05) continue;
      const normal = hit.normal.clone(), tangent = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), normal);
      let valid = true;
      for (const side of [-5, 0, 5]) for (const up of [-3, 0, 6, 12]) {
        const probe = hit.point.clone().addScaledVector(normal, 2).addScaledVector(tangent, side).add(new THREE.Vector3(0, up, 0));
        const wall = world.raycast(probe, normal.clone().negate(), 3);
        if (!wall || wall.normal.dot(normal) < .98 || Math.abs(wall.distance - 2) > .12) valid = false;
      }
      const position = hit.point.clone().addScaledVector(normal, 6).addScaledVector(tangent, -4);
      if (!valid || !world.isCapsuleClear(position) || !world.isCapsuleClear(position.clone().addScaledVector(normal, 4))) continue;
      return { position, velocity: normal.clone().multiplyScalar(-22).addScaledVector(tangent, 12).setY(6), normal, point: hit.point, tangent };
    }
  }
  return null;
}
