/**
 * Assisted traversal policy. All units are metres, seconds and metres/second.
 * These helpers change velocity only; the existing capsule sweep owns position.
 * This is deliberately arcade locomotion, not a passive pendulum simulation.
 */
export type FeelVector = { x: number; y: number; z: number };
export type FeelWall = {
  feetTouching?: boolean;
  graceSeconds: number;
  runEntrySpeed?: number;
};

export const SPIDER_TRAVERSAL_FEEL = Object.freeze({
  arcadeTraversal: true,
  maximumSpeed: 94,
  swingMaximumLength: 105,
  anchorMaximumDistance: 130,
  swingPumpAcceleration: 40,
  swingSteerAcceleration: 72,
  wallRunSpeed: 18,
  wallRunLift: 6,
  wallContactGrace: 0.08,
});

export const SWING_RELEASE = Object.freeze({
  fullChargeSeconds: 1.2,
  minimumUpSpeed: 7,
  maximumUpSpeed: 35,
  minimumForwardBoost: 4,
  maximumForwardBoost: 16,
  noBoostBeforeSeconds: 0.06,
  catchRampSeconds: 0.16,
});
export const AIR_ZIP = Object.freeze({
  duration: 0.28,
  acceleration: 220,
  maximumTurnRate: 4,
});

const EPS = 1e-8;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const smooth = (x: number) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const dot = (a: FeelVector, b: FeelVector) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (v: FeelVector) => Math.hypot(v.x, v.y, v.z);
const cross = (a: FeelVector, b: FeelVector): FeelVector => ({
  x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x,
});
const project = (v: FeelVector, n: FeelVector): FeelVector => {
  const d = dot(v, n);
  return { x: v.x - n.x * d, y: v.y - n.y * d, z: v.z - n.z * d };
};
function unit(v: FeelVector, fallback: FeelVector = { x: 0, y: 0, z: -1 }): FeelVector {
  const size = norm(v);
  return size > EPS ? { x: v.x / size, y: v.y / size, z: v.z / size } : { ...fallback };
}
function horizontalDirection(v: FeelVector, fallback: FeelVector): FeelVector {
  return unit({ x: v.x, y: 0, z: v.z }, unit({ x: fallback.x, y: 0, z: fallback.z }));
}
function finite(v: FeelVector): void {
  if (![v.x, v.y, v.z].every(Number.isFinite)) throw new RangeError('Non-finite traversal velocity');
}
export function limitFeelVelocity(v: FeelVector, maximum: number): FeelVector {
  finite(v);
  if (!Number.isFinite(maximum) || maximum <= 0) throw new RangeError('maximumSpeed must be positive and finite');
  const ratio = Math.min(1, maximum / Math.max(norm(v), EPS));
  return { x: v.x * ratio, y: v.y * ratio, z: v.z * ratio };
}

/**
 * A tap is not a free jump. After the catch ramp, hold time earns an upward
 * launch floor. Existing rising velocity is kept until the total speed cap.
 * Redirecting a fall can spend its kinetic speed on forward travel.
 */
export function chargedSwingRelease(
  incoming: FeelVector,
  heldSeconds: number,
  fallbackForward: FeelVector,
  maximumSpeed: number,
): FeelVector {
  const velocity = limitFeelVelocity(incoming, maximumSpeed);
  const seconds = Number.isFinite(heldSeconds) ? Math.max(0, heldSeconds) : 0;
  const gate = smooth((seconds - SWING_RELEASE.noBoostBeforeSeconds) / SWING_RELEASE.catchRampSeconds);
  if (gate === 0) return velocity;
  const charge = clamp(seconds / SWING_RELEASE.fullChargeSeconds, 0, 1);
  // Releasing on a downswing is a legitimate choice: preserve the descent for
  // another low catch. Charge only raises the launch floor progressively.
  const descendingRelease = velocity.y < -2 && charge < .42;
  const desiredUp = SWING_RELEASE.minimumUpSpeed
    + (SWING_RELEASE.maximumUpSpeed - SWING_RELEASE.minimumUpSpeed) * charge;
  // Blend out downward velocity during the catch ramp, rather than flipping a
  // 60 ms click directly into a fully charged ascent.
  const liftGate = descendingRelease ? gate * charge * .35 : gate;
  const y = velocity.y + Math.max(0, desiredUp - velocity.y) * liftGate;
  const speed = norm(velocity);
  const inheritedHorizontal = Math.hypot(velocity.x, velocity.z);
  const boost = (SWING_RELEASE.minimumForwardBoost
    + (SWING_RELEASE.maximumForwardBoost - SWING_RELEASE.minimumForwardBoost) * charge) * gate;
  const horizontalSpeed = Math.max(
    inheritedHorizontal + boost,
    Math.sqrt(Math.max(0, speed * speed - y * y)),
  );
  const forward = horizontalDirection(velocity, fallbackForward);
  return limitFeelVelocity({ x: forward.x * horizontalSpeed, y, z: forward.z * horizontalSpeed }, maximumSpeed);
}

/** Steering rotates tangential velocity, so it still works at the speed cap. */
export function steerSwingTangent(
  incoming: FeelVector,
  radialNormal: FeelVector,
  desiredDirection: FeelVector,
  deltaSeconds: number,
  lateralAcceleration: number,
): FeelVector {
  finite(incoming);
  const dt = clamp(deltaSeconds, 0, 0.05);
  if (dt === 0 || lateralAcceleration <= 0) return { ...incoming };
  const radial = unit(radialNormal, { x: 0, y: -1, z: 0 });
  const tangent = project(incoming, radial);
  const speed = norm(tangent);
  const desired = project(desiredDirection, radial);
  if (speed < EPS || norm(desired) < EPS) return { ...incoming };
  const from = unit(tangent), to = unit(desired);
  const angle = Math.atan2(dot(radial, cross(from, to)), clamp(dot(from, to), -1, 1));
  const maximumTurn = Math.min(1.8, lateralAcceleration / Math.max(4, speed)) * dt;
  const turn = clamp(angle, -maximumTurn, maximumTurn);
  const side = cross(radial, tangent);
  const cos = Math.cos(turn), sin = Math.sin(turn), radialSpeed = dot(incoming, radial);
  return {
    x: tangent.x * cos + side.x * sin + radial.x * radialSpeed,
    y: tangent.y * cos + side.y * sin + radial.y * radialSpeed,
    z: tangent.z * cos + side.z * sin + radial.z * radialSpeed,
  };
}

/** Camera yaw controls assisted travel; the rope still owns vertical swing motion. */
export function steerSwingHeading(incoming: FeelVector, desired: FeelVector, dt: number, acceleration: number): FeelVector {
  finite(incoming);
  const speed = Math.hypot(incoming.x, incoming.z);
  if (speed < EPS || Math.hypot(desired.x, desired.z) < EPS) return { ...incoming };
  const from = horizontalDirection(incoming, desired), to = horizontalDirection(desired, from);
  const angle = Math.atan2(from.x * to.z - from.z * to.x, dot(from, to));
  const limit = Math.min(2.3, Math.max(0, acceleration) / Math.max(4, speed)) * clamp(dt, 0, .05);
  const turn = clamp(angle, -limit, limit), cos = Math.cos(turn), sin = Math.sin(turn);
  return { x: (from.x * cos - from.z * sin) * speed, y: incoming.y,
    z: (from.x * sin + from.z * cos) * speed };
}

export function hasWallRunSupport(wall: FeelWall | null | undefined): boolean {
  return Boolean(wall && (wall.feetTouching
    || (wall.runEntrySpeed !== undefined && wall.graceSeconds > 1e-8)));
}

/**
 * Redirect speed along a real facade instead of discarding the impact component.
 * Normal sticking velocity is small and is removed by the collision solver.
 * Positive climb is automatic; S explicitly requests descent.
 */
export function arcadeWallRunVelocity(
  incoming: FeelVector,
  surfaceNormal: FeelVector,
  fallbackForward: FeelVector,
  speedFloor: number,
  maximumSpeed: number,
  minimumRunSpeed: number,
  liftSpeed: number,
  climbInput = 0,
): FeelVector {
  const velocity = limitFeelVelocity(incoming, maximumSpeed);
  const normal = unit({ x: surfaceNormal.x, y: 0, z: surfaceNormal.z }, { x: 1, y: 0, z: 0 });
  const tangent = project(velocity, normal);
  const side = { x: normal.z, y: 0, z: -normal.x };
  const projectedForward = project({ x: fallbackForward.x, y: 0, z: fallbackForward.z }, normal);
  const fallback = norm(projectedForward) > EPS ? unit(projectedForward) : side;
  const direction = horizontalDirection(tangent, fallback);
  const stick = Math.min(0.8, maximumSpeed * 0.02);
  const tangentLimit = Math.sqrt(Math.max(0, maximumSpeed * maximumSpeed - stick * stick));
  const speed = clamp(Math.max(norm(tangent), speedFloor, minimumRunSpeed), 0, tangentLimit);
  const requestedUp = climbInput < -0.25 ? -liftSpeed
    : Math.max(liftSpeed, tangent.y);
  const y = clamp(requestedUp, -speed * 0.85, speed * 0.85);
  const horizontalSpeed = Math.sqrt(Math.max(0, speed * speed - y * y));
  return {
    x: direction.x * horizontalSpeed - normal.x * stick,
    y,
    z: direction.z * horizontalSpeed - normal.z * stick,
  };
}

/** A timed air zip adds forward speed, never positive vertical acceleration. */
export function arcadeAirZipVelocity(
  incoming: FeelVector,
  desiredForward: FeelVector,
  deltaSeconds: number,
  targetHorizontalSpeed: number,
  maximumSpeed: number,
  gravity: number,
): FeelVector {
  const velocity = limitFeelVelocity(incoming, maximumSpeed);
  const dt = clamp(deltaSeconds, 0, 0.05);
  if (dt === 0) return velocity;
  const speed = Math.hypot(velocity.x, velocity.z);
  const desired = horizontalDirection(desiredForward, velocity);
  const from = horizontalDirection(velocity, desired);
  const angle = Math.atan2(from.x * desired.z - from.z * desired.x, from.x * desired.x + from.z * desired.z);
  const turn = clamp(angle, -AIR_ZIP.maximumTurnRate * dt, AIR_ZIP.maximumTurnRate * dt);
  const direction = { x: from.x * Math.cos(turn) - from.z * Math.sin(turn),
    z: from.x * Math.sin(turn) + from.z * Math.cos(turn) };
  const requested = Math.max(speed, Math.min(targetHorizontalSpeed, speed + AIR_ZIP.acceleration * dt));
  // Keep gravity's vertical result and spend only the remaining speed budget
  // horizontally. Normalizing the whole vector here would brake a fall upward.
  const y = clamp(velocity.y - Math.max(0, gravity) * dt, -maximumSpeed, maximumSpeed);
  const horizontalSpeed = Math.min(requested, Math.sqrt(Math.max(0, maximumSpeed * maximumSpeed - y * y)));
  return { x: direction.x * horizontalSpeed, y, z: direction.z * horizontalSpeed };
}
