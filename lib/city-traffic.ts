export type TrafficPoint = { x: number; y: number; z: number };
export type TrafficBounds = { minX: number; maxX: number; minZ: number; maxZ: number };
export type TrafficLane = { from: TrafficPoint; to: TrafficPoint; length: number };

type LaneOptions = { candidates?: number; samples?: number; maximum?: number; minimumLength?: number };

const distance = (a: TrafficPoint, b: TrafficPoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Finds long axis-aligned runs that stay on a driveable surface. Broken runs
 * are split at buildings so a vehicle never takes a shortcut through a facade. */
export function findTrafficLanes(
  bounds: TrafficBounds,
  driveableY: (x: number, z: number) => number | null,
  options: LaneOptions = {},
) {
  const candidates = options.candidates ?? 9;
  const samples = options.samples ?? 40;
  const maximum = options.maximum ?? 6;
  const minimumLength = options.minimumLength ?? 24;
  const marginX = Math.min(12, Math.max(2, (bounds.maxX - bounds.minX) * .06));
  const marginZ = Math.min(12, Math.max(2, (bounds.maxZ - bounds.minZ) * .06));
  const lanes: Array<TrafficLane & { axis: 'x' | 'z'; offset: number }> = [];

  const scan = (axis: 'x' | 'z', offset: number) => {
    const start = axis === 'x' ? bounds.minX + marginX : bounds.minZ + marginZ;
    const end = axis === 'x' ? bounds.maxX - marginX : bounds.maxZ - marginZ;
    let runStart = -1;
    let runY = 0;
    let runSamples = 0;
    const finish = (index: number) => {
      if (runStart < 0 || runSamples < 2) return;
      const startT = runStart / samples;
      const endT = (index - 1) / samples;
      const a = start + (end - start) * startT;
      const b = start + (end - start) * endT;
      const y = runY / runSamples;
      const from = axis === 'x' ? { x: a, y, z: offset } : { x: offset, y, z: a };
      const to = axis === 'x' ? { x: b, y, z: offset } : { x: offset, y, z: b };
      const length = distance(from, to);
      if (length >= minimumLength) lanes.push({ from, to, length, axis, offset });
    };
    for (let index = 0; index <= samples + 1; index += 1) {
      const t = index / samples;
      const along = start + (end - start) * t;
      const y = index <= samples ? driveableY(axis === 'x' ? along : offset, axis === 'x' ? offset : along) : null;
      if (y !== null) {
        if (runStart < 0) { runStart = index; runY = 0; runSamples = 0; }
        runY += y;
        runSamples += 1;
      } else {
        finish(index);
        runStart = -1;
        runY = 0;
        runSamples = 0;
      }
    }
  };

  for (let index = 1; index <= candidates; index += 1) {
    const blend = index / (candidates + 1);
    scan('x', bounds.minZ + (bounds.maxZ - bounds.minZ) * blend);
    scan('z', bounds.minX + (bounds.maxX - bounds.minX) * blend);
  }

  // Prefer the longest roads but keep parallel lanes apart so traffic is spread
  // across the visible district rather than stacked on a single avenue.
  const selected: TrafficLane[] = [];
  const minSeparation = Math.min(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) * .07;
  for (const lane of lanes.sort((a, b) => b.length - a.length)) {
    const duplicate = selected.some((other) => {
      const otherAxis = Math.abs(other.to.x - other.from.x) > Math.abs(other.to.z - other.from.z) ? 'x' : 'z';
      if (otherAxis !== lane.axis) return false;
      const otherOffset = otherAxis === 'x' ? other.from.z : other.from.x;
      return Math.abs(otherOffset - lane.offset) < minSeparation;
    });
    if (!duplicate) selected.push(lane);
    if (selected.length >= maximum) break;
  }
  return selected;
}

export function trafficPose(lane: TrafficLane, elapsed: number, speed: number, offset = 0) {
  const span = Math.max(.001, lane.length);
  const cycle = ((elapsed * speed + offset) % (span * 2) + span * 2) % (span * 2);
  const forward = cycle <= span;
  const t = (forward ? cycle : span * 2 - cycle) / span;
  const dx = lane.to.x - lane.from.x;
  const dz = lane.to.z - lane.from.z;
  return {
    x: lane.from.x + dx * t,
    y: lane.from.y + (lane.to.y - lane.from.y) * t,
    z: lane.from.z + dz * t,
    yaw: Math.atan2(forward ? dx : -dx, forward ? dz : -dz),
    forward,
  };
}

