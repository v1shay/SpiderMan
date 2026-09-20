import assert from 'node:assert/strict';
import {
  raceAllowsTraversalInput,
  sampleRaceInput,
} from '../lib/race-input.ts';
import { InputSystem, toTraversalInput } from '../lib/input-system.ts';
import { RaceSession } from '../lib/race-session.ts';
import {
  createTraversalState,
  stepTraversal,
} from '../lib/traversal-physics.ts';

assert.equal(raceAllowsTraversalInput('countdown'), false);
for (const phase of ['free', 'inviting', 'invited', 'racing', 'finished']) {
  assert.equal(
    raceAllowsTraversalInput(phase),
    true,
    `${phase} must allow swinging and traversal`,
  );
}

const tests = [];
function test(name, run) {
  run();
  tests.push(name);
  console.log(`PASS ${name}`);
}
const forward = { x: 0, y: 0, z: -1 };

test('swing press is immediate, independent of zip and release duration', () => {
  const input = new InputSystem();
  input.setButton(0, true);
  let frame = toTraversalInput(input.sample(), forward);
  assert.equal(frame.swingPressed, true);
  assert.equal(frame.swingHeld, true);
  assert.equal(frame.zipPressed, false);
  frame = toTraversalInput(input.sample(), forward);
  assert.equal(frame.swingPressed, false);
  assert.equal(frame.swingHeld, true);
  input.setButton(0, false);
  frame = toTraversalInput(input.sample(), forward);
  assert.equal(frame.swingReleased, true);
  assert.equal(frame.zipPressed, false);
});

test('race countdown retains physical swing and movement through first playable frame', () => {
  const input = new InputSystem();
  input.setButton(0, true);
  input.setKey('KeyW', true);
  assert.equal(input.sample().swing.held, true);
  // This is the race teleport hook. It must not be loseFocus()/clearKeys().
  input.resetActions();
  for (let tick = 0; tick < 360; tick++) {
    const frame = toTraversalInput(
      sampleRaceInput(input, 'countdown'),
      forward,
    );
    assert.equal(frame.swingHeld, false);
    assert.equal(frame.swingPressed, false);
    assert.deepEqual(frame.move, { x: 0, y: 0, z: 0 });
    assert.ok(input.raw.buttons.has(0));
    assert.ok(input.raw.keys.has('KeyW'));
  }
  const frame = toTraversalInput(sampleRaceInput(input, 'racing'), forward);
  assert.equal(frame.swingHeld, true);
  assert.equal(frame.swingPressed, true);
  assert.equal(frame.move.z, -1);
  const result = stepTraversal(
    createTraversalState({ x: 0, y: 20, z: 0 }),
    frame,
    {
      groundY: 0,
      anchorCandidates: [
        { id: 'building', point: { x: 5, y: 45, z: -20 }, lineOfSight: true },
      ],
    },
    1 / 60,
  );
  assert.ok(
    result.state.swing,
    'real traversal solver must attach on the first playable frame',
  );
  assert.equal(sampleRaceInput(input, 'racing').swing.pressed, false);
});

test('real race session start and GO preserve a held swing across teleport', () => {
  const input = new InputSystem();
  const course = {
    id: 'input-regression',
    start: [0, 20, 0],
    finish: [0, 20, -800],
    side: 0,
  };
  const race = new RaceSession('player-test', {
    send: () => {},
    teleport: () => input.resetActions(),
    finished: () => {},
    started: () => {},
  });
  input.setButton(0, true);
  race.invite(course, 0, 0, 'input-race');
  race.tick(501, course.start);
  assert.equal(race.phase, 'countdown');
  assert.equal(sampleRaceInput(input, race.phase).swing.held, false);
  race.tick(3502, course.start);
  assert.equal(race.phase, 'racing');
  const action = sampleRaceInput(input, race.phase);
  assert.ok(action.swing.held && action.swing.pressed);
});

test('countdown tracks new presses and releases without replaying paused taps', () => {
  const input = new InputSystem();
  input.setButton(0, true);
  input.setKey('Space', true);
  sampleRaceInput(input, 'countdown');
  input.setButton(0, false);
  input.setKey('Space', false);
  sampleRaceInput(input, 'countdown');
  let action = sampleRaceInput(input, 'racing');
  assert.deepEqual(action.swing, {
    held: false,
    pressed: false,
    released: false,
  });
  assert.deepEqual(action.jump, {
    held: false,
    pressed: false,
    released: false,
  });
  input.setButton(0, true);
  sampleRaceInput(input, 'countdown');
  action = sampleRaceInput(input, 'racing');
  assert.ok(action.swing.held && action.swing.pressed);
});

test('focus loss cancels charge safely and never invents a release boost', () => {
  const input = new InputSystem();
  input.setButton(0, true);
  input.setKey('KeyC', true);
  input.setKey('KeyX', true);
  input.sample();
  input.loseFocus();
  let frame = toTraversalInput(input.sample(), forward);
  assert.equal(frame.cancelAbilities, true);
  assert.equal(frame.swingReleased, false);
  assert.equal(frame.chargeJumpReleased, false);
  assert.equal(frame.slingshotReleased, false);
  input.gainFocus();
  frame = toTraversalInput(input.sample(), forward);
  assert.equal(frame.swingHeld, false);
  assert.equal(frame.chargeJumpHeld, false);
});

test('disabled actions preserve raw buttons and resume without stale charge releases', () => {
  const input = new InputSystem();
  input.setButton(0, true);
  input.setKey('KeyX', true);
  input.sample();
  const disabledActions = new Set(['swing', 'slingshot']);
  let action = input.sample({ disabledActions });
  assert.equal(action.cancelAbilities, true);
  assert.equal(action.swing.held, false);
  assert.equal(action.slingshot.released, false);
  assert.ok(input.raw.buttons.has(0));
  input.setKey('KeyX', false);
  input.sample({ disabledActions });
  action = input.sample();
  assert.ok(action.swing.pressed && action.swing.held);
  assert.equal(action.slingshot.released, false);
});

test('right mouse zips and E launches without affecting swing', () => {
  const input = new InputSystem();
  input.setButton(2, true);
  let frame = toTraversalInput(input.sample(), forward);
  assert.equal(frame.zipPressed, true);
  assert.equal(frame.swingPressed, false);
  assert.equal(frame.zipStyle, 'point');
  input.setKey('KeyE', true);
  input.setButton(2, false);
  frame = toTraversalInput(input.sample(), forward);
  assert.equal(frame.zipHeld, true);
  assert.equal(frame.zipReleased, false);
  input.setKey('KeyE', false);
  frame = toTraversalInput(input.sample(), forward);
  assert.equal(frame.zipReleased, true);
});

test('quick taps are captured once and key repeats do not repeat gameplay edges', () => {
  const input = new InputSystem();
  input.setKey('Space', true);
  input.setKey('Space', false);
  assert.equal(input.sample().jump.pressed, true);
  assert.equal(input.sample().jump.pressed, false);
  input.setKey('Space', true);
  assert.equal(input.sample().jump.pressed, true);
  for (let repeat = 0; repeat < 10; repeat++) {
    input.setKey('Space', true);
    assert.equal(input.sample().jump.pressed, false);
  }
});

test('camera-relative movement is normalized and explicit reel never comes from swing hold', () => {
  const input = new InputSystem();
  input.setKey('KeyW', true);
  input.setKey('KeyD', true);
  input.setButton(0, true);
  input.setPressure(2);
  let frame = toTraversalInput(input.sample(), forward);
  assert.ok(Math.abs(Math.hypot(frame.move.x, frame.move.z) - 1) < 1e-10);
  assert.equal(frame.reel, 0);
  assert.equal(frame.pointerPressure, 1);
  input.setKey('KeyV', true);
  frame = toTraversalInput(input.sample(), forward);
  assert.equal(frame.reel, -1);
  input.setKey('KeyV', false);
  input.setKey('KeyB', true);
  frame = toTraversalInput(input.sample(), forward);
  assert.equal(frame.reel, 1);
});

console.log(
  `PASS ${tests.length} input regressions and race traversal phase contract.`,
);
