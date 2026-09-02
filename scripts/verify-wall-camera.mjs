import assert from 'node:assert/strict';
import * as THREE from 'three';
import { wallCameraOffset } from '../lib/wall-camera.ts';

const normal = new THREE.Vector3(0, 0, 1);
const centre = wallCameraOffset(normal, 0, .08);
const left = wallCameraOffset(normal, 1.2, .08);
const right = wallCameraOffset(normal, -1.2, .08);
const up = wallCameraOffset(normal, 0, .58);
const down = wallCameraOffset(normal, 0, -.18);

assert.ok(centre.z > 3 && centre.y > 5 && Math.abs(centre.x) < 1e-8,
  'crawl camera starts above the crawler and outside the facade-as-ground plane');
assert.ok(left.x < -2.5 && right.x > 2.5, 'left/right input visibly orbits around the crawler');
assert.ok(left.z > 2.5 && right.z > 2.5, 'orbit never requests a camera behind the wall');
assert.ok(up.y > centre.y + 2 && down.y < centre.y - 1, 'up/down input adjusts crawl viewport pitch');
for (const yaw of [-100, -10, 0, 10, 100]) {
  const offset = wallCameraOffset(normal, yaw, .08);
  assert.ok(offset.z > 2.5 && Number.isFinite(offset.length()), 'held look input remains exterior and finite');
}
console.log('PASS crawl camera: adjustable yaw/pitch with exterior-side bounds.');
