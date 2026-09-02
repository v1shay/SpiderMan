import * as THREE from 'three';

/**
 * Treats the facade as Spider-Man's temporary ground plane. The camera stays
 * outside the solid, rises along the wall like a ground chase camera's height,
 * and can still orbit laterally with ordinary look input.
 */
export function wallCameraOffset(
  wallNormal: THREE.Vector3,
  yawDelta: number,
  pitch: number,
  distance = 5.4,
): THREE.Vector3 {
  const normal = wallNormal.clone().setY(0).normalize();
  if (normal.lengthSq() < .5) normal.set(0, 0, 1);
  const tangent = new THREE.Vector3(-normal.z, 0, normal.x);
  // tanh gives useful adjustment near centre without ever placing the desired
  // camera behind the wall, even if an arrow key is held for a long time.
  const orbit = Math.tanh(yawDelta / 1.05) * 1.08;
  const exterior = distance * (.48 + .16 * Math.cos(orbit));
  const lateral = distance * .82 * Math.sin(orbit);
  return normal.multiplyScalar(exterior)
    .addScaledVector(tangent, lateral)
    .add(new THREE.Vector3(0, distance * .92 + Math.sin(pitch) * distance * .85, 0));
}
