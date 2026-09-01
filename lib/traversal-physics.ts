/**
 * Deterministic, renderer-agnostic traversal physics for a Spider-Man-style game.
 *
 * Every vector type is structurally compatible with THREE.Vector3. The module
 * intentionally stores plain `{ x, y, z }` values so it can also run in tests,
 * workers, or a server-side replay without a WebGL/DOM dependency.
 */

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export type TraversalMode =
  | 'idle'
  | 'run'
  | 'jump'
  | 'fall'
  | 'dive'
  | 'swing'
  | 'webZip'
  | 'pointLaunch'
  | 'wallRun'
  | 'wallCrawl'
  | 'mantle'
  | 'wallJump'
  | 'perch'
  | 'land';

export type TraversalEventType =
  | 'jump'
  | 'land'
  | 'web-attached'
  | 'web-released'
  | 'zip-started'
  | 'zip-cancelled'
  | 'point-launch'
  | 'wall-contact'
  | 'wall-jump'
  | 'perched';

export interface TraversalAabb {
  min: Vector3Like;
  max: Vector3Like;
  id?: string;
}

export interface SurfaceContact {
  point: Vector3Like;
  normal: Vector3Like;
  colliderId?: string;
  /** True only when the wall overlaps the player's lower foot probe. */
  feetTouching?: boolean;
}

export interface WebAnchorCandidate {
  /** A stable identifier is useful for rendering and replay diagnostics. */
  id?: string;
  point: Vector3Like;
  normal?: Vector3Like;
  kind?: 'facade' | 'roof' | 'ledge' | 'perch' | 'generic';
  /** Set false when an external raycast found an obstruction. */
  lineOfSight?: boolean;
  /** Optional authoring hint. Values above one are increasingly preferred. */
  weight?: number;
}

export interface TraversalInput {
  /** Desired world-space movement direction. It does not need to be normalized. */
  move?: Vector3Like;
  /** Horizontal camera direction, used for assistance and camera-relative launches. */
  cameraForward?: Vector3Like;
  /** World-space pointer/raycast direction used to score real geometry anchors. */
  aimDirection?: Vector3Like;
  jumpPressed?: boolean;
  jumpHeld?: boolean;
  swingPressed?: boolean;
  swingHeld?: boolean;
  swingReleased?: boolean;
  zipPressed?: boolean;
  zipHeld?: boolean;
  zipReleased?: boolean;
  diveHeld?: boolean;
  /** Edge-triggered toggle, never a continuously held command. */
  wallCrawlPressed?: boolean;
  /** -1 descends a wall, +1 climbs. If omitted, forward crawl climbs gently. */
  wallClimb?: number;
  wallStrafe?: number;
  /** Trackpad/stylus pressure in [0, 1]. Keyboard input can omit it. */
  pointerPressure?: number;
  /** Explicit rope length adjustment: -1 reels in, +1 pays out. */
  reel?: number;
}

export interface TraversalEnvironment {
  groundY?: number;
  colliders?: readonly TraversalAabb[];
  /** Wider query for web visibility, without sweeping distant bodies every tick. */
  anchorColliders?: readonly TraversalAabb[];
  /** Mesh ground/roof probe at a foot position; null means no local support. */
  sampleGround?: (position: Vector3Like, maximumStepUp: number, maximumDrop?: number) => number | null;
  /** A mesh/BVH controller may supply a higher fidelity persistent wall contact. */
  wallContact?: SurfaceContact | null;
  anchorCandidates?: readonly WebAnchorCandidate[];
  zipTargets?: readonly WebAnchorCandidate[];
}

export interface SwingRuntime {
  anchor: Vector3Like;
  anchorId?: string;
  ropeLength: number;
  maximumLength: number;
  attachedSeconds: number;
  tension: number;
  pressure: number;
  /** Cumulative low-swing braking impulse; never grants upward velocity. */
  groundAssistImpulse?: number;
  /** Validated ground push-off takes up initial slack above its support plane. */
  launchRopeLength?: number;
}

export interface ZipRuntime {
  target: Vector3Like;
  surfacePoint?: Vector3Like;
  direction?: Vector3Like;
  bestRemaining?: number;
  stalledSeconds?: number;
  targetId?: string;
  elapsed: number;
  startingDistance: number;
  targetKind?: WebAnchorCandidate['kind'];
}

export interface WallRuntime {
  point: Vector3Like;
  normal: Vector3Like;
  colliderId?: string;
  feetTouching: boolean;
  contactSeconds: number;
  graceSeconds: number;
}

export interface TraversalState {
  position: Vector3Like;
  velocity: Vector3Like;
  grounded: boolean;
  mode: TraversalMode;
  swing: SwingRuntime | null;
  zip: ZipRuntime | null;
  wall: WallRuntime | null;
  elapsed: number;
  airSeconds: number;
  coyoteSeconds: number;
  jumpBufferSeconds: number;
  landingSeconds: number;
  pointLaunchSeconds: number;
  wallJumpSeconds: number;
  perchSeconds: number;
  heading: number;
  wallCrawlActive: boolean;
  mantle: { target: Vector3Like; elapsed: number } | null;
  swingNeedsRelease?: boolean;
  /** One ground push-off per cooldown, never a per-frame hovering force. */
  swingGroundLaunchAfter?: number;
  /** Presentation-only release burst; physics remains freely airborne. */
  swingReleaseSeconds?: number;
  /** Prevents a held trigger from reattaching every frame against an obstacle. */
  swingRetryAfter?: number;
}

export interface TraversalEvent {
  type: TraversalEventType;
  position: Vector3Like;
  anchorId?: string;
  colliderId?: string;
  strength?: number;
}

export interface TraversalAnimationContext {
  state: TraversalMode;
  normalizedSpeed: number;
  verticalSpeed: number;
  bodyYaw: number;
  bodyPitch: number;
  bodyRoll: number;
  stride: number;
  airborneBlend: number;
  wallBlend: number;
  swingBlend: number;
  ropeTension: number;
}

export interface TraversalCameraContext {
  fov: number;
  followDistance: number;
  heightOffset: number;
  roll: number;
  shake: number;
  lookAhead: Vector3Like;
  speedLines: number;
}

export interface TraversalContext {
  animation: TraversalAnimationContext;
  camera: TraversalCameraContext;
  speed: number;
  horizontalSpeed: number;
  grounded: boolean;
  wallNormal: Vector3Like | null;
  webAnchor: Vector3Like | null;
  webTension: number;
  canPointLaunch: boolean;
}

export interface TraversalStepResult {
  state: TraversalState;
  context: TraversalContext;
  events: TraversalEvent[];
}

export interface TraversalConfig {
  gravity: number;
  groundAcceleration: number;
  airAcceleration: number;
  groundFriction: number;
  runSpeed: number;
  maximumSpeed: number;
  jumpSpeed: number;
  coyoteTime: number;
  jumpBufferTime: number;
  playerRadius: number;
  playerHeight: number;
  collisionStep: number;
  swingMinimumLength: number;
  swingMaximumLength: number;
  swingSpring: number;
  swingDamping: number;
  swingPumpAcceleration: number;
  swingSteerAcceleration: number;
  swingReelSpeed: number;
  swingReleaseBoost: number;
  swingReleaseLift: number;
  zipAcceleration: number;
  zipDamping: number;
  zipMaximumSpeed: number;
  pointLaunchWindow: number;
  pointLaunchSpeed: number;
  pointLaunchLift: number;
  diveGravityMultiplier: number;
  diveAcceleration: number;
  wallStickAcceleration: number;
  wallRunMinimumSpeed: number;
  wallRunSpeed: number;
  wallRunLift: number;
  wallCrawlSpeed: number;
  wallMantleSpeed: number;
  wallJumpOutSpeed: number;
  wallJumpUpSpeed: number;
  wallContactGrace: number;
  anchorMinimumDistance: number;
  anchorMaximumDistance: number;
  anchorMinimumHeight: number;
  baseFov: number;
  maximumFov: number;
}

export const DEFAULT_TRAVERSAL_CONFIG: Readonly<TraversalConfig> = Object.freeze({
  gravity: 29,
  groundAcceleration: 54,
  airAcceleration: 13,
  groundFriction: 11,
  runSpeed: 13,
  maximumSpeed: 68,
  jumpSpeed: 11.5,
  coyoteTime: 0.12,
  jumpBufferTime: 0.13,
  playerRadius: 0.46,
  playerHeight: 2.05,
  collisionStep: 0.24,
  swingMinimumLength: 5,
  swingMaximumLength: 78,
  swingSpring: 64,
  swingDamping: 10,
  swingPumpAcceleration: 24,
  swingSteerAcceleration: 15,
  swingReelSpeed: 9,
  swingReleaseBoost: 13,
  swingReleaseLift: 8.5,
  zipAcceleration: 92,
  zipDamping: 4.8,
  zipMaximumSpeed: 52,
  pointLaunchWindow: 5.5,
  pointLaunchSpeed: 34,
  pointLaunchLift: 15,
  diveGravityMultiplier: 1.72,
  diveAcceleration: 11,
  wallStickAcceleration: 25,
  wallRunMinimumSpeed: 7,
  wallRunSpeed: 15,
  wallRunLift: 5.5,
  // Crawling is traversal, not a slow inspection mode. This reaches the new
  // target smoothly, so attaching never produces a one-frame velocity spike.
  wallCrawlSpeed: 8.5,
  wallMantleSpeed: 5.2,
  wallJumpOutSpeed: 12,
  wallJumpUpSpeed: 12.8,
  wallContactGrace: 0.14,
  anchorMinimumDistance: 4,
  anchorMaximumDistance: 92,
  anchorMinimumHeight: 1.2,
  baseFov: 66,
  maximumFov: 91,
});

const EPSILON = 1e-7;
const UP: Vector3Like = Object.freeze({ x: 0, y: 1, z: 0 });

const value = (number: number | undefined, fallback = 0) => Number.isFinite(number) ? number as number : fallback;
const clamp = (number: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, number));
const saturate = (number: number) => clamp(number, 0, 1);
const damp = (from: number, to: number, lambda: number, delta: number) => from + (to - from) * (1 - Math.exp(-lambda * delta));
const vector = (x = 0, y = 0, z = 0): Vector3Like => ({ x, y, z });
const copy = (source: Vector3Like): Vector3Like => vector(source.x, source.y, source.z);
const add = (a: Vector3Like, b: Vector3Like): Vector3Like => vector(a.x + b.x, a.y + b.y, a.z + b.z);
const subtract = (a: Vector3Like, b: Vector3Like): Vector3Like => vector(a.x - b.x, a.y - b.y, a.z - b.z);
const scale = (source: Vector3Like, scalar: number): Vector3Like => vector(source.x * scalar, source.y * scalar, source.z * scalar);
const dot = (a: Vector3Like, b: Vector3Like) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vector3Like, b: Vector3Like): Vector3Like => vector(
  a.y * b.z - a.z * b.y,
  a.z * b.x - a.x * b.z,
  a.x * b.y - a.y * b.x,
);
const lengthSquared = (source: Vector3Like) => dot(source, source);
const length = (source: Vector3Like) => Math.sqrt(lengthSquared(source));
const distance = (a: Vector3Like, b: Vector3Like) => length(subtract(a, b));
const normalize = (source: Vector3Like, fallback: Vector3Like = vector()): Vector3Like => {
  const magnitude = length(source);
  return magnitude > EPSILON ? scale(source, 1 / magnitude) : copy(fallback);
};
const reject = (source: Vector3Like, normal: Vector3Like): Vector3Like => subtract(source, scale(normal, dot(source, normal)));
const horizontal = (source: Vector3Like): Vector3Like => vector(source.x, 0, source.z);
const lerpVector = (a: Vector3Like, b: Vector3Like, t: number): Vector3Like => vector(
  a.x + (b.x - a.x) * t,
  a.y + (b.y - a.y) * t,
  a.z + (b.z - a.z) * t,
);
const dampAngle = (from: number, to: number, lambda: number, delta: number) => {
  const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + difference * (1 - Math.exp(-lambda * delta));
};

interface SegmentHit { time: number; normal: Vector3Like }

/** Slab sweep, shared by body movement and actual web visibility. */
function segmentBoxHit(origin: Vector3Like, displacement: Vector3Like, minimum: Vector3Like, maximum: Vector3Like): SegmentHit | null {
  let enter = -Infinity;
  let exit = Infinity;
  let normal = vector();
  for (const axis of ['x', 'y', 'z'] as const) {
    const movement = displacement[axis];
    if (Math.abs(movement) < EPSILON) {
      // Being exactly on a face does not block motion tangent to that face.
      if (origin[axis] <= minimum[axis] + EPSILON || origin[axis] >= maximum[axis] - EPSILON) return null;
      continue;
    }
    const first = (minimum[axis] - origin[axis]) / movement;
    const second = (maximum[axis] - origin[axis]) / movement;
    const near = Math.min(first, second);
    const far = Math.max(first, second);
    if (near > enter) {
      enter = near;
      normal = vector();
      normal[axis] = movement > 0 ? -1 : 1;
    }
    exit = Math.min(exit, far);
    if (enter > exit) return null;
  }
  if (exit < 0 || enter > 1 || enter < -EPSILON && exit < EPSILON) return null;
  return { time: Math.max(0, enter), normal };
}

/** An anchor on the first surface is allowed; geometry before it is not. */
export function traversalLineOfSight(
  origin: Vector3Like,
  target: Vector3Like,
  colliders: readonly TraversalAabb[],
  endpointAllowance = 0.08,
): boolean {
  const displacement = subtract(target, origin);
  const range = length(displacement);
  if (range < EPSILON) return false;
  const lastVisibleTime = 1 - Math.min(0.02, Math.max(0, endpointAllowance) / range);
  return !colliders.some((box) => {
    const hit = segmentBoxHit(origin, displacement, box.min, box.max);
    return hit !== null && hit.time < lastVisibleTime;
  });
}

function mergeConfig(overrides?: Partial<TraversalConfig>): TraversalConfig {
  return { ...DEFAULT_TRAVERSAL_CONFIG, ...overrides };
}

function cloneState(state: TraversalState): TraversalState {
  return {
    ...state,
    position: copy(state.position),
    velocity: copy(state.velocity),
    swing: state.swing ? { ...state.swing, anchor: copy(state.swing.anchor) } : null,
    zip: state.zip ? { ...state.zip, target: copy(state.zip.target) } : null,
    wall: state.wall ? { ...state.wall, point: copy(state.wall.point), normal: copy(state.wall.normal) } : null,
    mantle: state.mantle ? { ...state.mantle, target: copy(state.mantle.target) } : null,
  };
}

export function createTraversalState(position: Vector3Like = vector(), velocity: Vector3Like = vector()): TraversalState {
  return {
    position: copy(position),
    velocity: copy(velocity),
    grounded: false,
    mode: 'fall',
    swing: null,
    zip: null,
    wall: null,
    elapsed: 0,
    airSeconds: 0,
    coyoteSeconds: 0,
    jumpBufferSeconds: 0,
    landingSeconds: 0,
    pointLaunchSeconds: 0,
    wallJumpSeconds: 0,
    perchSeconds: 0,
    heading: 0,
    wallCrawlActive: false,
    mantle: null,
  };
}

/** Converts a THREE.Vector3 (or any structural equivalent) into owned state data. */
export function setTraversalKinematics(state: TraversalState, position: Vector3Like, velocity: Vector3Like): void {
  state.position.x = position.x;
  state.position.y = position.y;
  state.position.z = position.z;
  state.velocity.x = velocity.x;
  state.velocity.y = velocity.y;
  state.velocity.z = velocity.z;
}

/** Copies physics state back into THREE.Vector3-compatible mutable targets. */
export function copyTraversalKinematics(
  state: TraversalState,
  positionTarget: Vector3Like,
  velocityTarget: Vector3Like,
): void {
  positionTarget.x = state.position.x;
  positionTarget.y = state.position.y;
  positionTarget.z = state.position.z;
  velocityTarget.x = state.velocity.x;
  velocityTarget.y = state.velocity.y;
  velocityTarget.z = state.velocity.z;
}

export function selectTraversalAnchor(
  origin: Vector3Like,
  aimDirection: Vector3Like,
  candidates: readonly WebAnchorCandidate[],
  config: Pick<TraversalConfig, 'anchorMinimumDistance' | 'anchorMaximumDistance' | 'anchorMinimumHeight'> = DEFAULT_TRAVERSAL_CONFIG,
): WebAnchorCandidate | null {
  const aim = normalize(aimDirection, vector(0, 0.35, -1));
  let winner: WebAnchorCandidate | null = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    if (candidate.lineOfSight === false) continue;
    const offset = subtract(candidate.point, origin);
    const range = length(offset);
    if (range < config.anchorMinimumDistance || range > config.anchorMaximumDistance) continue;
    if (offset.y < config.anchorMinimumHeight) continue;
    const direction = scale(offset, 1 / Math.max(range, EPSILON));
    const alignment = dot(aim, direction);
    const heightBenefit = saturate(offset.y / 28);
    const rangeBenefit = 1 - Math.abs(range - 34) / config.anchorMaximumDistance;
    const surfaceBenefit = candidate.kind === 'facade' || candidate.kind === 'ledge'
      ? 0.14
      : candidate.kind === 'roof' || candidate.kind === 'perch' ? 0.12 : 0;
    const score = (alignment * 2.8 + heightBenefit * 0.58 + rangeBenefit * 0.35 + surfaceBenefit)
      * Math.max(0.05, candidate.weight ?? 1);
    if (score > bestScore) {
      winner = candidate;
      bestScore = score;
    }
  }
  return winner;
}

function chooseSwingAnchor(
  state: TraversalState,
  input: TraversalInput,
  environment: TraversalEnvironment,
  config: TraversalConfig,
): WebAnchorCandidate | null {
  const fallbackDirection = input.cameraForward ?? input.move ?? vector(0, 0, -1);
  const aim = input.aimDirection ?? normalize(add(fallbackDirection, vector(0, 0.5, 0)));
  const colliders = environment.anchorColliders ?? environment.colliders ?? [];
  const candidates = (environment.anchorCandidates ?? []).filter((candidate) =>
    candidate.lineOfSight !== false && traversalLineOfSight(state.position, candidate.point, colliders));
  return selectTraversalAnchor(state.position, aim, candidates, {
    ...config, anchorMaximumDistance: Math.min(config.anchorMaximumDistance, config.swingMaximumLength),
  });
}

function chooseZipTarget(
  state: TraversalState,
  input: TraversalInput,
  environment: TraversalEnvironment,
  config: TraversalConfig,
): WebAnchorCandidate | null {
  const colliders = environment.anchorColliders ?? environment.colliders ?? [];
  const candidates = (environment.zipTargets ?? environment.anchorCandidates ?? []).filter((candidate) =>
    candidate.lineOfSight !== false && traversalLineOfSight(state.position, candidate.point, colliders));
  const aim = input.aimDirection ?? input.cameraForward ?? input.move ?? vector(0, 0.1, -1);
  return selectTraversalAnchor(
    state.position,
    aim,
    candidates,
    { ...config, anchorMinimumHeight: -config.anchorMaximumDistance },
  );
}

function event(type: TraversalEventType, state: TraversalState, details: Partial<TraversalEvent> = {}): TraversalEvent {
  return { type, position: copy(state.position), ...details };
}

function attachSwing(
  state: TraversalState,
  anchor: WebAnchorCandidate,
  input: TraversalInput,
  config: TraversalConfig,
  events: TraversalEvent[],
): void {
  const initialLength = clamp(distance(state.position, anchor.point), config.swingMinimumLength, config.swingMaximumLength);
  state.swing = {
    anchor: copy(anchor.point),
    anchorId: anchor.id,
    ropeLength: initialLength,
    maximumLength: initialLength,
    attachedSeconds: 0,
    tension: 0,
    pressure: 0,
  };
  state.zip = null;
  state.wallCrawlActive = false;
  state.mantle = null;
  state.perchSeconds = 0;
  if (state.grounded && state.elapsed >= (state.swingGroundLaunchAfter ?? 0)) {
    state.swing.launchRopeLength = clamp(anchor.point.y - state.position.y - 3,
      Math.max(config.swingMinimumLength, initialLength * .56), initialLength);
    const direction = normalize(horizontal(input.move ?? vector()),
      normalize(horizontal(input.cameraForward ?? state.velocity), vector(0, 0, -1)));
    const minimumForwardSpeed = config.runSpeed * .85;
    if (length(horizontal(state.velocity)) < minimumForwardSpeed) {
      const push = Math.min(minimumForwardSpeed, Math.max(0, minimumForwardSpeed - dot(state.velocity, direction)));
      state.velocity = add(state.velocity, scale(direction, push));
    }
    state.velocity.y = Math.max(state.velocity.y, config.jumpSpeed * 1.35);
    state.grounded = false;
    state.coyoteSeconds = 0;
    state.jumpBufferSeconds = 0;
    state.landingSeconds = 0;
    state.swingGroundLaunchAfter = state.elapsed + 1.1;
    events.push(event('jump', state, { strength: state.velocity.y }));
  }
  events.push(event('web-attached', state, { anchorId: anchor.id }));
}

function releaseSwing(
  state: TraversalState,
  input: TraversalInput,
  config: TraversalConfig,
  events: TraversalEvent[],
): void {
  const swing = state.swing;
  if (!swing) return;
  const radial = normalize(subtract(state.position, swing.anchor), vector(0, -1, 0));
  const tangentVelocity = reject(state.velocity, radial);
  const cameraForward = normalize(horizontal(input.cameraForward ?? input.move ?? tangentVelocity), vector(0, 0, -1));
  const motionDirection = normalize(tangentVelocity, cameraForward);
  // Timing earns assistance; rapid attach/release taps never manufacture lift.
  const charge = saturate((swing.attachedSeconds - 0.16) / 0.64);
  const motionSpeed = length(tangentVelocity);
  const loadedArc = saturate(swing.tension * 1.7 + saturate(motionSpeed / 42) * .35);
  const assistance = charge * (.25 + loadedArc * .75) * (.5 + saturate(motionSpeed / 34) * .5);
  const forwardAgreement = saturate(dot(motionDirection, cameraForward) * 0.5 + 0.5);
  const upwardArc = saturate(tangentVelocity.y / 16);
  state.velocity = add(state.velocity, scale(normalize(lerpVector(motionDirection, cameraForward, 0.12)), config.swingReleaseBoost * assistance * (0.4 + upwardArc * 0.6) * (0.72 + forwardAgreement * 0.28)));
  state.velocity.y += config.swingReleaseLift * assistance * upwardArc;
  state.swingReleaseSeconds = .32 * assistance;
  const releasedStrength = swing.tension;
  const releasedAnchor = swing.anchorId;
  state.swing = null;
  events.push(event('web-released', state, { anchorId: releasedAnchor, strength: releasedStrength }));
}

function startZip(state: TraversalState, target: WebAnchorCandidate, config: TraversalConfig, events: TraversalEvent[]): void {
  const normal = target.normal ? normalize(target.normal) : vector();
  const endpoint = add(target.point, scale(normal, Math.abs(normal.y) < .45 ? config.playerRadius + .04 : .015));
  state.zip = {
    target: endpoint,
    surfacePoint: copy(target.point),
    direction: normalize(subtract(endpoint, state.position)),
    bestRemaining: distance(state.position, endpoint),
    stalledSeconds: 0,
    targetId: target.id,
    elapsed: 0,
    startingDistance: distance(state.position, target.point),
    targetKind: target.kind,
  };
  state.swing = null;
  state.swingNeedsRelease = true;
  state.wallCrawlActive = false;
  state.mantle = null;
  state.perchSeconds = 0;
  if (target.point.y > state.position.y + 1) {
    // A ground-fired web zip needs a decisive break from the pavement. Without
    // this launch, gravity can cancel the vertical component of a shallow aim
    // and make a grapple look like horizontal skating.
    state.velocity.y = Math.max(state.velocity.y, 6.5);
    state.grounded = false;
  }
  events.push(event('zip-started', state, { anchorId: target.id }));
}

function pointLaunch(
  state: TraversalState,
  input: TraversalInput,
  config: TraversalConfig,
  events: TraversalEvent[],
): void {
  const zip = state.zip;
  if (!zip) return;
  const incoming = normalize(horizontal(state.velocity), normalize(horizontal(input.cameraForward ?? input.move ?? vector(0, 0, -1))));
  const targetDirection = normalize(horizontal(subtract(zip.target, state.position)), incoming);
  const direction = normalize(lerpVector(incoming, targetDirection, 0.3), incoming);
  const inherited = Math.min(length(horizontal(state.velocity)) * 0.55, 18);
  state.velocity = add(scale(direction, config.pointLaunchSpeed + inherited), vector(0, config.pointLaunchLift, 0));
  state.zip = null;
  state.pointLaunchSeconds = 0.32;
  state.grounded = false;
  events.push(event('point-launch', state, { anchorId: zip.targetId, strength: length(state.velocity) }));
}

function applyGroundMovement(state: TraversalState, move: Vector3Like, config: TraversalConfig, delta: number): void {
  const desired = scale(normalize(horizontal(move)), config.runSpeed);
  const rate = lengthSquared(horizontal(move)) > EPSILON ? config.groundAcceleration : config.groundFriction;
  state.velocity.x = damp(state.velocity.x, desired.x, rate / Math.max(config.runSpeed, 1), delta);
  state.velocity.z = damp(state.velocity.z, desired.z, rate / Math.max(config.runSpeed, 1), delta);
}

function applyAirMovement(state: TraversalState, move: Vector3Like, config: TraversalConfig, delta: number): void {
  const direction = normalize(horizontal(move));
  state.velocity.x += direction.x * config.airAcceleration * delta;
  state.velocity.z += direction.z * config.airAcceleration * delta;
  const horizontalVelocity = horizontal(state.velocity);
  const speed = length(horizontalVelocity);
  if (speed > config.maximumSpeed) {
    const limited = scale(horizontalVelocity, config.maximumSpeed / speed);
    state.velocity.x = limited.x;
    state.velocity.z = limited.z;
  }
}

function applySwing(
  state: TraversalState,
  input: TraversalInput,
  environment: TraversalEnvironment,
  config: TraversalConfig,
  delta: number,
): void {
  const swing = state.swing;
  if (!swing) return;
  swing.attachedSeconds += delta;
  const explicitPressure = input.pointerPressure;
  const holdCharge = saturate(swing.attachedSeconds / 1.2);
  const keyboardPressure = .45 + holdCharge * .55;
  swing.pressure = damp(swing.pressure, saturate(explicitPressure ?? keyboardPressure), 10, delta);
  const reelInput = clamp(value(input.reel), -1, 1);
  const pressureReel = saturate((swing.pressure - 0.18) / 0.82);
  const holdTargetLength = clamp(
    swing.maximumLength * (1 - holdCharge * (.08 + pressureReel * .1)),
    config.swingMinimumLength,
    config.swingMaximumLength,
  );
  const targetLength = Math.min(holdTargetLength, swing.launchRopeLength ?? Infinity);
  let lengthVelocity = reelInput !== 0 ? reelInput * config.swingReelSpeed
    : swing.ropeLength > targetLength ? -config.swingReelSpeed * (.25 + pressureReel * .35) : 0;
  if (swing.launchRopeLength !== undefined && swing.ropeLength > swing.launchRopeLength && reelInput <= 0) {
    lengthVelocity = -Math.max(-Math.min(0, lengthVelocity),
      Math.min(config.swingReelSpeed * 2, (swing.ropeLength - swing.launchRopeLength) / .18));
  }
  // Sustained input gathers the arc, but cannot winch all the way into the
  // attachment surface. The collider still wins against every rope correction.
  const minimumLength = Math.max(config.swingMinimumLength, swing.maximumLength * .56);
  const previousLength = swing.ropeLength;
  swing.ropeLength = clamp(swing.ropeLength + lengthVelocity * delta, minimumLength, swing.maximumLength);
  const actualLengthVelocity = (swing.ropeLength - previousLength) / delta;

  const fromAnchor = subtract(state.position, swing.anchor);
  const range = Math.max(length(fromAnchor), EPSILON);
  const radial = scale(fromAnchor, 1 / range);
  const radialSpeed = dot(state.velocity, radial);
  const stretch = Math.max(0, range - swing.ropeLength);
  const taut = range >= swing.ropeLength - .12;
  const springAcceleration = stretch * config.swingSpring
    + (taut ? Math.max(0, radialSpeed - Math.min(0, actualLengthVelocity)) * config.swingDamping : 0);
  state.velocity = add(state.velocity, scale(radial, -springAcceleration * delta));

  const explicitMove = horizontal(input.move ?? vector());
  const moveDirection = normalize(explicitMove,
    normalize(horizontal(input.cameraForward ?? state.velocity), vector(0, 0, -1)));
  const tangentInput = normalize(reject(moveDirection, radial));
  const naturalTangent = normalize(reject(state.velocity, radial), tangentInput);
  const inputStrength = lengthSquared(explicitMove) > EPSILON ? saturate(length(explicitMove)) : .72;
  const inputAgreement = Math.max(0, dot(tangentInput, naturalTangent));
  const bottomOfArc = saturate(-radial.y);
  const speedHeadroom = saturate(1 - length(state.velocity) / config.maximumSpeed);
  const pumping = config.swingPumpAcceleration * (.18 + inputStrength * inputAgreement * .82)
    * (.45 + bottomOfArc * .55) * (.62 + swing.pressure * .38) * (.65 + holdCharge * .35) * speedHeadroom;
  state.velocity = add(state.velocity, scale(naturalTangent, pumping * delta));
  state.velocity = add(state.velocity, scale(tangentInput, config.swingSteerAcceleration * inputStrength * speedHeadroom * delta));
  state.velocity.y -= config.gravity * delta;
  applyLowSwingGroundAssistance(state, input, environment, config, delta);
  swing.tension = saturate((springAcceleration + lengthSquared(reject(state.velocity, radial)) / Math.max(swing.ropeLength, 1)) / 70);
}

/**
 * Small predictive descent brake, inspired by assisted traversal rather than a
 * claim about Insomniac's proprietary solver. It only spends downward kinetic
 * energy: never moves the body, reverses a fall, or substitutes for collision.
 */
function applyLowSwingGroundAssistance(
  state: TraversalState,
  input: TraversalInput,
  environment: TraversalEnvironment,
  config: TraversalConfig,
  delta: number,
): void {
  const swing = state.swing;
  if (!swing || !environment.sampleGround || input.diveHeld || state.velocity.y >= -.25
    || swing.attachedSeconds < .08 || config.gravity <= 0) return;
  const usedImpulse = swing.groundAssistImpulse ?? 0;
  const remainingImpulse = Math.max(0, 4 - usedImpulse);
  if (remainingImpulse <= EPSILON) return;
  const lookAheadSeconds = .3;
  const maximumDrop = 8;
  const probe = vector(
    state.position.x + state.velocity.x * lookAheadSeconds,
    state.position.y,
    state.position.z + state.velocity.z * lookAheadSeconds,
  );
  const ground = environment.sampleGround(probe, .2, maximumDrop);
  if (ground === null || !Number.isFinite(ground) || ground < probe.y - maximumDrop
    || ground > probe.y + .2 || state.position.y <= ground + .05) return;
  const predictedFootY = state.position.y + state.velocity.y * lookAheadSeconds
    - .5 * config.gravity * lookAheadSeconds * lookAheadSeconds;
  const desiredClearance = Math.max(.65, config.playerRadius * 1.65);
  const risk = saturate((ground + desiredClearance - predictedFootY) / 2.5);
  const maximumAcceleration = Math.min(24, config.gravity * .8);
  const impulse = Math.min(maximumAcceleration * risk * delta, remainingImpulse, -state.velocity.y);
  state.velocity.y += impulse;
  swing.groundAssistImpulse = usedImpulse + impulse;
}

function enforceRopeConstraint(
  state: TraversalState,
  environment: TraversalEnvironment,
  config: TraversalConfig,
  events: TraversalEvent[],
): MotionResolution | null {
  const swing = state.swing;
  if (!swing) return null;
  const offset = subtract(state.position, swing.anchor);
  const range = length(offset);
  const occluded = !traversalLineOfSight(state.position, swing.anchor, environment.anchorColliders ?? environment.colliders ?? []);
  if (occluded) {
    state.swing = null;
    state.swingRetryAfter = state.elapsed + .2;
    events.push(event('web-released', state, { anchorId: swing.anchorId, strength: 0 }));
    return null;
  }
  if (range <= swing.ropeLength || range < EPSILON) return null;
  const radial = scale(offset, 1 / range);
  const desired = add(swing.anchor, scale(radial, swing.ropeLength));
  // Rope shortening is movement too: sweep it through the exact same solids.
  const collision = resolveMotion(state, environment, config, 0, subtract(desired, state.position));
  if (distance(state.position, desired) > .025) {
    state.swing = null;
    state.swingRetryAfter = state.elapsed + .2;
    events.push(event('web-released', state, { anchorId: swing.anchorId, strength: 0 }));
    return collision;
  }
  const outwardSpeed = dot(state.velocity, radial);
  if (outwardSpeed > 0) state.velocity = subtract(state.velocity, scale(radial, outwardSpeed));
  return collision;
}

function applyZip(
  state: TraversalState,
  input: TraversalInput,
  config: TraversalConfig,
  delta: number,
  events: TraversalEvent[],
): void {
  const zip = state.zip;
  if (!zip) return;
  zip.elapsed += delta;
  const offset = subtract(zip.target, state.position);
  const remaining = length(offset);
  if (input.jumpPressed && remaining <= config.pointLaunchWindow) {
    pointLaunch(state, input, config, events);
    return;
  }
  const direction = normalize(offset);
  const closing = remaining < (zip.bestRemaining ?? Infinity) - .015;
  zip.stalledSeconds = closing ? 0 : (zip.stalledSeconds ?? 0) + delta;
  zip.bestRemaining = Math.min(zip.bestRemaining ?? remaining, remaining);
  const passedTarget = zip.direction && dot(offset, zip.direction) <= 0;
  if (remaining < .7 || passedTarget || (zip.elapsed > .25 && zip.stalledSeconds > .22)
    || zip.elapsed > Math.min(3.2, zip.startingDistance / config.zipMaximumSpeed + 1.3)) {
    // One pull, one completion. Never turn back toward an overshot endpoint.
    state.zip = null;
    if (remaining < 1) state.velocity = scale(state.velocity, Math.min(1, 14 / Math.max(1, length(state.velocity))));
    events.push(event('zip-cancelled', state, { anchorId: zip.targetId }));
    return;
  }
  const alongSpeed = dot(state.velocity, direction);
  const desiredSpeed = Math.min(config.zipMaximumSpeed, Math.sqrt(2 * config.zipAcceleration * Math.max(remaining - .3, 0)));
  const acceleration = clamp((desiredSpeed - alongSpeed) * config.zipDamping, -config.zipAcceleration, config.zipAcceleration);
  const lateralVelocity = reject(state.velocity, direction);
  state.velocity = add(scale(lateralVelocity, Math.exp(-config.zipDamping * delta)), scale(direction, alongSpeed + acceleration * delta));
  const closingSpeed = dot(state.velocity, direction);
  const stoppingSpeed = Math.max(0, (remaining - .35) / Math.max(delta, .001));
  if (closingSpeed > stoppingSpeed) state.velocity = subtract(state.velocity, scale(direction, closingSpeed - stoppingSpeed));
  const speed = length(state.velocity);
  if (speed > config.zipMaximumSpeed) state.velocity = scale(state.velocity, config.zipMaximumSpeed / speed);
  state.velocity.y -= config.gravity * 0.22 * delta;
  if (zip.elapsed > 4) {
    state.zip = null;
    events.push(event('zip-cancelled', state, { anchorId: zip.targetId }));
  }
}

function updateWallFromContact(
  state: TraversalState,
  contact: SurfaceContact | null,
  config: TraversalConfig,
  delta: number,
  events: TraversalEvent[],
): void {
  if (contact && Math.abs(contact.normal.y) < 0.45) {
    const normal = normalize(horizontal(contact.normal));
    const feetTouching = contact.feetTouching === true;
    const wasTouching = Boolean(state.wall);
    if (state.wall) {
      state.wall.normal = normalize(lerpVector(state.wall.normal, normal, saturate(delta * 16)), normal);
      state.wall.point = copy(contact.point);
      state.wall.colliderId = contact.colliderId;
      state.wall.feetTouching = feetTouching;
      state.wall.contactSeconds += delta;
      state.wall.graceSeconds = config.wallContactGrace;
    } else {
      state.wall = {
        point: copy(contact.point),
        normal,
        colliderId: contact.colliderId,
        feetTouching,
        contactSeconds: 0,
        graceSeconds: config.wallContactGrace,
      };
    }
    if (!wasTouching) events.push(event('wall-contact', state, { colliderId: contact.colliderId }));
  } else if (state.wall) {
    // Wall-run grace smooths a missed collision frame, but crawl must end as
    // soon as the lower foot probe is no longer touching real geometry.
    state.wall.feetTouching = false;
    state.wall.graceSeconds -= delta;
    if (state.wall.graceSeconds <= 0) state.wall = null;
  }
}

function applyWallTraversal(
  state: TraversalState,
  input: TraversalInput,
  config: TraversalConfig,
  delta: number,
): void {
  const wall = state.wall;
  if (!wall || !wall.feetTouching || !state.wallCrawlActive || state.swing || state.zip || state.mantle) return;
  if (state.grounded) {
    // Q at the base of a facade should flow directly from pavement to wall
    // traversal instead of requiring an awkward jump before the wall sticks.
    state.grounded = false;
    state.velocity.y = Math.max(state.velocity.y, 1.2);
  }
  const normal = normalize(horizontal(wall.normal));
  const inwardSpeed = dot(state.velocity, normal);
  if (inwardSpeed < 0) state.velocity = subtract(state.velocity, scale(normal, inwardSpeed));
  state.velocity = add(state.velocity, scale(normal, -config.wallStickAcceleration * delta));

  const tangent = normalize(cross(UP, normal), vector(1, 0, 0));
  const strafe = clamp(value(input.wallStrafe), -1, 1);
  const climb = clamp(value(input.wallClimb), -1, 1);
  const desiredDirection = add(scale(tangent, strafe), vector(0, climb, 0));
  const desired = scale(normalize(desiredDirection), config.wallCrawlSpeed * Math.min(1, length(desiredDirection)));
  state.velocity = lerpVector(state.velocity, desired, 1 - Math.exp(-12 * delta));
}

function applyMantle(state: TraversalState, config: TraversalConfig, delta: number) {
  const mantle = state.mantle;
  if (!mantle) return;
  mantle.elapsed += delta;
  if (mantle.elapsed > 1.5) { state.mantle = null; return; }
  const offset = subtract(mantle.target, state.position);
  // Rise completely above the rim before crossing it. Both segments are swept
  // by the same world collision controller as ordinary locomotion.
  const movement = offset.y > .035 ? vector(0, offset.y, 0) : offset;
  state.velocity = scale(normalize(movement), Math.min(config.wallMantleSpeed, length(movement) / Math.max(.001, delta)));
  state.grounded = false;
}

interface MotionResolution {
  wall: SurfaceContact | null;
  grounded: boolean;
  landed: boolean;
  blocked: boolean;
}

/**
 * Continuous swept upright capsule approximation against AABBs. Incoming
 * normal velocity is removed rather than reflected, so wall impact sticks or
 * slides and never produces the artificial "bounce" of a restitution response.
 */
function resolveMotion(
  state: TraversalState,
  environment: TraversalEnvironment,
  config: TraversalConfig,
  delta: number,
  displacementOverride?: Vector3Like,
): MotionResolution {
  const colliders = environment.colliders ?? [];
  const displacement = displacementOverride ?? scale(state.velocity, delta);
  const skin = .001;
  const bodyMinimum = (box: TraversalAabb) => vector(box.min.x - config.playerRadius, box.min.y - config.playerHeight, box.min.z - config.playerRadius);
  const bodyMaximum = (box: TraversalAabb) => vector(box.max.x + config.playerRadius, box.max.y, box.max.z + config.playerRadius);
  const inside = (position: Vector3Like, box: TraversalAabb) => {
    const min = bodyMinimum(box);
    const max = bodyMaximum(box);
    return position.x > min.x + EPSILON && position.x < max.x - EPSILON
      && position.y > min.y + EPSILON && position.y < max.y - EPSILON
      && position.z > min.z + EPSILON && position.z < max.z - EPSILON;
  };
  let grounded = false;
  let landed = false;
  let blocked = false;
  let wall: SurfaceContact | null = null;
  const registerContact = (normal: Vector3Like, box?: TraversalAabb) => {
    blocked = true;
    const normalSpeed = dot(state.velocity, normal);
    if (normal.y > .5) {
      grounded = true;
      landed ||= !state.grounded && state.velocity.y < -2;
    } else if (Math.abs(normal.y) < .45 && box) {
      const footTop = state.position.y + Math.min(config.playerHeight * .28, .55);
      wall = { point: copy(state.position), normal, colliderId: box.id,
        feetTouching: footTop > box.min.y - .04 && state.position.y < box.max.y + .04 };
    }
    if (normalSpeed < 0) state.velocity = subtract(state.velocity, scale(normal, normalSpeed));
  };

  // Repair bad spawn/stream-in data once, using all six faces (not just walls).
  // Normal gameplay uses the sweep below and should never need this recovery.
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const box = colliders.find((candidate) => inside(state.position, candidate));
    if (!box) break;
    const min = bodyMinimum(box);
    const max = bodyMaximum(box);
    let depth = Infinity;
    let normal = vector();
    for (const axis of ['x', 'y', 'z'] as const) {
      const low = state.position[axis] - min[axis];
      const high = max[axis] - state.position[axis];
      if (low < depth) { depth = low; normal = vector(); normal[axis] = -1; }
      if (high < depth) { depth = high; normal = vector(); normal[axis] = 1; }
    }
    state.position = add(state.position, scale(normal, depth + skin));
    registerContact(normal, box);
  }
  if (colliders.some((box) => inside(state.position, box))) {
    // Overlapping solids can alternate opposite minimum translations forever.
    // Rare invalid-start fallback: choose the nearest of six exits from the
    // entire nearby union. Each candidate is provably outside every AABB.
    const minimum = vector(Infinity, Infinity, Infinity);
    const maximum = vector(-Infinity, -Infinity, -Infinity);
    for (const box of colliders) {
      const min = bodyMinimum(box);
      const max = bodyMaximum(box);
      for (const axis of ['x', 'y', 'z'] as const) {
        minimum[axis] = Math.min(minimum[axis], min[axis]);
        maximum[axis] = Math.max(maximum[axis], max[axis]);
      }
    }
    let nearest: { point: Vector3Like; normal: Vector3Like; distance: number } | null = null;
    for (const axis of ['x', 'y', 'z'] as const) {
      for (const side of [-1, 1]) {
        const point = copy(state.position);
        point[axis] = side < 0 ? minimum[axis] - skin : maximum[axis] + skin;
        if (axis === 'y' && side < 0 && point.y < (environment.groundY ?? 0)) continue;
        const separation = distance(state.position, point);
        if (!nearest || separation < nearest.distance) {
          const normal = vector(); normal[axis] = side;
          nearest = { point, normal, distance: separation };
        }
      }
    }
    if (nearest) {
      state.position = nearest.point;
      registerContact(nearest.normal);
    }
  }

  // Continuous slab tests cannot tunnel, even when a wall is thinner than a
  // substep. Mesh ground sampling benefits from short horizontal probe steps.
  const segments = environment.sampleGround
    ? clamp(Math.ceil(length(displacement) / Math.max(config.collisionStep, .1)), 1, 128) : 1;
  let remaining = copy(displacement);
  for (let segment = 0; segment < segments; segment += 1) {
    const previous = copy(state.position);
    let movement = scale(remaining, 1 / (segments - segment));
    remaining = subtract(remaining, movement);
    for (let slide = 0; slide < 5 && lengthSquared(movement) > EPSILON * EPSILON; slide += 1) {
      let first: (SegmentHit & { box: TraversalAabb }) | null = null;
      for (const box of colliders) {
        const hit = segmentBoxHit(state.position, movement, bodyMinimum(box), bodyMaximum(box));
        if (hit && (!first || hit.time < first.time)) first = { ...hit, box };
      }
      if (!first) { state.position = add(state.position, movement); break; }
      state.position = add(state.position, scale(movement, first.time));
      state.position = add(state.position, scale(first.normal, skin));
      registerContact(first.normal, first.box);
      movement = scale(movement, 1 - first.time);
      if (dot(movement, first.normal) < 0) movement = reject(movement, first.normal);
      if (dot(remaining, first.normal) < 0) remaining = reject(remaining, first.normal);
    }
    const stepUp = state.grounded && !state.swing && !state.zip ? .4 : .025;
    const probe = vector(state.position.x, Math.max(previous.y, state.position.y), state.position.z);
    const groundY = environment.sampleGround ? environment.sampleGround(probe, stepUp) : environment.groundY ?? 0;
    if (groundY !== null && Number.isFinite(groundY)) {
      const followingGround = state.grounded && !state.swing && !state.zip && state.velocity.y <= 0
        && groundY >= previous.y - .4 && groundY <= previous.y + stepUp;
      if (state.position.y <= groundY || followingGround) {
        state.position.y = groundY;
        registerContact(UP);
        if (remaining.y < 0) remaining.y = 0;
      }
    }
  }
  // Stable support for stationary feet, with no accumulating hover offset.
  if (state.velocity.y <= 0) {
    for (const box of colliders) {
      if (Math.abs(state.position.y - box.max.y) <= skin * 2
        && state.position.x > box.min.x - config.playerRadius && state.position.x < box.max.x + config.playerRadius
        && state.position.z > box.min.z - config.playerRadius && state.position.z < box.max.z + config.playerRadius) {
        state.position.y = box.max.y;
        grounded = true;
        state.velocity.y = 0;
      }
    }
  }
  return { wall, grounded, landed, blocked };
}

function clampVelocity(state: TraversalState, maximumSpeed: number): void {
  const speed = length(state.velocity);
  if (speed > maximumSpeed) state.velocity = scale(state.velocity, maximumSpeed / speed);
  if (!Number.isFinite(state.position.x + state.position.y + state.position.z + state.velocity.x + state.velocity.y + state.velocity.z)) {
    throw new Error('Traversal physics produced a non-finite transform');
  }
}

function createContext(state: TraversalState, input: TraversalInput, config: TraversalConfig, delta: number): TraversalContext {
  const speed = length(state.velocity);
  const horizontalSpeed = length(horizontal(state.velocity));
  const forward = normalize(horizontal(state.velocity), normalize(horizontal(input.cameraForward ?? vector(0, 0, -1))));
  const desiredYaw = state.wallCrawlActive && state.wall ? Math.atan2(state.wall.normal.x, state.wall.normal.z) : Math.atan2(-forward.x, -forward.z);
  state.heading = dampAngle(state.heading, desiredYaw, state.grounded ? 14 : 7, delta);
  const cameraForward = normalize(horizontal(input.cameraForward ?? forward), forward);
  const lateral = dot(cross(cameraForward, forward), UP);
  const tension = state.swing?.tension ?? 0;
  const wallBlend = state.wall && (state.mode === 'wallRun' || state.mode === 'wallCrawl') ? 1 : 0;
  const launchBlend = saturate(Math.max(state.pointLaunchSeconds, state.swingReleaseSeconds ?? 0) / 0.32);
  const speedBlend = saturate(horizontalSpeed / config.maximumSpeed);
  const diveBlend = state.mode === 'dive' ? 1 : 0;
  const swingBlend = state.mode === 'swing' ? saturate(0.4 + tension * 0.6) : 0;
  const bodyPitch = state.mode === 'dive'
    ? -0.72
    : state.mode === 'swing'
      ? clamp(-state.velocity.y / 42, -0.55, 0.55)
      : clamp(-state.velocity.y / 58, -0.32, 0.38);
  const bodyRoll = clamp(-lateral * (0.18 + speedBlend * 0.42) + (state.wall?.normal.x ?? 0) * wallBlend * 0.3, -0.78, 0.78);
  const fov = clamp(
    config.baseFov + speedBlend * 17 + diveBlend * 5 + launchBlend * 6 + tension * 2,
    config.baseFov,
    config.maximumFov,
  );
  return {
    animation: {
      state: state.mode,
      normalizedSpeed: speedBlend,
      verticalSpeed: state.velocity.y,
      bodyYaw: state.heading,
      bodyPitch: wallBlend ? 0 : bodyPitch,
      bodyRoll: wallBlend ? 0 : bodyRoll,
      stride: saturate(horizontalSpeed / config.runSpeed),
      airborneBlend: state.grounded ? 0 : saturate(state.airSeconds * 5),
      wallBlend,
      swingBlend,
      ropeTension: tension,
    },
    camera: {
      fov,
      followDistance: 6.7 + speedBlend * 5.8 + diveBlend * 1.6,
      heightOffset: 2.35 - diveBlend * 0.85 + launchBlend * 0.45,
      roll: clamp(-lateral * speedBlend * 0.16 + bodyRoll * 0.16, -0.25, 0.25),
      shake: saturate((speedBlend - 0.38) / 0.62) * 0.16 + launchBlend * 0.1,
      lookAhead: add(scale(forward, 2.4 + speedBlend * 9), scale(UP, clamp(state.velocity.y * 0.1, -3, 4))),
      speedLines: saturate((speed - 24) / 35),
    },
    speed,
    horizontalSpeed,
    grounded: state.grounded,
    wallNormal: state.wall ? copy(state.wall.normal) : null,
    webAnchor: state.swing ? copy(state.swing.anchor) : null,
    webTension: tension,
    canPointLaunch: Boolean(state.zip && distance(state.position, state.zip.target) <= config.pointLaunchWindow),
  };
}

function updateMode(state: TraversalState, input: TraversalInput): void {
  const horizontalSpeed = length(horizontal(state.velocity));
  if (state.pointLaunchSeconds > 0) state.mode = 'pointLaunch';
  else if (state.wallJumpSeconds > 0) state.mode = 'wallJump';
  else if (state.perchSeconds > 0) state.mode = 'perch';
  else if (state.swing) state.mode = 'swing';
  else if (state.zip) state.mode = 'webZip';
  else if (state.mantle) state.mode = 'mantle';
  else if (state.wall && state.wall.feetTouching && state.wallCrawlActive) state.mode = 'wallCrawl';
  else if (state.grounded && state.landingSeconds > 0) state.mode = 'land';
  else if (state.grounded) state.mode = horizontalSpeed > 0.55 ? 'run' : 'idle';
  else if (input.diveHeld && state.velocity.y < 1) state.mode = 'dive';
  else state.mode = state.velocity.y >= -0.2 ? 'jump' : 'fall';
}

/** Rebuild presentation after an authoritative mesh controller adjusts contact. */
export function refreshTraversalContext(
  state: TraversalState,
  input: TraversalInput,
  overrides?: Partial<TraversalConfig>,
): TraversalContext {
  updateMode(state, input);
  return createContext(state, input, mergeConfig(overrides), 0);
}

/**
 * Immutable convenience entry point. Use `stepTraversalInPlace` in a hot render
 * loop to avoid cloning the state before each fixed physics tick.
 */
export function stepTraversal(
  state: TraversalState,
  input: TraversalInput,
  environment: TraversalEnvironment,
  deltaSeconds: number,
  overrides?: Partial<TraversalConfig>,
): TraversalStepResult {
  return stepTraversalInPlace(cloneState(state), input, environment, deltaSeconds, overrides);
}

/** Advances one deterministic tick and mutates `state`. Prefer a fixed timestep. */
export function stepTraversalInPlace(
  state: TraversalState,
  input: TraversalInput,
  environment: TraversalEnvironment,
  deltaSeconds: number,
  overrides?: Partial<TraversalConfig>,
): TraversalStepResult {
  const delta = clamp(value(deltaSeconds), 0, .05);
  const config = mergeConfig(overrides);
  if (delta === 0) return { state, context: createContext(state, input, config, 0), events: [] };
  const steps = Math.max(1, Math.ceil(delta / (1 / 120)));
  const events: TraversalEvent[] = [];
  let result: TraversalStepResult | null = null;
  for (let index = 0; index < steps; index += 1) {
    const tickInput = index === 0 ? input : { ...input,
      jumpPressed: false, swingPressed: false, swingReleased: false, zipPressed: false, zipReleased: false, wallCrawlPressed: false };
    result = stepTraversalTick(state, tickInput, environment, delta / steps, config);
    events.push(...result.events);
  }
  return { ...result!, events };
}

function stepTraversalTick(
  state: TraversalState,
  input: TraversalInput,
  environment: TraversalEnvironment,
  delta: number,
  config: TraversalConfig,
): TraversalStepResult {
  const events: TraversalEvent[] = [];
  const move = input.move ?? vector();
  const wasGrounded = state.grounded;
  state.elapsed += delta;
  state.coyoteSeconds = state.grounded ? config.coyoteTime : Math.max(0, state.coyoteSeconds - delta);
  state.jumpBufferSeconds = input.jumpPressed ? config.jumpBufferTime : Math.max(0, state.jumpBufferSeconds - delta);
  state.landingSeconds = Math.max(0, state.landingSeconds - delta);
  state.pointLaunchSeconds = Math.max(0, state.pointLaunchSeconds - delta);
  state.wallJumpSeconds = Math.max(0, state.wallJumpSeconds - delta);
  state.perchSeconds = Math.max(0, state.perchSeconds - delta);
  state.swingReleaseSeconds = Math.max(0, (state.swingReleaseSeconds ?? 0) - delta);

  if (environment.wallContact !== undefined) updateWallFromContact(state, environment.wallContact, config, delta, events);
  if (!input.swingHeld && !input.swingPressed) state.swingNeedsRelease = false;
  if (input.wallCrawlPressed) {
    state.wallCrawlActive = !state.wallCrawlActive && Boolean(state.wall?.feetTouching) && !state.swing && !state.zip;
    if (state.wallCrawlActive) state.velocity = vector();
  }
  if (input.jumpPressed || input.swingPressed || input.swingHeld || input.zipPressed) {
    if (input.jumpPressed && state.mantle) state.coyoteSeconds = config.coyoteTime;
    state.wallCrawlActive = false;
    state.mantle = null;
  }
  if (!state.wall?.feetTouching) state.wallCrawlActive = false;

  if ((input.swingPressed || input.swingHeld) && !input.swingReleased && !state.swing && !state.zip
    && !state.swingNeedsRelease && state.elapsed >= (state.swingRetryAfter ?? 0)) {
    const anchor = chooseSwingAnchor(state, input, environment, config);
    if (anchor) attachSwing(state, anchor, input, config, events);
  }
  if ((input.swingReleased || input.swingHeld === false) && state.swing) releaseSwing(state, input, config, events);

  if (input.zipPressed && !state.zip) {
    const target = chooseZipTarget(state, input, environment, config);
    if (target) startZip(state, target, config, events);
  }
  if ((input.zipReleased || input.zipHeld === false) && state.zip && !input.jumpPressed) {
    const targetId = state.zip.targetId;
    state.zip = null;
    events.push(event('zip-cancelled', state, { anchorId: targetId }));
  }
  if (state.zip && !traversalLineOfSight(state.position, state.zip.target, environment.anchorColliders ?? environment.colliders ?? [])) {
    events.push(event('zip-cancelled', state, { anchorId: state.zip.targetId }));
    state.zip = null;
  }

  if (state.wall && state.jumpBufferSeconds > 0 && !state.swing && !state.zip) {
    const normal = normalize(horizontal(state.wall.normal));
    const along = normalize(reject(horizontal(move), normal), normalize(horizontal(input.cameraForward ?? vector(0, 0, -1))));
    state.velocity = add(
      add(scale(normal, config.wallJumpOutSpeed), scale(along, config.wallJumpOutSpeed * 0.36)),
      vector(0, config.wallJumpUpSpeed, 0),
    );
    state.wall = null;
    state.grounded = false;
    state.jumpBufferSeconds = 0;
    state.wallJumpSeconds = 0.28;
    events.push(event('wall-jump', state, { strength: length(state.velocity) }));
  } else if (state.jumpBufferSeconds > 0 && (state.grounded || state.coyoteSeconds > 0) && !state.zip) {
    state.velocity.y = config.jumpSpeed;
    state.grounded = false;
    state.coyoteSeconds = 0;
    state.jumpBufferSeconds = 0;
    events.push(event('jump', state, { strength: config.jumpSpeed }));
  }

  if (state.perchSeconds > 0 && input.jumpPressed) {
    const direction = normalize(horizontal(input.cameraForward ?? move), vector(0, 0, -1));
    state.velocity = add(scale(direction, config.pointLaunchSpeed * 0.65), vector(0, config.pointLaunchLift * 0.82, 0));
    state.perchSeconds = 0;
    state.pointLaunchSeconds = 0.28;
    state.grounded = false;
    events.push(event('point-launch', state, { strength: length(state.velocity) }));
  }

  if (state.grounded && !state.swing && !state.zip && !state.wallCrawlActive && !state.mantle) applyGroundMovement(state, move, config, delta);
  else if (!state.swing && !state.zip && !state.wallCrawlActive && !state.mantle) applyAirMovement(state, move, config, delta);

  applyWallTraversal(state, input, config, delta);
  if (state.mantle) applyMantle(state, config, delta);
  else if (state.swing) applySwing(state, input, environment, config, delta);
  else if (state.zip) applyZip(state, input, config, delta, events);
  else if (!state.grounded && !state.wallCrawlActive) {
    const gravityMultiplier = input.diveHeld && state.velocity.y < 1 ? config.diveGravityMultiplier : 1;
    state.velocity.y -= config.gravity * gravityMultiplier * delta;
    if (input.diveHeld) {
      const diveForward = normalize(horizontal(input.cameraForward ?? move), vector(0, 0, -1));
      state.velocity = add(state.velocity, scale(diveForward, config.diveAcceleration * delta));
    }
  }

  clampVelocity(state, config.maximumSpeed);
  const incomingVerticalSpeed = state.velocity.y;
  const collision = resolveMotion(state, environment, config, delta);
  const ropeCollision = enforceRopeConstraint(state, environment, config, events);
  // Validate support after rope motion; a grounded flag from the pre-correction
  // position must not turn an airborne swing into a running animation.
  const support = resolveMotion(state, environment, config, 0);
  updateWallFromContact(state, support.wall ?? ropeCollision?.wall ?? collision.wall ?? environment.wallContact ?? null, config, delta, events);
  if (!state.wall?.feetTouching) state.wallCrawlActive = false;
  state.grounded = support.grounded;
  if (state.mantle && distance(state.position, state.mantle.target) < .09) {
    state.mantle = null;
    state.wallCrawlActive = false;
    state.velocity = vector();
    state.perchSeconds = .2;
  }
  if (state.zip) {
    const zip = state.zip;
    const remaining = distance(state.position, zip.target);
    const blockedAtTarget = collision.blocked && dot(state.velocity, normalize(subtract(zip.target, state.position))) < .2;
    if (remaining < Math.max(.45, config.playerRadius + .15) || blockedAtTarget) {
      state.zip = null;
      if (state.grounded && (zip.targetKind === 'roof' || zip.targetKind === 'perch' || zip.targetKind === 'ledge')) {
        state.velocity = vector();
        state.perchSeconds = .24;
        events.push(event('perched', state, { anchorId: zip.targetId }));
      } else {
        // Facade zips finish at capsule clearance, never teleport into a wall.
        events.push(event('zip-cancelled', state, { anchorId: zip.targetId }));
      }
    }
  }
  if (collision.landed || (!wasGrounded && state.grounded)) {
    state.landingSeconds = clamp(Math.abs(incomingVerticalSpeed) / 25 + 0.12, 0.12, 0.34);
    events.push(event('land', state, { strength: saturate(Math.abs(incomingVerticalSpeed) / 30) }));
  }
  if (state.grounded) state.airSeconds = 0;
  else state.airSeconds += delta;
  updateMode(state, input);
  return { state, context: createContext(state, input, config, delta), events };
}

export interface TraversalSelfTestResult {
  passed: boolean;
  checks: Readonly<Record<string, boolean>>;
  diagnostics: Readonly<Record<string, number>>;
}

/** Lightweight deterministic checks usable from a build script or browser console. */
export function runTraversalPhysicsSelfTests(): TraversalSelfTestResult {
  const checks: Record<string, boolean> = {};
  const diagnostics: Record<string, number> = {};
  const delta = 1 / 120;

  let swingState = createTraversalState(vector(0, 18, 0), vector(12, 0, 0));
  const anchor: WebAnchorCandidate = { id: 'test-anchor', point: vector(0, 34, -8), kind: 'facade' };
  for (let index = 0; index < 180; index += 1) {
    swingState = stepTraversal(swingState, {
      move: vector(1, 0, -0.35),
      cameraForward: vector(0, 0, -1),
      aimDirection: normalize(subtract(anchor.point, swingState.position)),
      swingHeld: true,
      pointerPressure: 0.72,
    }, { groundY: -100, anchorCandidates: [anchor] }, delta).state;
  }
  const ropeError = swingState.swing ? Math.max(0, distance(swingState.position, swingState.swing.anchor) - swingState.swing.ropeLength) : Infinity;
  diagnostics.ropeError = ropeError;
  checks.ropeConstraint = ropeError < 0.025;
  const speedBeforeRelease = length(swingState.velocity);
  const release = stepTraversal(swingState, {
    move: vector(0, 0, -1),
    cameraForward: vector(0, 0, -1),
    swingHeld: false,
    swingReleased: true,
  }, { groundY: -100 }, delta);
  diagnostics.releaseSpeedDelta = length(release.state.velocity) - speedBeforeRelease;
  checks.releaseMomentum = release.state.swing === null
    && release.events.some((item) => item.type === 'web-released')
    && length(release.state.velocity) >= speedBeforeRelease * 0.94;

  let collisionState = createTraversalState(vector(0, 0, 0), vector(40, 0, 0));
  collisionState.grounded = true;
  const wallBox: TraversalAabb = { id: 'wall', min: vector(2, 0, -4), max: vector(3, 12, 4) };
  for (let index = 0; index < 20; index += 1) {
    collisionState = stepTraversal(collisionState, { move: vector(1, 0, 0) }, { groundY: 0, colliders: [wallBox] }, 1 / 60).state;
  }
  diagnostics.wallStopX = collisionState.position.x;
  diagnostics.wallNormalVelocity = collisionState.velocity.x;
  checks.noWallBounceOrTunnel = collisionState.position.x <= wallBox.min.x - DEFAULT_TRAVERSAL_CONFIG.playerRadius + 0.001
    && collisionState.velocity.x >= -EPSILON;

  let rooftopState = createTraversalState(vector(0, 16, 0), vector(2, -18, 1));
  const rooftopBox: TraversalAabb = { id: 'rooftop', min: vector(-5, 0, -5), max: vector(5, 10, 5) };
  for (let index = 0; index < 90; index += 1) {
    rooftopState = stepTraversal(rooftopState, {}, { groundY: 0, colliders: [rooftopBox] }, delta).state;
  }
  diagnostics.rooftopLandingY = rooftopState.position.y;
  checks.solidClickableRooftop = rooftopState.grounded && Math.abs(rooftopState.position.y - rooftopBox.max.y) < .001;

  const wallJumpState = createTraversalState(vector(1.54, 3, 0), vector());
  const wallJump = stepTraversal(wallJumpState, {
    jumpPressed: true,
    move: vector(0, 0, -1),
  }, {
    groundY: 0,
    wallContact: { point: vector(2, 3, 0), normal: vector(-1, 0, 0), colliderId: 'wall' },
  }, delta);
  diagnostics.wallJumpOutwardSpeed = -wallJump.state.velocity.x;
  checks.wallJump = wallJump.events.some((item) => item.type === 'wall-jump') && wallJump.state.velocity.x < -5;

  const torsoOnlyState = createTraversalState(vector(1.54, 3, 0), vector());
  const torsoOnlyCrawl = stepTraversal(torsoOnlyState, {
    wallCrawlPressed: true,
    wallClimb: 1,
  }, {
    groundY: 0,
    wallContact: { point: vector(2, 3.9, 0), normal: vector(-1, 0, 0), colliderId: 'wall', feetTouching: false },
  }, delta);
  checks.wallCrawlRequiresFeet = torsoOnlyCrawl.state.mode !== 'wallCrawl';

  const feetContactState = createTraversalState(vector(1.54, 3, 0), vector());
  const feetCrawl = stepTraversal(feetContactState, {
    wallCrawlPressed: true,
    wallClimb: 1,
  }, {
    groundY: 0,
    wallContact: { point: vector(2, 3, 0), normal: vector(-1, 0, 0), colliderId: 'wall', feetTouching: true },
  }, delta);
  const lostFeetContact = stepTraversal(feetCrawl.state, {
    wallClimb: 1,
  }, { groundY: 0 }, delta);
  checks.wallCrawlWithFeet = feetCrawl.state.mode === 'wallCrawl';
  checks.wallCrawlStopsWithoutFeet = lostFeetContact.state.mode !== 'wallCrawl';

  const pavementToWallState = createTraversalState(vector(1.54, 0, 0), vector());
  pavementToWallState.grounded = true;
  const pavementToWallCrawl = stepTraversal(pavementToWallState, {
    move: vector(1, 0, 0),
    wallCrawlPressed: true,
    wallClimb: 1,
  }, {
    groundY: 0,
    wallContact: { point: vector(2, .1, 0), normal: vector(-1, 0, 0), colliderId: 'wall', feetTouching: true },
  }, delta);
  checks.wallCrawlTransitionsFromPavement = pavementToWallCrawl.state.mode === 'wallCrawl'
    && !pavementToWallCrawl.state.grounded
    && pavementToWallCrawl.state.velocity.y > 0;

  const incidentalWallState = createTraversalState(vector(1.54, 6, 0), vector(0, -4, -18));
  const incidentalWallContact = stepTraversal(incidentalWallState, {
    move: vector(0, 0, -1),
    wallCrawlPressed: false,
  }, {
    groundY: 0,
    wallContact: { point: vector(2, 5.9, 0), normal: vector(-1, 0, 0), colliderId: 'wall', feetTouching: true },
  }, delta);
  checks.incidentalWallContactDoesNotStick = incidentalWallContact.state.mode !== 'wallCrawl'
    && incidentalWallContact.state.mode !== 'wallRun'
    && incidentalWallContact.state.velocity.y < incidentalWallState.velocity.y;

  const zipTarget: WebAnchorCandidate = { id: 'perch', point: vector(0, 12, -12), kind: 'perch' };
  const zipState = createTraversalState(vector(0, 12, -7), vector(0, 0, -18));
  zipState.zip = { target: copy(zipTarget.point), targetId: zipTarget.id, elapsed: 0.2, startingDistance: 12 };
  const launched = stepTraversal(zipState, {
    jumpPressed: true,
    cameraForward: vector(0, 0, -1),
    zipHeld: true,
  }, { groundY: 0 }, delta);
  diagnostics.pointLaunchSpeed = length(launched.state.velocity);
  checks.pointLaunch = launched.events.some((item) => item.type === 'point-launch') && launched.state.pointLaunchSeconds > 0;

  checks.finite = [swingState, release.state, collisionState, rooftopState, wallJump.state, torsoOnlyCrawl.state, feetCrawl.state, lostFeetContact.state, pavementToWallCrawl.state, incidentalWallContact.state, launched.state].every((state) =>
    Number.isFinite(state.position.x + state.position.y + state.position.z + state.velocity.x + state.velocity.y + state.velocity.z));
  return { passed: Object.values(checks).every(Boolean), checks, diagnostics };
}
