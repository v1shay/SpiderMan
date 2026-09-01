import * as THREE from 'three';

/**
 * Keeps an orbiting crawl camera on the exterior side of a facade. `yawDelta`
 * is measured from the moment Q latches, while pitch remains the ordinary
 * player-controlled chase-camera pitch.
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
  const exterior = distance * (.7 + .3 * Math.cos(orbit));
  const lateral = distance * .82 * Math.sin(orbit);
  return normal.multiplyScalar(exterior)
    .addScaledVector(tangent, lateral)
    .add(new THREE.Vector3(0, 2.2 + Math.sin(pitch) * distance, 0));
}
