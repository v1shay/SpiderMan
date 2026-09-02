import assert from 'node:assert/strict';
import { calculateWallSkim } from '../lib/wall-skim.ts';

const normal = { x: -1, y: 0, z: 0 };
const incoming = { x: 28, y: -5, z: -34 };
const skim = calculateWallSkim(incoming, normal, { x: 0, y: 0, z: -1 });
assert.equal(skim.eligible, true);
assert.ok(skim.velocity.x < -5, 'kick moves outward from the facade');
assert.ok(skim.velocity.z < -26, 'facade tangent preserves most traversal momentum');
assert.ok(skim.velocity.y > 4, 'kick clears the next ledge/ground contact');
assert.ok(Math.hypot(skim.velocity.x, skim.velocity.y, skim.velocity.z) <= 94.0001, 'kick remains bounded');

const slow = calculateWallSkim({ x: 3, y: 0, z: -2 }, normal, { x: 0, y: 0, z: -1 });
assert.equal(slow.eligible, false, 'walking into a wall does not trigger traversal assistance');
const glancingAway = calculateWallSkim({ x: -12, y: 0, z: -20 }, normal, { x: 0, y: 0, z: -1 });
assert.equal(glancingAway.eligible, false, 'moving away from a facade cannot manufacture a kick');

console.log('Cinematic wall-skim verification passed.');
