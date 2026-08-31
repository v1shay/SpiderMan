import * as THREE from 'three';
import type { SurfaceContact, Vector3Like } from './traversal-physics';
import type { MeshSurfaceHit } from './mesh-world';

type Cast = (origin: THREE.Vector3, direction: THREE.Vector3, maximum: number, minNormalY?: number) => MeshSurfaceHit | null;

/** A short sole-height ray measures an actual facade, not a body-sized box. */
export function probeWallFeet(position: Vector3Like, normal: Vector3Like, cast: Cast): SurfaceContact | null {
  const toward = new THREE.Vector3(normal.x, 0, normal.z).normalize().negate();
  const foot = cast(new THREE.Vector3(position.x, position.y + .18, position.z), toward, .59);
  if (!foot || Math.abs(foot.normal.y) > .35 || foot.normal.dot(toward) > -.75) return null;
  return { point: foot.point, normal: foot.normal, feetTouching: true, colliderId: 'rendered-facade' };
}

/** Return a supported, clear top across the rim. Never teleport to this point. */
export function findMantleTarget(position: Vector3Like, normal: Vector3Like, cast: Cast, clear: (point: THREE.Vector3) => boolean): THREE.Vector3 | null {
  const inward = new THREE.Vector3(normal.x, 0, normal.z).normalize().negate();
  const above = new THREE.Vector3(position.x, position.y + 1.8, position.z).addScaledVector(inward, 1.2);
  const roof = cast(above, new THREE.Vector3(0, -1, 0), 2, .85);
  if (!roof || roof.point.y < position.y - .12 || roof.point.y > position.y + 1.5) return null;
  const target = roof.point.clone().add(new THREE.Vector3(0, .025, 0));
  if (!clear(target)) return null;
  for (const offset of [new THREE.Vector3(.42, 0, 0), new THREE.Vector3(-.42, 0, 0), new THREE.Vector3(0, 0, .42), new THREE.Vector3(0, 0, -.42)]) {
    const support = cast(target.clone().add(offset).add(new THREE.Vector3(0, .08, 0)), new THREE.Vector3(0, -1, 0), .18, .85);
    if (!support || Math.abs(support.point.y - roof.point.y) > .08) return null;
  }
  const rise = new THREE.Vector3(position.x, target.y, position.z);
  if (!clear(rise)) return null;
  return target;
}
