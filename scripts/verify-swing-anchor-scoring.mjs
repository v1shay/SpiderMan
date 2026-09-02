import assert from 'node:assert/strict';
import {
  rankSwingAnchorTrajectories,
  scoreSwingAnchorTrajectory,
  selectTrajectoryAwareSwingAnchor,
} from '../lib/swing-anchor-scoring.ts';

const context = {
  position: { x: 0, y: 9, z: 0 },
  velocity: { x: 24, y: -2, z: -5 },
  aimDirection: { x: 0, y: .35, z: -1 },
  desiredDirection: { x: 1, y: 0, z: -.1 },
  groundY: 0,
};

// This anchor looks perfect to an aim-only selector, but its low rope makes the
// predicted bottom of the arc intersect the street.
const visuallyAlignedButBad = { id: 'aim-aligned-ground-strike', point: { x: 26, y: 29, z: -40 }, kind: 'facade' };
// Slightly off the reticle, this anchor creates a deep, clear arc whose outgoing
// tangent preserves the player's intended +X travel.
const trajectoryProducing = { id: 'clear-forward-trajectory', point: { x: 13, y: 31, z: -18 }, kind: 'ledge' };

const bad = scoreSwingAnchorTrajectory(visuallyAlignedButBad, context);
const good = scoreSwingAnchorTrajectory(trajectoryProducing, context);
assert.equal(bad.valid, false, 'an aim-aligned anchor that drives the capsule into ground must be rejected');
assert.equal(bad.rejection, 'ground');
assert.equal(good.valid, true);
assert.ok(good.forwardProgress > .45, `good anchor should create forward progress, got ${good.forwardProgress}`);
assert.ok(good.arcDepth > 4, `good anchor should create an acceleration-producing arc, got ${good.arcDepth}`);
assert.equal(selectTrajectoryAwareSwingAnchor([visuallyAlignedButBad, trajectoryProducing], context)?.candidate.id,
  trajectoryProducing.id, 'trajectory must beat visual alignment');

// A second aligned anchor clears the floor but swings back against player intent.
// Forward tangent must still beat reticle alignment when both are collision-safe.
const alignedButBackward = { id: 'aligned-backward-exit', point: { x: 0, y: 11, z: -30 }, kind: 'facade' };
const backward = scoreSwingAnchorTrajectory(alignedButBackward, context);
assert.equal(backward.valid, true);
assert.ok(good.forwardProgress > backward.forwardProgress);
assert.ok(good.score > backward.score, `forward trajectory ${good.score} should beat backward trajectory ${backward.score}`);

// Collision sampling is authoritative: a high-scoring arc through a facade is
// rejected, while the candidate object and caller vectors remain untouched.
const immutableContext = structuredClone(context);
const collisionResult = scoreSwingAnchorTrajectory(trajectoryProducing, context, {});
assert.equal(collisionResult.valid, true);
const blocked = scoreSwingAnchorTrajectory(trajectoryProducing, {
  ...context,
  isCapsuleClear: (point) => !(point.x > 4 && point.y > 4),
});
assert.equal(blocked.valid, false);
assert.equal(blocked.rejection, 'collision');
assert.deepEqual(context, immutableContext, 'scoring is pure and does not mutate caller state');

// Candidate order cannot change deterministic selection or replay behavior.
const ties = [
  { id: 'z-anchor', point: { x: 13, y: 31, z: -18 }, kind: 'ledge' },
  { id: 'a-anchor', point: { x: 13, y: 31, z: -18 }, kind: 'ledge' },
];
const firstOrder = rankSwingAnchorTrajectories(ties, context).map((result) => result.candidate.id);
const reverseOrder = rankSwingAnchorTrajectories([...ties].reverse(), context).map((result) => result.candidate.id);
assert.deepEqual(firstOrder, ['a-anchor', 'z-anchor']);
assert.deepEqual(reverseOrder, firstOrder, 'stable IDs resolve exact score ties across candidate insertion order');

console.log(JSON.stringify({
  passed: true,
  selected: trajectoryProducing.id,
  badRejection: bad.rejection,
  good: {
    score: Number(good.score.toFixed(3)),
    forwardProgress: Number(good.forwardProgress.toFixed(3)),
    arcDepth: Number(good.arcDepth.toFixed(3)),
    bottomClearance: Number(good.bottomClearance.toFixed(3)),
    outgoingSpeed: Number(good.predictedOutgoingSpeed.toFixed(3)),
  },
  backward: {
    score: Number(backward.score.toFixed(3)),
    forwardProgress: Number(backward.forwardProgress.toFixed(3)),
  },
}));
