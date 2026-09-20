import assert from 'node:assert/strict';
import * as THREE from 'three';
import fs from 'node:fs/promises';
import {
  RaceSession,
  createRaceCourse,
  validRacePacket,
  validRaceCourse,
  formatRaceTime,
  dailyRaceSeed,
  raceResultValue,
  raceMedal,
  gateCrossing,
} from '../lib/race-session.ts';
import {
  GhostRecorder,
  poseGhost,
  readBestRun,
  storeBest,
  isBetterRaceRun,
} from '../lib/race-ghost.ts';
import {
  sampleWindAssist,
  createRaceGeometrySampler,
  RaceWorldVisuals,
  raceRoutePoints,
} from '../lib/race-world.ts';
import {
  createTraversalState,
  stepTraversal,
} from '../lib/traversal-physics.ts';
import { WorldMeshQuery } from '../lib/mesh-world.ts';
import { RepeatingMeshWorld } from '../lib/repeating-mesh-world.ts';
const checks = [],
  check = (name, fn) => {
    fn();
    checks.push(name);
    console.log(`PASS ${name}`);
  };
const generated = createRaceCourse([0, 30, 0], 350, 320, 50);
// Legacy course compatibility is independently checked, including old PB ghosts.
const course = {
  id: 'legacy-course',
  start: [0, 30, 0],
  finish: [700, 30, 0],
  side: 0,
};
let now = 100000;
const queue = [],
  moves = { a: [], b: [], c: [] },
  finishes = [];
const ids = ['player-a-2099', 'player-b-2099', 'player-c-2099'];
const sessions = ids.map(
  (id, index) =>
    new RaceSession(id, {
      send: (p) => queue.push(p),
      teleport: (p) => moves[['a', 'b', 'c'][index]].push([...p]),
      started: () => {},
      finished: (c, time) => finishes.push({ id, course: c.id, time }),
    }),
);
const deliver = () => {
  while (queue.length) {
    const p = queue.shift();
    sessions.forEach((s) => s.receive(p, now));
  }
};
const [a, b, c] = sessions;
check(
  'Shared far checkpoint course, deterministic generation and alternating side',
  () => {
    assert.ok(validRaceCourse(generated));
    assert.notEqual(
      createRaceCourse([0, 30, 0], 350, 320, 50, generated.side).side,
      generated.side,
    );
    assert.ok(Math.hypot(generated.finish[0], generated.finish[2]) >= 640);
    assert.ok(generated.gates.length >= 10);
    assert.deepEqual(createRaceCourse([0, 30, 0], 350, 320, 50), generated);
    assert.ok(generated.gates.some((g) => g.next.length === 2));
    assert.equal(
      dailyRaceSeed('queens', new Date('2026-09-17T00:01:00Z')),
      dailyRaceSeed('queens', new Date('2026-09-17T23:59:00Z')),
    );
    assert.notEqual(
      dailyRaceSeed('queens', new Date('2026-09-17')),
      dailyRaceSeed('queens', new Date('2026-09-18')),
    );
  },
);
check('Invitation never teleports receivers', () => {
  a.invite(course, now, 2, 'race-1');
  deliver();
  assert.equal(b.phase, 'invited');
  assert.equal(moves.b.length, 0);
  assert.equal(moves.c.length, 0);
});
check('Explicit acceptance and nonparticipant isolation', () => {
  b.accept(now);
  deliver();
  assert.equal(a.participants.size, 2);
  c.decline(now);
  assert.equal(c.phase, 'free');
});
check('Wrong host start rejected', () => {
  b.receive(
    {
      version: 1,
      type: 'start',
      sender: ids[2],
      raceId: 'race-1',
      sentAt: now,
      course,
      participants: ids,
      until: now + 3000,
    },
    now,
  );
  assert.equal(b.phase, 'invited');
});
now += 8000;
a.tick(now, course.start);
deliver();
check('Same exact start, finish and countdown across clients', () => {
  assert.equal(a.phase, 'countdown');
  assert.equal(b.phase, 'countdown');
  assert.equal(a.startAt, b.startAt);
  assert.deepEqual(a.course, b.course);
  assert.deepEqual(moves.a[0], moves.b[0]);
  assert.equal(moves.c.length, 0);
});
check('Duplicate start does not teleport again', () => {
  now += 800;
  a.tick(now, course.start);
  deliver();
  assert.equal(moves.b.length, 1);
});
now = a.startAt;
sessions.forEach((s) => s.tick(now, course.start));
check('Simultaneous racing start', () => {
  assert.equal(a.phase, 'racing');
  assert.equal(b.phase, 'racing');
  assert.equal(a.time, b.time);
});
now += 22000;
b.tick(now, course.finish);
deliver();
now += 1000;
a.tick(now, course.finish);
deliver();
check('Legacy finish propagation and one-time completion', () => {
  assert.equal(a.results.get(ids[1]), 22000);
  assert.equal(b.results.get(ids[0]), 23000);
  a.tick(now + 100, course.finish);
  assert.equal(finishes.length, 2);
});
check('Uninvited finish and nonfinite coordinates rejected', () => {
  a.receive(
    {
      version: 1,
      type: 'finish',
      sender: ids[2],
      raceId: 'race-1',
      sentAt: now,
      elapsed: 1,
    },
    now,
  );
  assert.equal(a.results.has(ids[2]), false);
  assert.equal(
    validRacePacket({
      version: 1,
      type: 'invite',
      sender: ids[0],
      raceId: 'bad',
      sentAt: now,
      course: { ...course, finish: [Infinity, 0, 0] },
    }),
    false,
  );
});
check('Cancelled host invitation resets accepted receiver', () => {
  a.invite(course, now, 1, 'race-2');
  deliver();
  b.accept(now);
  deliver();
  a.cancel(now);
  deliver();
  assert.equal(b.phase, 'free');
});
check('Timer formats centiseconds', () =>
  assert.equal(formatRaceTime(65321), '1:05.32'),
);

function solo(course) {
  const packets = [],
    teleports = [];
  const race = new RaceSession('solo-player', {
    send: (p) => packets.push(p),
    teleport: (p) => teleports.push([...p]),
    started: () => {},
    finished: () => {},
  });
  assert.ok(race.invite(course, 10000, 0, 'solo-race'));
  race.tick(10501, course.start);
  race.tick(race.startAt, course.start);
  return { race, packets, teleports };
}
function fixture(type = 'free', mode = 'speed') {
  return {
    id: `fixture-${type}-${mode}`,
    start: [0, 20, 0],
    finish: [0, 20, -400],
    side: 3,
    mode,
    parTimes: { gold: 10000, silver: 15000, bronze: 20000 },
    scoreTargets: { gold: 600, silver: 400, bronze: 200 },
    gates: [
      {
        id: 'first',
        position: [0, 20, -100],
        radius: 8,
        type,
        next: ['finish'],
        bonus: 100,
        required: type !== 'free',
        scoreTarget: 250,
      },
      {
        id: 'finish',
        position: [0, 20, -400],
        radius: 8,
        type: 'precision',
        next: [],
        bonus: 100,
      },
    ],
  };
}
check(
  'Finish cannot be claimed before checkpoints, including teleport-sized displacement',
  () => {
    const { race } = solo(fixture());
    race.tick(race.startAt + 500, race.course.finish);
    assert.equal(race.phase, 'racing');
    assert.equal(race.splits.length, 0);
    race.tick(race.startAt + 1500, race.course.gates[0].position);
    assert.equal(race.splits.length, 1);
    race.tick(race.startAt + 5000, race.course.finish);
    assert.equal(race.phase, 'finished');
    assert.equal(race.splits.length, 2);
    assert.equal(race.medal, 'gold');
  },
);
check(
  'Swept checkpoint detection catches high-speed passage without endpoint overlap',
  () => {
    const gate = fixture().gates[0];
    assert.notEqual(gateCrossing([0, 20, -80], [0, 20, -120], gate), null);
    const { race } = solo(fixture());
    race.tick(race.startAt + 1000, [0, 20, -80]);
    race.tick(race.startAt + 1200, [0, 20, -120]);
    assert.equal(race.splits.length, 1);
    race.tick(race.startAt + 1200, [0, 20, -120]);
    assert.equal(
      race.splits.length,
      1,
      'same frame cannot double award checkpoint',
    );
  },
);
check('Missing a gate preserves progression and gives return guidance', () => {
  const { race } = solo(fixture());
  race.tick(race.startAt + 500, [20, 20, -100]);
  race.tick(race.startAt + 2000, [100, 20, -150]);
  assert.equal(race.missedGate, true);
  assert.equal(race.splits.length, 0);
  race.tick(race.startAt + 3000, [0, 20, -100]);
  assert.equal(race.missedGate, false);
  assert.equal(race.splits.length, 1);
});
check('Skill gates require actual traversal state or recent events', () => {
  const cases = [
    ['low-swing', { mode: 'swing', speed: 25 }],
    ['dive', { verticalSpeed: -20 }],
    ['wall-run', { mode: 'wallRun' }],
    ['point-launch', { events: ['point-launch'] }],
    ['zip', { mode: 'webZip' }],
    ['loop', { events: ['loop-completed'] }],
    ['rooftop-vault', { mode: 'mantle' }],
    ['trick-score', { styleScore: 300 }],
  ];
  for (const [type, telemetry] of cases) {
    const { race } = solo(fixture(type));
    const target = race.course.gates[0].position;
    race.tick(race.startAt + 1000, target, { mode: 'fall', speed: 25 });
    assert.equal(
      race.splits.length,
      0,
      'Skill gates cannot be completed by presence alone',
    );
    race.tick(race.startAt + 1100, target, telemetry);
    assert.equal(
      race.splits.length,
      1,
      'Skill gates should accept the actual technique',
    );
  }
});
check('Checkpoint bonuses cannot satisfy a trick-score requirement', () => {
  const course = fixture();
  course.gates[0].bonus = 1000;
  Object.assign(course.gates[1], { type: 'trick-score', required: true, scoreTarget: 250 });
  const { race } = solo(course);
  race.tick(race.startAt + 1000, course.gates[0].position);
  race.tick(race.startAt + 3000, course.finish);
  assert.equal(race.phase, 'racing');
  race.tick(race.startAt + 3100, course.finish, { styleScore: 300 });
  assert.equal(race.phase, 'finished');
});

check(
  'Split routes accept either branch, rejoin and have equal checkpoint counts',
  () => {
    for (const alternative of [false, true]) {
      const { race } = solo(generated);
      let tick = race.startAt;
      let count = 0;
      while (race.phase === 'racing' && count++ < 32) {
        const active = generated.gates.filter((g) =>
          race.activeGateIds.includes(g.id),
        );
        const gate = alternative && active.length > 1 ? active[1] : active[0];
        assert.ok(gate);
        tick += 1500;
        race.tick(tick, gate.position);
      }
      assert.equal(race.phase, 'finished');
      assert.equal(race.splits.length, race.gateCount);
      assert.ok(
        race.completedGateIds.has(alternative ? 'gate-4-alt' : 'gate-4'),
      );
      assert.ok(
        !race.completedGateIds.has(alternative ? 'gate-4' : 'gate-4-alt'),
      );
    }
  },
);
check(
  'Malformed checkpoint graphs, duplicate IDs and pathless finish packets rejected',
  () => {
    const bad = structuredClone(generated);
    bad.gates[2].next = [bad.gates[0].id];
    assert.equal(validRaceCourse(bad), false);
    const duplicate = structuredClone(generated);
    duplicate.gates[2].id = duplicate.gates[1].id;
    assert.equal(validRaceCourse(duplicate), false);
    const { race } = solo(generated);
    race.participants.add('remote-player');
    race.receive(
      {
        version: 1,
        type: 'finish',
        sender: 'remote-player',
        raceId: race.raceId,
        sentAt: race.startAt + 1000,
        elapsed: 1000,
      },
      race.startAt + 1000,
    );
    assert.equal(race.results.has('remote-player'), false);
  },
);
check(
  'Style and combined rankings reward score and medals use the selected mode',
  () => {
    assert.ok(
      raceResultValue('style', 20000, 600) <
        raceResultValue('style', 10000, 300),
    );
    assert.ok(
      raceResultValue('combined', 12000, 600) <
        raceResultValue('combined', 10000, 100),
    );
    assert.ok(
      raceResultValue('speed', 10000, 0) <
        raceResultValue('speed', 12000, 9999),
    );
    assert.equal(raceMedal(fixture('free', 'style'), 90000, 650), 'gold');
    assert.equal(raceMedal(fixture('free', 'combined'), 9000, 650), 'gold');
    assert.equal(raceMedal(fixture('free', 'combined'), 9000, 0), 'complete');
  },
);
check(
  'Personal restart clears splits and score without moving other players',
  () => {
    const { race, teleports } = solo(fixture());
    race.tick(race.startAt + 1000, [0, 20, -100], { styleScore: 500 });
    race.participants.add('remote-player');
    const previousStart = race.startAt;
    race.restart(previousStart + 2000);
    assert.equal(race.phase, 'countdown');
    assert.equal(race.splits.length, 0);
    assert.equal(race.styleScore, 0);
    assert.equal(race.participants.size, 1);
    assert.equal(teleports.length, 2);
    assert.equal(race.startAt, previousStart + 2700);
    race.tick(race.startAt, race.course.start);
    assert.equal(race.phase, 'racing');
  },
);
check('Checkpoint PB splits compare matching branch IDs', () => {
  const { race } = solo(fixture());
  race.bestSplits = [{ gateId: 'first', time: 1800, score: 100 }];
  race.tick(race.startAt + 1500, [0, 20, -100]);
  assert.equal(race.splitDelta, -300);
});

const root = new THREE.Group(),
  surfaceFrame = new THREE.Group(),
  model = new THREE.Group(),
  bone = new THREE.Bone();
bone.name = 'test-arm';
model.add(bone);
surfaceFrame.add(model);
root.add(surfaceFrame);
const rig = { root, surfaceFrame, model },
  recorder = new GhostRecorder(rig);
root.position.set(4, 7, 12);
bone.rotation.z = 0.8;
recorder.capture(0);
root.position.x = 14;
bone.rotation.z = 1.2;
recorder.capture(100);
const copy = {
  root: new THREE.Group(),
  surfaceFrame: new THREE.Group(),
  model: new THREE.Group(),
};
const copyBone = new THREE.Bone();
copyBone.name = 'test-arm';
copy.model.add(copyBone);
copy.surfaceFrame.add(copy.model);
copy.root.add(copy.surfaceFrame);
check(
  'Ghost preserves skeleton, interpolated movement, scores and checkpoint splits',
  () => {
    const record = recorder.record(generated, 100, {
      score: 500,
      splits: [{ gateId: 'gate-0', time: 50, score: 100 }],
    });
    poseGhost(copy, record, 50);
    assert.ok(Math.abs(copy.root.position.x - 9) < 1e-5);
    assert.ok(
      Math.abs(new THREE.Euler().setFromQuaternion(copyBone.quaternion).z - 1) <
        1e-5,
    );
    assert.equal(record.score, 500);
    assert.equal(record.splits[0].time, 50);
  },
);
check(
  'Browser PB storage includes mode-aware scores and splits with legacy fallback',
  () => {
    const data = new Map();
    globalThis.localStorage = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value),
    };
    const c = fixture('free', 'style');
    storeBest(c, 20000, {
      score: 600,
      splits: [{ gateId: 'first', time: 3000, score: 100 }],
    });
    const best = readBestRun(c.id);
    assert.equal(best.splits[0].time, 3000);
    assert.equal(best.score, 600);
    assert.equal(isBetterRaceRun(c, 30000, 700, best), true);
    assert.equal(isBetterRaceRun(c, 10000, 100, best), false);
    delete globalThis.localStorage;
  },
);
const state = createTraversalState(
    { x: 10, y: 30, z: 0 },
    { x: 0, y: -10, z: 0 },
  ),
  lanes = [
    {
      start: new THREE.Vector3(0, 30, 0),
      end: new THREE.Vector3(100, 30, 0),
      radius: 9,
    },
  ];
check(
  'Wind is a bounded pure acceleration consumed by the physics solver',
  () => {
    const before = { ...state.velocity };
    const wind = sampleWindAssist(state, lanes, 1 / 60);
    assert.equal(wind.active, true);
    assert.deepEqual(state.velocity, before);
    assert.ok(Math.hypot(...Object.values(wind.acceleration)) <= 12.0001);
    const calm = stepTraversal(state, {}, { groundY: -100 }, 1 / 60).state;
    const lifted = stepTraversal(
      state,
      {},
      { groundY: -100, windAcceleration: wind.acceleration },
      1 / 60,
    ).state;
    assert.ok(lifted.velocity.x > calm.velocity.x);
    assert.ok(lifted.velocity.y > calm.velocity.y);
    state.position.z = 30;
    assert.equal(sampleWindAssist(state, lanes, 0.1).active, false);
    state.position.z = 0;
    state.grounded = true;
    assert.equal(sampleWindAssist(state, lanes, 0.1).active, false);
    state.grounded = false;
    state.swing = {
      anchor: { x: 10, y: 60, z: 0 },
      ropeLength: 30,
      maximumLength: 30,
      attachedSeconds: 1,
      tension: 1,
      pressure: 0,
    };
    const swung = sampleWindAssist(state, lanes, 1 / 60);
    assert.equal(swung.active, true);
    assert.ok(
      Math.abs(swung.acceleration.y) < 1e-9,
      'wind cannot pull radially through a rope',
    );
  },
);

const city = new THREE.Group(),
  material = new THREE.MeshBasicMaterial();
const floor = new THREE.Mesh(new THREE.BoxGeometry(160, 0.2, 160), material);
floor.position.y = -0.1;
city.add(floor);
for (const x of [-45, 45])
  for (const z of [-45, 45]) {
    const block = new THREE.Mesh(new THREE.BoxGeometry(32, 40, 32), material);
    block.position.set(x, 20, z);
    city.add(block);
  }
const world = new RepeatingMeshWorld(
  await WorldMeshQuery.fromObject(city),
  160,
  160,
);
let geometryCourse;
check(
  'Geometry sampled courses use real floors, rooftops and facades across unseen tiles',
  () => {
    const sample = createRaceGeometrySampler(world);
    geometryCourse = createRaceCourse([45, 40, 45], 160, 160, 17, -1, {
      sample,
      mapId: 'fixture-city',
      mode: 'combined',
    });
    assert.ok(validRaceCourse(geometryCourse));
    assert.ok(geometryCourse.gates.some((g) => g.type === 'low-swing'));
    assert.ok(geometryCourse.gates.some((g) => g.type === 'wall-run'));
    for (const gate of geometryCourse.gates) {
      assert.ok(
        world.isCapsuleClear(
          { x: gate.position[0], y: gate.position[1], z: gate.position[2] },
          0.5,
          2.05,
        ),
        `${gate.id}/${gate.type} volume must not be inside geometry`,
      );
      if (gate.type === 'wall-run') {
        const point = new THREE.Vector3().fromArray(gate.position);
        assert.ok(
          [
            [1, 0, 0],
            [-1, 0, 0],
            [0, 0, 1],
            [0, 0, -1],
          ].some((d) => world.raycast(point, new THREE.Vector3(...d), 2)),
          'wall gate has a real nearby facade',
        );
      }
    }
  },
);
check(
  'Gate visuals, route progression and quality changes retain all gameplay markers',
  () => {
    const scene = new THREE.Scene(),
      visuals = new RaceWorldVisuals(scene);
    visuals.setCourse(geometryCourse, world);
    const first = geometryCourse.gates[0],
      second = geometryCourse.gates[1];
    visuals.setProgress([second.id], new Set([first.id]));
    assert.deepEqual(
      raceRoutePoints(geometryCourse, [second.id])[0],
      second.position,
    );
    visuals.setParticleDensity(0.2);
    visuals.update(geometryCourse.start, 1);
    assert.ok(visuals.root.visible);
    assert.ok(
      visuals.root.children.some(
        (o) =>
          o instanceof THREE.Mesh &&
          o.position.distanceTo(
            new THREE.Vector3().fromArray(second.position),
          ) < 0.01 &&
          o.visible,
      ),
    );
    visuals.clear();
    assert.equal(visuals.lanes.length, 0);
    assert.equal(visuals.root.visible, false);
    visuals.dispose();
  },
);
await fs.writeFile(
  'docs/verification/racing-report.json',
  JSON.stringify(
    { passed: true, checks, sharedCourse: generated, geometryCourse, finishes },
    null,
    2,
  ) + '\n',
);
console.log(
  `PASS ${checks.length} race course, input-independent protocol, checkpoint, scoring, ghost and budgeted wind checks.`,
);
