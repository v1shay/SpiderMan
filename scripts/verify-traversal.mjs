import assert from 'node:assert/strict';
import {
  createTraversalState,
  DEFAULT_TRAVERSAL_CONFIG as defaults,
  runTraversalPhysicsSelfTests,
  stepTraversal,
  traversalLineOfSight,
} from '../lib/traversal-physics.ts';

const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const box = (id, minimum, maximum) => ({ id, min: minimum, max: maximum });
const inert = { gravity: 0, airAcceleration: 0, groundAcceleration: 0, groundFriction: 0, maximumSpeed: 500 };
const close = (actual, expected, tolerance = .005) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const outside = (state, solid) => {
  const p = state.position;
  const r = defaults.playerRadius;
  return p.x <= solid.min.x - r || p.x >= solid.max.x + r
    || p.z <= solid.min.z - r || p.z >= solid.max.z + r
    || p.y >= solid.max.y || p.y + defaults.playerHeight <= solid.min.y;
};
const tests = [];
function test(name, run) { run(); tests.push(name); console.log(`PASS ${name}`); }

test('existing traversal contract', () => assert.equal(runTraversalPhysicsSelfTests().passed, true));

const wall = box('thin-wall', v(5, 0, -10), v(5.015, 30, 10));
test('high-speed thin wall cannot tunnel or bounce', () => {
  const result = stepTraversal(createTraversalState(v(0, 4), v(220, 0)), {}, { groundY: -100, colliders: [wall] }, .05, inert);
  assert.ok(outside(result.state, wall));
  assert.ok(result.state.position.x <= 5 - defaults.playerRadius);
  close(result.state.velocity.x, 0);
});

test('diagonal corner collision preserves sliding but cannot enter either solid', () => {
  const second = box('corner', v(-10, 0, 5), v(10, 30, 5.015));
  const result = stepTraversal(createTraversalState(v(0, 4, 0), v(220, 0, 220)), {}, { groundY: -100, colliders: [wall, second] }, .05, inert);
  assert.ok(outside(result.state, wall) && outside(result.state, second));
  assert.ok(result.state.position.x < 5 && result.state.position.z < 5);
});

const roof = box('roof', v(-10, 0, -10), v(10, 10, 10));
test('high-speed roof landing gives exact foot contact and impact strength', () => {
  const result = stepTraversal(createTraversalState(v(0, 15), v(0, -200)), {}, { groundY: -100, colliders: [roof] }, .05, inert);
  close(result.state.position.y, 10, .00001);
  assert.ok(result.state.grounded && outside(result.state, roof));
  assert.ok(result.events.some((event) => event.type === 'land' && event.strength > .5));
});

test('high-speed ceiling collision uses the capsule head', () => {
  const ceiling = box('ceiling', v(-10, 4, -10), v(10, 4.02, 10));
  const result = stepTraversal(createTraversalState(v(0, 1), v(0, 150)), {}, { groundY: -100, colliders: [ceiling] }, .05, inert);
  assert.ok(outside(result.state, ceiling));
  assert.ok(result.state.position.y + defaults.playerHeight <= 4);
  close(result.state.velocity.y, 0);
  assert.equal(result.state.grounded, false);
});

test('floor collision does not sink or retain downward velocity', () => {
  const result = stepTraversal(createTraversalState(v(0, 2), v(0, -200)), {}, { groundY: 0 }, .05, inert);
  close(result.state.position.y, 0, .00001);
  close(result.state.velocity.y, 0);
  assert.equal(result.state.grounded, true);
});

test('bounded spawn repair chooses a real roof, not a horizontal wall ejection', () => {
  const result = stepTraversal(createTraversalState(v(0, 9.9)), {}, { groundY: 0, colliders: [roof] }, 1 / 120, inert);
  close(result.state.position.y, 10, .00001);
  assert.ok(result.state.grounded && outside(result.state, roof));
});

test('overlapping imported building boxes cannot trap invalid starts in a repair loop', () => {
  const solids = [
    box('overlap-a', v(-2, 0, -2), v(2, 10, 2)),
    box('overlap-b', v(1, 0, -2), v(5, 10, 2)),
    box('overlap-c', v(-2, 0, 1), v(5, 10, 5)),
  ];
  for (let x = -2; x <= 5; x += .25) {
    for (let z = -2; z <= 5; z += .25) {
      const result = stepTraversal(createTraversalState(v(x, 5, z)), {}, { groundY: 0, colliders: solids }, 1 / 120, inert);
      assert.ok(solids.every((solid) => outside(result.state, solid)), `inside overlap at ${x},${z}`);
      assert.ok(result.state.position.y >= 0);
    }
  }
});

test('sampled slope follows increasing ground without tunnelling below it', () => {
  let state = createTraversalState(v(), v(10, 0, 0));
  state.grounded = true;
  const sampleGround = (p, maximumStepUp) => .15 * p.x <= p.y + maximumStepUp ? .15 * p.x : null;
  for (let tick = 0; tick < 60; tick += 1) state = stepTraversal(state, {}, { sampleGround }, 1 / 60, inert).state;
  close(state.position.y, .15 * state.position.x, .00001);
  assert.equal(state.grounded, true);
});

test('null mesh support never invents an invisible floor', () => {
  const result = stepTraversal(createTraversalState(v(0, 4), v(0, -5)), {}, { groundY: 100, sampleGround: () => null }, 1 / 60, inert);
  assert.ok(result.state.position.y < 4);
  assert.equal(result.state.grounded, false);
});

test('web line-of-sight accepts first surface but rejects targets behind it', () => {
  assert.equal(traversalLineOfSight(v(0, 4), v(5, 4), [wall]), true);
  assert.equal(traversalLineOfSight(v(0, 4), v(12, 4), [wall]), false);
});

test('occluded swing detaches without a boost or unchecked rope teleport', () => {
  const state = createTraversalState(v(0, 4), v());
  state.swing = { anchor: v(10, 20), anchorId: 'blocked', ropeLength: 4, maximumLength: 4, attachedSeconds: 1, tension: 1, pressure: .5 };
  const result = stepTraversal(state, { swingHeld: true }, { groundY: -100, colliders: [wall] }, 1 / 120,
    { ...inert, swingSpring: 0, swingDamping: 0, swingPumpAcceleration: 0, swingSteerAcceleration: 0, swingReelSpeed: 0 });
  assert.equal(result.state.swing, null);
  assert.ok(result.state.position.x < 1 && outside(result.state, wall));
  assert.ok(result.events.some((event) => event.type === 'web-released' && event.strength === 0));
});

test('capsule-blocked rope correction loses to a wall even with clear centerline', () => {
  const edge = box('rope-edge', v(3, 0, .2), v(4, 30, 3));
  const state = createTraversalState(v(0, 4), v());
  state.swing = { anchor: v(10, 4), ropeLength: 3, maximumLength: 3, attachedSeconds: 1, tension: 1, pressure: .5 };
  const result = stepTraversal(state, { swingHeld: true }, { groundY: -100, colliders: [edge] }, 1 / 120,
    { ...inert, swingSpring: 0, swingDamping: 0, swingPumpAcceleration: 0, swingSteerAcceleration: 0, swingReelSpeed: 0 });
  assert.equal(result.state.swing, null);
  assert.ok(outside(result.state, edge));
  assert.ok(result.state.position.x <= 3 - defaults.playerRadius);
});

test('facade zip stops at body clearance and never snaps inside a target', () => {
  let state = createTraversalState(v(0, 4), v(20, 0));
  const candidate = { id: 'wall-zip', point: v(5, 4), kind: 'facade' };
  for (let tick = 0; tick < 120; tick += 1) {
    state = stepTraversal(state, { zipPressed: tick === 0, zipHeld: true, aimDirection: v(1, 0, 0) },
      { groundY: -100, colliders: [wall], zipTargets: [candidate] }, 1 / 120, inert).state;
    assert.ok(outside(state, wall));
  }
  assert.equal(state.zip, null);
  assert.ok(state.position.x <= 5 - defaults.playerRadius);
  assert.equal(state.mode === 'wallCrawl' || state.mode === 'wallRun', true);
});

test('rapid release has no free launch impulse', () => {
  const state = createTraversalState(v(0, 10), v(12, 0));
  state.swing = { anchor: v(0, 30), ropeLength: 20, maximumLength: 20, attachedSeconds: 0, tension: 1, pressure: 1 };
  const result = stepTraversal(state, { swingReleased: true, swingHeld: false }, { groundY: -100 }, 1 / 120, inert);
  close(result.state.velocity.x, 12, .00001);
  close(result.state.velocity.y, 0, .00001);
});

test('upswing release rewards timing and preserves existing momentum', () => {
  const release = (velocity) => {
    const state = createTraversalState(v(10, 10), velocity);
    state.swing = { anchor: v(0, 20), ropeLength: Math.sqrt(200), maximumLength: Math.sqrt(200), attachedSeconds: 1, tension: 1, pressure: 1 };
    return stepTraversal(state, { swingReleased: true, swingHeld: false, cameraForward: v(1, 0, 0) }, { groundY: -100 }, 1 / 120, inert).state;
  };
  const rise = release(v(10, 10));
  const fall = release(v(-10, -10));
  assert.ok(rise.velocity.y - 10 > fall.velocity.y + 10);
  assert.ok(Math.hypot(rise.velocity.x, rise.velocity.y, rise.velocity.z) >= Math.sqrt(200));
});

test('60Hz and 120Hz calls use identical internal physics ticks', () => {
  const environment = { groundY: -100, anchorCandidates: [{ point: v(0, 30, -10), kind: 'facade' }] };
  const input = { swingHeld: true, move: v(1, 0, -.3), cameraForward: v(0, 0, -1) };
  let sixty = createTraversalState(v(0, 10), v(12, 0));
  let oneTwenty = createTraversalState(v(0, 10), v(12, 0));
  for (let i = 0; i < 60; i += 1) sixty = stepTraversal(sixty, input, environment, 1 / 60).state;
  for (let i = 0; i < 120; i += 1) oneTwenty = stepTraversal(oneTwenty, input, environment, 1 / 120).state;
  for (const axis of ['x', 'y', 'z']) close(sixty.position[axis], oneTwenty.position[axis], .000001);
  close(sixty.heading, oneTwenty.heading, .000001);
});

const assistedConfig = { ...inert, gravity: 29, swingSpring: 0, swingDamping: 0,
  swingPumpAcceleration: 0, swingSteerAcceleration: 0, swingReelSpeed: 0 };
const descendingSwing = () => {
  const state = createTraversalState(v(0, 4), v(20, -12));
  state.swing = { anchor: v(0, 50), ropeLength: 78, maximumLength: 78, attachedSeconds: .3, tension: 0, pressure: .5 };
  return state;
};
test('predictive low swing assistance samples real terrain ahead and only brakes descent', () => {
  const probes = [];
  const sampleGround = (p, stepUp, drop) => { probes.push({ ...p, stepUp, drop }); return 0; };
  const baseline = stepTraversal(descendingSwing(), { swingHeld: true }, { groundY: 0 }, 1 / 120, assistedConfig);
  const assisted = stepTraversal(descendingSwing(), { swingHeld: true }, { sampleGround }, 1 / 120, assistedConfig);
  assert.ok(probes.some((p) => p.x > 5 && p.drop === 8 && p.stepUp === .2));
  const impulse = assisted.state.velocity.y - baseline.state.velocity.y;
  assert.ok(impulse > 0 && impulse <= 24 / 120);
  assert.ok(assisted.state.velocity.y < 0);
  assert.ok(Math.hypot(...Object.values(assisted.state.velocity)) <= Math.hypot(...Object.values(baseline.state.velocity)));
  assert.equal(assisted.state.grounded, false);
  assert.equal(assisted.state.mode, 'swing');
});

test('low swing assistance cannot invent ground or override a deliberate dive', () => {
  const baseline = stepTraversal(descendingSwing(), { swingHeld: true }, { groundY: -100 }, 1 / 120, assistedConfig);
  const voidResult = stepTraversal(descendingSwing(), { swingHeld: true }, { sampleGround: () => null }, 1 / 120, assistedConfig);
  const diving = stepTraversal(descendingSwing(), { swingHeld: true, diveHeld: true }, { sampleGround: () => 0 }, 1 / 120, assistedConfig);
  close(voidResult.state.velocity.y, baseline.state.velocity.y, .000001);
  close(diving.state.velocity.y, baseline.state.velocity.y, .000001);
  assert.equal(voidResult.state.swing.groundAssistImpulse ?? 0, 0);
  assert.equal(diving.state.swing.groundAssistImpulse ?? 0, 0);
});

test('low swing braking has a per-attachment budget and never generates ascent', () => {
  let state = descendingSwing();
  for (let tick = 0; tick < 180; tick += 1) {
    // Keep testing the dangerous near-ground condition without landing.
    state.position = v(0, 2);
    state.velocity = v(0, -10);
    state = stepTraversal(state, { swingHeld: true }, { sampleGround: () => 0 }, 1 / 120, assistedConfig).state;
    assert.ok(state.velocity.y <= 0);
    assert.ok((state.swing?.groundAssistImpulse ?? 0) <= 4 + 1e-8);
  }
  close(state.swing.groundAssistImpulse, 4, .000001);
  close(state.velocity.y, -10 - 29 / 120, .000001);
});

test('predictive assistance respects the solid and converts impact to wall traversal', () => {
  const state = descendingSwing();
  state.velocity = v(220, -12);
  const result = stepTraversal(state, { swingHeld: true, wallCrawlPressed: false },
    { sampleGround: () => 0, colliders: [wall] }, .05, assistedConfig);
  assert.ok(outside(result.state, wall));
  assert.ok(result.state.position.x <= wall.min.x - defaults.playerRadius);
  assert.equal(result.state.mode === 'wallCrawl' || result.state.mode === 'wallRun', true);
});

const touch = { point: v(5, 4.18, 0), normal: v(-1, 0, 0), feetTouching: true };
const crawlEnvironment = { groundY: -100, colliders: [wall], wallContact: touch };
const beginCrawl = () => stepTraversal(createTraversalState(v(5 - defaults.playerRadius, 4)),
  { wallCrawlPressed: true }, crawlEnvironment, 1 / 120).state;

test('one Q press latches crawl; releasing Q does not detach; second press detaches', () => {
  let state = beginCrawl();
  assert.equal(state.wallCrawlActive, true);
  for (let i = 0; i < 60; i++) state = stepTraversal(state, { wallClimb: 1 }, crawlEnvironment, 1 / 60).state;
  assert.equal(state.mode, 'wallCrawl');
  assert.ok(state.position.y > 7.5);
  state = stepTraversal(state, { wallCrawlPressed: true }, crawlEnvironment, 1 / 60).state;
  assert.equal(state.wallCrawlActive, false);
  assert.notEqual(state.mode, 'wallCrawl');
});

test('W climbs upright without sideways drift and D strafes only when requested', () => {
  let state = beginCrawl();
  for (let i = 0; i < 60; i++) state = stepTraversal(state, { move: v(1, 0, 0), wallClimb: 1 }, crawlEnvironment, 1 / 60).state;
  close(state.position.z, 0, 1e-8);
  assert.ok(outside(state, wall));
  assert.ok(state.position.y > 7.5, `crawl should cover more than 3.5m in its first second, got ${state.position.y.toFixed(2)}`);
  assert.ok(state.velocity.y > 4 && state.velocity.y <= defaults.wallCrawlSpeed + 1e-6);
  const height = state.position.y;
  for (let i = 0; i < 60; i++) state = stepTraversal(state, { wallStrafe: 1 }, crawlEnvironment, 1 / 60).state;
  assert.ok(state.position.z > 3.5);
  assert.ok(state.position.y - height < .8, 'only inertial settling after releasing W');
});

test('diagonal crawl is responsive but cannot exceed cardinal crawl speed', () => {
  let state = beginCrawl();
  for (let i = 0; i < 120; i++) state = stepTraversal(state,
    { wallClimb: 1, wallStrafe: 1 }, crawlEnvironment, 1 / 120).state;
  assert.ok(Math.hypot(state.velocity.y, state.velocity.z) <= defaults.wallCrawlSpeed + 1e-6);
  assert.ok(state.position.y > 6.5 && state.position.z > 2.5, 'diagonal crawl moves on both facade axes');
  assert.ok(outside(state, wall));
});

test('a wall bump cannot initiate crawling; Q requires actual feet contact', () => {
  for (const feetTouching of [false, true]) {
    const result = stepTraversal(createTraversalState(v(4.54, 4)), {},
      { groundY: -100, wallContact: { ...touch, feetTouching } }, 1 / 60);
    assert.equal(result.state.wallCrawlActive, false);
  }
  const midair = stepTraversal(createTraversalState(v(0, 4)), { wallCrawlPressed: true }, { groundY: -100 }, 1 / 60);
  assert.equal(midair.state.wallCrawlActive, false);
});

test('jump detaches crawl with outward momentum and does not relatch on another contact', () => {
  const result = stepTraversal(beginCrawl(), { jumpPressed: true }, crawlEnvironment, 1 / 60);
  assert.equal(result.state.wallCrawlActive, false);
  assert.ok(result.state.velocity.x < -5 && result.state.velocity.y > 5);
  assert.ok(result.events.some(event => event.type === 'wall-jump'));
  const next = stepTraversal(result.state, {}, crawlEnvironment, 1 / 60);
  assert.notEqual(next.state.mode, 'wallCrawl');
});

test('swing and zip both exit crawl without needing another Q press', () => {
  const target = { point: v(0, 20, 0), normal: v(1, 0, 0), kind: 'facade' };
  const environment = { ...crawlEnvironment, anchorCandidates: [target], zipTargets: [target] };
  const swing = stepTraversal(beginCrawl(), { swingPressed: true, swingHeld: true }, environment, 1 / 60);
  assert.ok(swing.state.swing);
  assert.equal(swing.state.wallCrawlActive, false);
  const zip = stepTraversal(beginCrawl(), { zipPressed: true, zipHeld: true }, environment, 1 / 60);
  assert.ok(zip.state.zip);
  assert.equal(zip.state.wallCrawlActive, false);
});

test('a lost foot contact drops the crawl latch immediately', () => {
  const state = beginCrawl();
  const result = stepTraversal(state, {}, { groundY: -100, wallContact: null }, 1 / 60);
  assert.equal(result.state.wallCrawlActive, false);
  assert.notEqual(result.state.mode, 'wallCrawl');
});

test('mantle rises above the rim before crossing and lands on the real roof', () => {
  let state = createTraversalState(v(10.462, 8.8));
  state.mantle = { target: v(9.262, 10.025), elapsed: 0 };
  for (let i = 0; i < 150; i++) {
    state = stepTraversal(state, {}, { groundY: -100, colliders: [roof] }, 1 / 120).state;
    assert.ok(outside(state, roof), `mantle penetrated rim: ${JSON.stringify(state.position)}`);
  }
  assert.equal(state.mantle, null);
  assert.equal(state.grounded, true);
  close(state.position.y, 10);
  assert.ok(state.position.x < 10 - defaults.playerRadius);
});

test('jump during roof mantle cancels it and immediately launches upward', () => {
  const state = createTraversalState(v(10.462, 10.025));
  state.mantle = { target: v(9.262, 10.025), elapsed: .3 };
  const result = stepTraversal(state, { jumpPressed: true }, { groundY: -100, colliders: [roof] }, 1 / 120);
  assert.equal(result.state.mantle, null);
  assert.ok(result.state.velocity.y > 5);
});

test('click zip completes once without orbiting or inheriting a held swing', () => {
  for (const speed of [0, 25, 88]) {
    let state = createTraversalState(v(0, 20), v(speed, 6, 0));
    const target = { point: v(20, 22, 0), normal: v(-1, 0, 0), kind: 'facade' };
    let starts = 0, finished = false;
    const environment = { groundY: -1000, zipTargets: [target], anchorCandidates: [target] };
    for (let tick = 0; tick < 360; tick++) {
      const result = stepTraversal(state, { zipPressed: tick === 0, zipHeld: true, swingHeld: true }, environment, 1 / 120);
      starts += result.events.filter(event => event.type === 'zip-started').length;
      state = result.state;
      if (!state.zip) finished = true;
      if (finished) {
        assert.equal(state.zip, null);
        assert.equal(state.swing, null, 'held input restarted swing after zip');
      }
    }
    assert.equal(starts, 1); assert.ok(finished, `zip did not finish at ${speed}m/s`);
  }
});

test('holding swing on a supported floor launches once without requiring jump or W', () => {
  let state = createTraversalState(v());
  state.grounded = true;
  const anchor = { point: v(18, 48, -25), kind: 'facade' };
  let jumps = 0;
  let attachments = 0;
  let landings = 0;
  let peakHeight = 0;
  for (let tick = 0; tick < 180; tick++) {
    const result = stepTraversal(state, { swingHeld: true, cameraForward: v(0, 0, -1) },
      { groundY: 0, anchorCandidates: [anchor] }, 1 / 120);
    state = result.state;
    jumps += result.events.filter(event => event.type === 'jump').length;
    attachments += result.events.filter(event => event.type === 'web-attached').length;
    landings += result.events.filter(event => event.type === 'land').length;
    peakHeight = Math.max(peakHeight, state.position.y);
    if (tick === 0) {
      assert.equal(state.grounded, false);
      assert.ok(state.velocity.y > 15);
      assert.ok(state.position.y > 0 && state.position.y < .2, 'launch must integrate, not teleport');
    }
  }
  assert.equal(jumps, 1);
  assert.equal(attachments, 1);
  assert.equal(landings, 0);
  assert.ok(state.position.y > 3 && peakHeight > 6);
  assert.ok(Math.hypot(...Object.values(state.velocity)) > 32);
  console.log(`  Ground hold: peak ${peakHeight.toFixed(2)}m, speed ${Math.hypot(...Object.values(state.velocity)).toFixed(2)}m/s, zero landings`);
});

test('roof hold push-off uses the roof as support and blocked/no anchors cannot launch', () => {
  const state = createTraversalState(v(0, 10));
  state.grounded = true;
  const input = { swingHeld: true, cameraForward: v(0, 0, -1) };
  const anchor = { point: v(18, 50, -25), kind: 'facade' };
  const launched = stepTraversal(state, input, { groundY: 0, colliders: [roof], anchorCandidates: [anchor] }, 1 / 120);
  assert.ok(launched.state.position.y > 10 && launched.state.velocity.y > 15);
  assert.ok(outside(launched.state, roof));
  for (const candidates of [[], [{ ...anchor, lineOfSight: false }]]) {
    const blocked = stepTraversal(state, input, { groundY: 0, colliders: [roof], anchorCandidates: candidates }, 1 / 120);
    assert.equal(blocked.state.swing, null);
    close(blocked.state.position.y, 10);
    assert.equal(blocked.state.grounded, true);
  }
});

test('new attachment preserves airborne incoming momentum without resetting to run speed', () => {
  const state = createTraversalState(v(0, 20), v(0, 0, -46));
  const result = stepTraversal(state, { swingHeld: true, cameraForward: v(0, 0, -1) },
    { groundY: -100, anchorCandidates: [{ point: v(20, 50), kind: 'facade' }] }, 1 / 120,
    { ...inert, swingSpring: 0, swingDamping: 0, swingPumpAcceleration: 0, swingSteerAcceleration: 0, swingReelSpeed: 0 });
  assert.ok(result.state.swing);
  close(result.state.velocity.z, -46, .05);
  assert.equal(result.events.some(event => event.type === 'jump'), false);
});

test('hold charge produces a stronger bounded release than a short tap', () => {
  const releaseAt = (seconds) => {
    const state = createTraversalState(v(10, 10), v(20, 20));
    state.swing = { anchor: v(0, 20), ropeLength: Math.sqrt(200), maximumLength: Math.sqrt(200), attachedSeconds: seconds, tension: 1, pressure: 1 };
    return stepTraversal(state, { swingHeld: false, swingReleased: true, cameraForward: v(1, 0, 0) }, { groundY: -100 }, 1 / 120, inert);
  };
  const tapped = releaseAt(.05);
  const charged = releaseAt(.95);
  assert.ok(tapped.state.velocity.x >= 20 && tapped.state.velocity.y >= 20);
  assert.ok(Math.hypot(tapped.state.velocity.x-20,tapped.state.velocity.y-20) < 2);
  const increase = Math.hypot(charged.state.velocity.x - 20, charged.state.velocity.y - 20, charged.state.velocity.z);
  assert.ok(increase > 8);
  assert.ok(increase <= defaults.swingReleaseBoost + defaults.swingReleaseLift + .001);
  assert.ok(charged.state.velocity.y > tapped.state.velocity.y + 6);
  assert.ok(charged.state.swingReleaseSeconds > 0);
  assert.equal(charged.state.mode, 'jump');
});

test('sustained reeling keeps a safe finite rope length instead of winching into the anchor', () => {
  let state = createTraversalState(v(0, 30), v(0, 0, -25));
  const anchor = { point: v(20, 65, -15), kind: 'facade' };
  for (let tick = 0; tick < 600; tick++) {
    state = stepTraversal(state, { swingHeld: true, reel: -1, cameraForward: v(0, 0, -1), move: v(0, 0, -1) },
      { groundY: -10000, anchorCandidates: [anchor] }, 1 / 120).state;
    assert.ok(state.swing);
    assert.ok(state.swing.ropeLength >= Math.max(defaults.swingMinimumLength, state.swing.maximumLength * .56) - 1e-6);
    assert.ok(Math.hypot(...Object.values(state.velocity)) <= defaults.maximumSpeed + .001);
  }
});

test('timed multi-swing course retains momentum and height over twelve seconds', () => {
  const anchors = [];
  for (let z = 20, row = 0; z > -900; z -= 35, row++) {
    for (const x of [-22, 22]) anchors.push({ id: `${x}:${z}`, point: v(x, [48, 68, 90][row % 3], z), kind: 'facade' });
  }
  let state = createTraversalState(v());
  state.grounded = true;
  let peakHeight = 0, airTicks = 0, attachments = 0, releases = 0, cooloff = 0;
  for (let tick = 0; tick < 1440; tick++) {
    const release = Boolean(state.swing && state.swing.attachedSeconds > .6
      && (state.velocity.y > 7 || state.swing.attachedSeconds > 2.7));
    if (release) cooloff = 18;
    const held = cooloff <= 0;
    cooloff--;
    const result = stepTraversal(state, { swingHeld: held, swingReleased: release, cameraForward: v(0, 0, -1), move: v(0, 0, -1) },
      { groundY: 0, anchorCandidates: anchors }, 1 / 120);
    state = result.state;
    peakHeight = Math.max(peakHeight, state.position.y);
    airTicks += state.grounded ? 0 : 1;
    attachments += result.events.filter(event => event.type === 'web-attached').length;
    releases += result.events.filter(event => event.type === 'web-released').length;
    assert.ok(state.position.y >= 0);
    assert.equal(state.wallCrawlActive, false);
    assert.ok(Math.hypot(...Object.values(state.velocity)) <= defaults.maximumSpeed + .001);
  }
  assert.ok(attachments >= 6 && releases >= 5);
  assert.ok(-state.position.z > 330 && peakHeight > 30 && airTicks / 1440 > .9);
  console.log(`  Chained course: ${attachments} attachments, ${releases} releases, ${(-state.position.z).toFixed(1)}m forward, ${peakHeight.toFixed(1)}m peak, ${(airTicks / 14.4).toFixed(1)}% airborne`);
});

test('web-zip stall watchdog ends an obstructed pull rather than pulling forever', () => {
  let state = createTraversalState(v(0, 20));
  const anchor = { point: v(25, 25), kind: 'facade' };
  let completionTime = Infinity;
  for (let tick = 0; tick < 360; tick++) {
    // An authoritative mesh sweep can pin the capsule at an intervening solid.
    state.position = v(0, 20);
    state.velocity = v();
    const result = stepTraversal(state, { zipPressed: tick === 0, zipHeld: true },
      { groundY: -100, zipTargets: [anchor] }, 1 / 120);
    state = result.state;
    if (!state.zip) { completionTime = tick / 120; break; }
  }
  assert.ok(completionTime < .6, `stalled zip persisted ${completionTime}s`);
});

console.log(`Verified ${tests.length} deterministic traversal checks.`);
