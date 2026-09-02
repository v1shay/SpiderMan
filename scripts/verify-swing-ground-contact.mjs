import assert from 'node:assert/strict';
import { resolveSwingGroundContact } from '../lib/swing-ground-contact.ts';

const base = {
  attemptedVelocity: { x: 18, y: -.8, z: -6 },
  sweptVelocity: { x: 13, y: 0, z: -4 },
  grounded: true,
  swingHeld: true,
  obstructed: false,
  hitWall: false,
  anchorHeight: 24,
  tension: .04,
  attachedSeconds: .05,
};

const skid = resolveSwingGroundContact(base);
assert.equal(skid.active, true);
assert.equal(skid.liftOff, false);
assert.equal(skid.velocity.y, 0, 'pavement cancels descent without manufacturing lift');
assert.ok(skid.horizontalRetention >= .999, 'ground skim must preserve horizontal swing momentum');

const lift = resolveSwingGroundContact({
  ...base,
  attemptedVelocity: { x: 18, y: .7, z: -6 },
  tension: 0,
  attachedSeconds: .26,
});
assert.equal(lift.liftOff, true);
assert.ok(lift.velocity.y > 8.5 && lift.velocity.y <= 10.5, 'loaded ground web gets one bounded takeoff transition');
assert.deepEqual(resolveSwingGroundContact({ ...base, swingHeld: false }).velocity, base.sweptVelocity);
assert.equal(resolveSwingGroundContact({ ...base, obstructed: true }).active, false);

const rooftopDive = resolveSwingGroundContact({
  ...base,
  attemptedVelocity: { x: 12, y: 0, z: -8 },
  anchorHeight: -24,
  elevatedLaunch: true,
  attachedSeconds: .3,
});
assert.equal(rooftopDive.active, true);
assert.equal(rooftopDive.liftOff, true, 'a tallest-roof start must be able to leave toward lower city geometry');
assert.ok(Math.hypot(rooftopDive.velocity.x, rooftopDive.velocity.z) >= 25.99,
  'elevated spawn uses a one-shot perch launch to clear a broad roof');

for (let tick = 0; tick < 90; tick += 1) {
  const vertical = tick < 28 ? -.4 + tick * .02 : .34 + (tick - 28) * .015;
  const result = resolveSwingGroundContact({
    ...base,
    attemptedVelocity: { x: 22, y: vertical, z: -4 },
    tension: Math.min(.2, tick / 180),
    attachedSeconds: tick / 120,
  });
  if (result.liftOff) {
    assert.ok(tick / 120 >= .08 && tick / 120 <= .9, 'lift-off occurs once real tension wins, not on attach');
    assert.ok(result.velocity.y >= .32);
    break;
  }
  assert.equal(result.velocity.y, 0, 'pre-lift ground frames cannot alternate vertical velocity signs');
}

console.log(JSON.stringify({ passed: true, skidRetention: skid.horizontalRetention, liftVelocity: lift.velocity.y }));
