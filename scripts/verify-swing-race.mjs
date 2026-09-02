import assert from 'node:assert/strict';
import { advanceSwingRace, courseTileKeys, createSwingRaceState, formatRaceTime, interpolateRaceSample, parseRaceBest, raceGuidanceLine, sampleRaceTrack } from '../lib/swing-race.ts';
import { createCinematicCameraState, stepCinematicCamera } from '../lib/cinematic-camera.ts';
import { deterministicRaceNodes, deterministicTileId, infiniteTileAddress } from '../lib/deterministic-world.ts';

const route = [{ x: 2, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }];
const race = createSwingRaceState(10);
assert.equal(advanceSwingRace(race, { x: 0, y: 0, z: 0 }, route, 11, 1), null);
assert.equal(advanceSwingRace(race, { x: 2, y: 0, z: 0 }, route, 12, 1)?.finished, false);
assert.equal(advanceSwingRace(race, { x: 4, y: 0, z: 0 }, route, 15, 1)?.duration, 5);
assert.equal(race.lap, 2);

const sweptRace = createSwingRaceState(0, { x: 0, y: 0, z: 0 });
const sweptGate = [{ x: 30, y: 24, z: 0 }];
assert.equal(advanceSwingRace(sweptRace, { x: 20, y: 8, z: 0 }, sweptGate, 1, 5), null);
assert.equal(advanceSwingRace(sweptRace, { x: 40, y: 8, z: 0 }, sweptGate, 2, 5)?.finished, true,
  'a fast player cannot skip a checkpoint between rendered frames');

for (const coordinate of [-100000, -1, 0, 1, 100000]) {
  const first = deterministicTileId('new-york-city', coordinate, -coordinate);
  const second = deterministicTileId('new-york-city', coordinate, -coordinate);
  assert.equal(first, second, 'tile IDs are immutable across calls/runs');
  assert.ok(Number.isInteger(first) && first >= 0 && first <= 0xffffffff);
}
assert.notEqual(deterministicTileId('new-york-city', 1, 0), deterministicTileId('new-york-city', 2, 0));
const address = infiniteTileAddress('new-york-city', { x: 1250, z: -760 }, 100, 80);
assert.deepEqual({ x: address.x, z: address.z }, { x: 13, z: -9 });
const deterministicCourseA = deterministicRaceNodes('new-york-city', { x: 0, z: 0 }, 180, 160);
const deterministicCourseB = deterministicRaceNodes('new-york-city', { x: 0, z: 0 }, 180, 160);
assert.deepEqual(deterministicCourseA, deterministicCourseB, 'race nodes and IDs never change between runs');
for (let index = 1; index < deterministicCourseA.length; index += 1) {
  assert.notEqual(deterministicCourseA[index].id, deterministicCourseA[index - 1].id);
}

const guidance = raceGuidanceLine({ x: 12, y: 8, z: -4 }, { x: 50, y: 30, z: 22 });
assert.deepEqual(guidance, [12, 8.48, -4, 50, 30, 22]);
assert.equal(guidance.length, 6, 'guidance is one straight segment, never a whole-course squiggle');

const samples = [];
sampleRaceTrack(samples, { t: 0, x: 0, y: 0, z: 0, yaw: 3.1, pose: 'run' });
sampleRaceTrack(samples, { t: .02, x: 2, y: 0, z: 0, yaw: -3.1, pose: 'run' });
sampleRaceTrack(samples, { t: .1, x: 10, y: 2, z: 0, yaw: -3.1, pose: 'swing' });
assert.equal(samples.length, 2);
const middle = interpolateRaceSample(samples, .05);
assert.ok(middle && Math.abs(middle.x - 5) < .001);
assert.ok(middle && Math.abs(Math.abs(middle.yaw) - Math.PI) < .05, 'yaw interpolates across the short arc');
assert.equal(parseRaceBest(JSON.stringify({ duration: 9.2, samples }))?.samples.length, 2);
assert.equal(parseRaceBest('{bad'), null);
assert.equal(formatRaceTime(65.125), '01:05.125');
assert.equal(formatRaceTime(59.9996), '01:00.000');

const pinned = courseTileKeys([
  { x: 0, y: 0, z: 0 }, { x: 62, y: 30, z: 0 }, { x: 62, y: 10, z: -62 }, { x: 0, y: 0, z: 0 },
], 100, 100);
assert.deepEqual([...pinned].sort(), ['0:0', '1:-1', '1:0']);

const camera = createCinematicCameraState();
let view = stepCinematicCamera(camera, { mode: 'swing', speed: 38, verticalSpeed: 4, turnRate: 2, webLateral: .4, grounded: false }, 1 / 60);
assert.equal(view.phase, 'swing');
assert.ok(view.distanceOffset < 0 && view.fovOffset > 0);
view = stepCinematicCamera(camera, { mode: 'jump', speed: 42, verticalSpeed: 12, turnRate: 0, webLateral: 0, grounded: false }, 1 / 60);
assert.equal(view.phase, 'release');
assert.ok(view.distanceOffset > 3, 'release visibly pulls composition outward');
assert.ok(view.fovOffset > 10, 'release visibly widens the field of view');
assert.ok(Math.abs(view.roll) <= .27 && view.shake <= .095, 'cinematic effects stay bounded');
view = stepCinematicCamera(camera, { mode: 'jump', speed: 55, verticalSpeed: 8, turnRate: 1, webLateral: .5, grounded: false, boostStrength: 1, wallKick: 1 }, 1 / 60);
assert.equal(view.phase, 'wall');
assert.ok(view.distanceOffset > 2 && view.shake > .04, 'wind and wall kick produce a visible cinematic pulse');

const zipCamera = createCinematicCameraState();
let zipView;
for (let frame = 0; frame < 12; frame += 1) {
  zipView = stepCinematicCamera(zipCamera, {
    mode: 'webZip', speed: 34, verticalSpeed: 5, turnRate: .4, webLateral: .2, grounded: false,
  }, 1 / 60);
}
assert.equal(zipView.phase, 'zip');
assert.equal(zipView.zoomDirection, 'in');
assert.ok(zipView.distanceOffset < -2, 'web zip brings the chase camera in close');
assert.ok(zipView.fovOffset < 0, 'web zip narrows FOV for a visible punch-in');
zipView = stepCinematicCamera(zipCamera, {
  mode: 'jump', speed: 46, verticalSpeed: 14, turnRate: 0, webLateral: 0, grounded: false,
}, 1 / 60);
assert.equal(zipView.zoomDirection, 'out');
assert.ok(zipView.distanceOffset > 2.5, 'zip release pulls back into a wider launch shot');
assert.ok(zipView.fovOffset > 10, 'zip release widens FOV to sell launch speed');
assert.ok(Math.abs(zipView.roll) <= .27 && zipView.shake <= .095, 'zip camera effects remain bounded');

console.log('Swing race and cinematic camera verification passed.');
