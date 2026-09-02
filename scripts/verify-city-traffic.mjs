import assert from 'node:assert/strict';
import { findTrafficLanes, trafficPose } from '../lib/city-traffic.ts';

const bounds = { minX: -50, maxX: 50, minZ: -40, maxZ: 40 };
const lanes = findTrafficLanes(bounds, (x, z) => {
  // A building interrupts the center of most rows, but two streets remain.
  if (Math.abs(z - 24) < 3 || Math.abs(z + 24) < 3) return 0;
  if (Math.abs(x) < 10 && Math.abs(z) < 18) return null;
  return 0;
}, { maximum: 4, minimumLength: 20 });
assert.ok(lanes.length >= 2, 'finds multiple streets');
assert.ok(lanes.every(lane => lane.length >= 20), 'rejects tiny parking-lot fragments');
assert.ok(lanes.every(lane => !(lane.from.x < -10 && lane.to.x > 10 && Math.abs(lane.from.z) < 18)), 'never bridges a building gap');

const lane = { from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0, z: 100 }, length: 100 };
const outbound = trafficPose(lane, 2, 10);
assert.deepEqual([outbound.x, outbound.z, outbound.forward], [0, 20, true]);
const returning = trafficPose(lane, 12, 10);
assert.deepEqual([returning.x, returning.z, returning.forward], [0, 80, false]);
assert.ok(Math.abs(Math.abs(outbound.yaw - returning.yaw) - Math.PI) < 1e-9, 'car turns around for the return lane');

console.log('City traffic lane and motion verification passed.');
