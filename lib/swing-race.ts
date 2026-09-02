import type { DistrictId, SuitId } from './game-config.ts';

export type RacePoint = { x: number; y: number; z: number };
export type RaceSample = RacePoint & { t: number; yaw: number; pose: string };
export type RaceBest = { duration: number; samples: RaceSample[] };

export type SwingRaceState = {
  startedAt: number;
  checkpoint: number;
  lap: number;
  lastFinish: number | null;
  previousPosition: RacePoint | null;
};

export const raceStorageKey = (district: DistrictId, suit: SuitId) => `spiderman:swing-race:v2:${district}:${suit}`;

export const createSwingRaceState = (now = 0, position: RacePoint | null = null): SwingRaceState => ({
  startedAt: now,
  checkpoint: 0,
  lap: 1,
  lastFinish: null,
  previousPosition: position ? { ...position } : null,
});

export const checkpointDistance = (a: RacePoint, b: RacePoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** A deliberately straight, player-attached guide to the active gate. Keeping
 * exactly two endpoints prevents the old whole-course zig-zag from reading as
 * a distant squiggle while the player is moving through repeated city tiles. */
export function raceGuidanceLine(from: RacePoint, to: RacePoint, playerLift = .48) {
  return [from.x, from.y + playerLift, from.z, to.x, to.y, to.z];
}

/** Tiles touched by the closed race line. Pinning this set prevents an infinite
 * repeating world from replacing the course's recognizable buildings mid-lap. */
export function courseTileKeys(points: readonly RacePoint[], width: number, depth: number, origin: RacePoint = { x: 0, y: 0, z: 0 }) {
  const keys = new Set<string>();
  if (!points.length || width <= 0 || depth <= 0) return keys;
  for (let segment = 1; segment < points.length; segment += 1) {
    const from = points[segment - 1], to = points[segment];
    const distance = checkpointDistance(from, to);
    const steps = Math.max(1, Math.ceil(distance / Math.max(4, Math.min(width, depth) * .2)));
    for (let step = 0; step <= steps; step += 1) {
      const blend = step / steps;
      const x = from.x + (to.x - from.x) * blend;
      const z = from.z + (to.z - from.z) * blend;
      keys.add(`${Math.round((x - origin.x) / width)}:${Math.round((z - origin.z) / depth)}`);
    }
  }
  if (points.length === 1) keys.add(`${Math.round((points[0].x - origin.x) / width)}:${Math.round((points[0].z - origin.z) / depth)}`);
  return keys;
}

const scaledSegmentDistance = (from: RacePoint, to: RacePoint, point: RacePoint, horizontalRadius: number, verticalRadius: number) => {
  const ax = from.x / horizontalRadius, ay = from.y / verticalRadius, az = from.z / horizontalRadius;
  const bx = to.x / horizontalRadius, by = to.y / verticalRadius, bz = to.z / horizontalRadius;
  const px = point.x / horizontalRadius, py = point.y / verticalRadius, pz = point.z / horizontalRadius;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  const blend = lengthSquared > 1e-8
    ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / lengthSquared))
    : 0;
  return Math.hypot(px - (ax + dx * blend), py - (ay + dy * blend), pz - (az + dz * blend));
};

export function advanceSwingRace(state: SwingRaceState, position: RacePoint, route: readonly RacePoint[], now: number, radius: number) {
  if (!route.length) return null;
  const previous = state.previousPosition ?? position;
  const target = route[state.checkpoint];
  const verticalRadius = Math.max(16, radius * 3.2);
  const crossed = scaledSegmentDistance(previous, position, target, radius, verticalRadius) <= 1;
  state.previousPosition = { ...position };
  if (!crossed) return null;
  state.checkpoint += 1;
  if (state.checkpoint < route.length) return { checkpoint: state.checkpoint, finished: false as const, duration: null };
  const duration = Math.max(0, now - state.startedAt);
  state.checkpoint = 0;
  state.startedAt = now;
  state.lap += 1;
  state.lastFinish = duration;
  state.previousPosition = { ...position };
  return { checkpoint: 0, finished: true as const, duration };
}

export function sampleRaceTrack(samples: RaceSample[], sample: RaceSample, interval = .08) {
  const previous = samples.at(-1);
  if (!previous || sample.t - previous.t >= interval || sample.t < previous.t) samples.push(sample);
}

export function interpolateRaceSample(samples: readonly RaceSample[], time: number): RaceSample | null {
  if (!samples.length) return null;
  if (time <= samples[0].t) return { ...samples[0] };
  const last = samples[samples.length - 1];
  if (time >= last.t) return { ...last };
  let low = 0, high = samples.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (samples[middle].t <= time) low = middle;
    else high = middle;
  }
  const a = samples[low], b = samples[high];
  const blend = Math.max(0, Math.min(1, (time - a.t) / Math.max(.0001, b.t - a.t)));
  const yawDelta = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));
  return {
    t: time,
    x: a.x + (b.x - a.x) * blend,
    y: a.y + (b.y - a.y) * blend,
    z: a.z + (b.z - a.z) * blend,
    yaw: a.yaw + yawDelta * blend,
    pose: blend < .5 ? a.pose : b.pose,
  };
}

export function parseRaceBest(raw: string | null): RaceBest | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as RaceBest;
    if (!Number.isFinite(value.duration) || value.duration <= 0 || !Array.isArray(value.samples) || value.samples.length < 2) return null;
    if (value.samples.some(sample => !Number.isFinite(sample.t + sample.x + sample.y + sample.z + sample.yaw))) return null;
    return value;
  } catch {
    return null;
  }
}

export const formatRaceTime = (seconds: number | null) => {
  if (seconds === null || !Number.isFinite(seconds)) return '--:--.---';
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const minutes = Math.floor(milliseconds / 60_000);
  const remainder = (milliseconds % 60_000) / 1000;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(3).padStart(6, '0')}`;
};
