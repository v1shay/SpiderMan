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
  wallCrawlHeld?: boolean;
  /** -1 descends a wall, +1 climbs. If omitted, forward crawl climbs gently. */
  wallClimb?: number;
  /** Trackpad/stylus pressure in [0, 1]. Keyboard input can omit it. */
  pointerPressure?: number;
  /** Explicit rope length adjustment: -1 reels in, +1 pays out. */
  reel?: number;
}

export interface TraversalEnvironment {
  groundY?: number;
  colliders?: readonly TraversalAabb[];
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
}

export interface ZipRuntime {
  target: Vector3Like;
  targetId?: string;
  elapsed: number;
  startingDistance: number;
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
  playerHeight: 1.86,
  collisionStep: 0.24,
  swingMinimumLength: 5,
  swingMaximumLength: 78,
  swingSpring: 64,
  swingDamping: 10,
  swingPumpAcceleration: 23,
  swingSteerAcceleration: 14,
  swingReelSpeed: 13,
  swingReleaseBoost: 9.5,
  swingReleaseLift: 7.2,
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
  wallCrawlSpeed: 5.2,
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
    const facadeBenefit = candidate.kind === 'facade' || candidate.kind === 'ledge' ? 0.14 : 0;
    const score = (alignment * 2.8 + heightBenefit * 0.58 + rangeBenefit * 0.35 + facadeBenefit)
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
  return selectTraversalAnchor(state.position, aim, environment.anchorCandidates ?? [], config);
}

function chooseZipTarget(
  state: TraversalState,
  input: TraversalInput,
  environment: TraversalEnvironment,
  config: TraversalConfig,
): WebAnchorCandidate | null {
  const candidates = environment.zipTargets ?? environment.anchorCandidates ?? [];
  const aim = input.aimDirection ?? input.cameraForward ?? input.move ?? vector(0, 0.1, -1);
  let selected = selectTraversalAnchor(
    state.position,
    aim,
    candidates,
    { ...config, anchorMinimumHeight: -config.anchorMaximumDistance },
  );
  if (!selected) {
    selected = candidates
      .filter((candidate) => candidate.lineOfSight !== false)
      .sort((a, b) => distance(a.point, state.position) - distance(b.point, state.position))[0] ?? null;
  }
  return selected;
}

function event(type: TraversalEventType, state: TraversalState, details: Partial<TraversalEvent> = {}): TraversalEvent {
  return { type, position: copy(state.position), ...details };
}

function attachSwing(
  state: TraversalState,
  anchor: WebAnchorCandidate,
  config: TraversalConfig,
  events: TraversalEvent[],
): void {
  const initialLength = clamp(distance(state.position, anchor.point) * 0.985, config.swingMinimumLength, config.swingMaximumLength);
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
  state.perchSeconds = 0;
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
  const assistance = 0.42 + swing.tension * 0.58;
  const forwardAgreement = saturate(dot(motionDirection, cameraForward) * 0.5 + 0.5);
  state.velocity = add(state.velocity, scale(normalize(lerpVector(motionDirection, cameraForward, 0.25)), config.swingReleaseBoost * assistance * (0.72 + forwardAgreement * 0.28)));
  const upwardArc = saturate(-radial.y) * 0.72 + saturate(tangentVelocity.y / 18) * 0.28;
  state.velocity.y += config.swingReleaseLift * (0.25 + upwardArc * 0.75);
  const releasedStrength = swing.tension;
  const releasedAnchor = swing.anchorId;
  state.swing = null;
  events.push(event('web-released', state, { anchorId: releasedAnchor, strength: releasedStrength }));
}

function startZip(state: TraversalState, target: WebAnchorCandidate, events: TraversalEvent[]): void {
  state.zip = {
    target: copy(target.point),
    targetId: target.id,
    elapsed: 0,
    startingDistance: distance(state.position, target.point),
  };
  state.swing = null;
  state.perchSeconds = 0;
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
  config: TraversalConfig,
  delta: number,
): void {
  const swing = state.swing;
  if (!swing) return;
  swing.attachedSeconds += delta;
  const explicitPressure = input.pointerPressure;
  const keyboardPressure = saturate(0.35 + swing.attachedSeconds / 1.15);
  swing.pressure = damp(swing.pressure, saturate(explicitPressure ?? keyboardPressure), 10, delta);
  const reelInput = clamp(value(input.reel), -1, 1);
  const pressureReel = saturate((swing.pressure - 0.18) / 0.82);
  const targetLength = clamp(
    swing.maximumLength * (1 - pressureReel * 0.34),
    config.swingMinimumLength,
    config.swingMaximumLength,
  );
  const lengthVelocity = reelInput * config.swingReelSpeed + (swing.ropeLength > targetLength ? -config.swingReelSpeed * pressureReel : 0);
  swing.ropeLength = clamp(swing.ropeLength + lengthVelocity * delta, config.swingMinimumLength, swing.maximumLength);

  const fromAnchor = subtract(state.position, swing.anchor);
  const range = Math.max(length(fromAnchor), EPSILON);
  const radial = scale(fromAnchor, 1 / range);
  const radialSpeed = dot(state.velocity, radial);
  const stretch = Math.max(0, range - swing.ropeLength);
  const springAcceleration = stretch * config.swingSpring + Math.max(0, radialSpeed) * config.swingDamping;
  state.velocity = add(state.velocity, scale(radial, -springAcceleration * delta));

  const moveDirection = normalize(horizontal(input.move ?? vector()));
  const tangentInput = normalize(reject(moveDirection, radial));
  const naturalTangent = normalize(reject(state.velocity, radial), tangentInput);
  const pumping = config.swingPumpAcceleration * (0.35 + swing.pressure * 0.65);
  state.velocity = add(state.velocity, scale(naturalTangent, pumping * delta));
  state.velocity = add(state.velocity, scale(tangentInput, config.swingSteerAcceleration * delta));
  state.velocity.y -= config.gravity * delta;
  swing.tension = saturate((springAcceleration + lengthSquared(reject(state.velocity, radial)) / Math.max(swing.ropeLength, 1)) / 70);
}

function enforceRopeConstraint(state: TraversalState): void {
  const swing = state.swing;
  if (!swing) return;
  const offset = subtract(state.position, swing.anchor);
  const range = length(offset);
  if (range <= swing.ropeLength || range < EPSILON) return;
  const radial = scale(offset, 1 / range);
  state.position = add(swing.anchor, scale(radial, swing.ropeLength));
  const outwardSpeed = dot(state.velocity, radial);
  if (outwardSpeed > 0) state.velocity = subtract(state.velocity, scale(radial, outwardSpeed));
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
  const alongSpeed = dot(state.velocity, direction);
  const acceleration = config.zipAcceleration - alongSpeed * config.zipDamping;
  state.velocity = add(state.velocity, scale(direction, Math.max(0, acceleration) * delta));
  const speed = length(state.velocity);
  if (speed > config.zipMaximumSpeed) state.velocity = scale(state.velocity, config.zipMaximumSpeed / speed);
  state.velocity.y -= config.gravity * 0.22 * delta;
  if (remaining < 1.15) {
    state.position = add(zip.target, vector(0, 0.12, 0));
    state.velocity = vector();
    state.zip = null;
    state.perchSeconds = 0.24;
    events.push(event('perched', state, { anchorId: zip.targetId }));
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
  if (!wall || state.swing || state.zip || state.grounded) return;
  const normal = normalize(horizontal(wall.normal));
  const inwardSpeed = dot(state.velocity, normal);
  if (inwardSpeed < 0) state.velocity = subtract(state.velocity, scale(normal, inwardSpeed));
  state.velocity = add(state.velocity, scale(normal, -config.wallStickAcceleration * delta));

  const move = input.move ?? vector();
  const alongWall = reject(horizontal(move), normal);
  const horizontalSpeed = length(horizontal(state.velocity));
  const wantsCrawl = Boolean(input.wallCrawlHeld) && wall.feetTouching;
  if (wantsCrawl) {
    const tangent = normalize(alongWall, normalize(cross(UP, normal), vector(1, 0, 0)));
    const automaticClimb = lengthSquared(horizontal(move)) > 0.04 ? 0.58 : 0;
    const climb = clamp(value(input.wallClimb, automaticClimb), -1, 1);
    const desired = add(scale(tangent, config.wallCrawlSpeed * Math.min(1, length(horizontal(move)))), vector(0, climb * config.wallCrawlSpeed, 0));
    state.velocity = lerpVector(state.velocity, desired, 1 - Math.exp(-12 * delta));
  } else {
    const fallback = normalize(cross(UP, normal), vector(1, 0, 0));
    let tangent = normalize(alongWall, reject(horizontal(state.velocity), normal));
    if (lengthSquared(tangent) < EPSILON) tangent = fallback;
    if (dot(tangent, state.velocity) < 0) tangent = scale(tangent, -1);
    const desired = scale(tangent, Math.max(config.wallRunSpeed, horizontalSpeed));
    state.velocity.x = damp(state.velocity.x, desired.x, 7, delta);
    state.velocity.z = damp(state.velocity.z, desired.z, 7, delta);
    state.velocity.y = damp(state.velocity.y, config.wallRunLift, 5.5, delta);
  }
}

interface MotionResolution {
  wall: SurfaceContact | null;
  grounded: boolean;
  landed: boolean;
}

/**
 * Swept/sub-stepped upright capsule approximation against AABBs. Incoming
 * normal velocity is removed rather than reflected, so wall impact sticks or
 * slides and never produces the artificial "bounce" of a restitution response.
 */
function resolveMotion(
  state: TraversalState,
  environment: TraversalEnvironment,
  config: TraversalConfig,
  delta: number,
): MotionResolution {
  const colliders = environment.colliders ?? [];
  const start = copy(state.position);
  const displacement = scale(state.velocity, delta);
  const steps = clamp(Math.ceil(length(displacement) / Math.max(config.collisionStep, 0.05)), 1, 64);
  const step = scale(displacement, 1 / steps);
  const groundY = environment.groundY ?? 0;
  let grounded = false;
  let landed = false;
  let wall: SurfaceContact | null = null;

  for (let iteration = 0; iteration < steps; iteration += 1) {
    const previous = copy(state.position);
    state.position = add(state.position, step);
    if (state.position.y <= groundY) {
      landed ||= !state.grounded && state.velocity.y < -2;
      state.position.y = groundY;
      state.velocity.y = Math.max(0, state.velocity.y);
      grounded = true;
    }

    for (const collider of colliders) {
      const bottom = state.position.y;
      const top = bottom + config.playerHeight;
      if (top <= collider.min.y || bottom >= collider.max.y + 0.08) continue;
      const withinX = state.position.x > collider.min.x - config.playerRadius && state.position.x < collider.max.x + config.playerRadius;
      const withinZ = state.position.z > collider.min.z - config.playerRadius && state.position.z < collider.max.z + config.playerRadius;
      if (!withinX || !withinZ) continue;

      if (previous.y >= collider.max.y - 0.04 && state.position.y <= collider.max.y + 0.1 && state.velocity.y <= 0) {
        state.position.y = collider.max.y;
        state.velocity.y = 0;
        grounded = true;
        landed ||= !state.grounded;
        continue;
      }

      const penetrations = [
        { depth: state.position.x - (collider.min.x - config.playerRadius), normal: vector(-1, 0, 0), axis: 'x' as const, value: collider.min.x - config.playerRadius },
        { depth: collider.max.x + config.playerRadius - state.position.x, normal: vector(1, 0, 0), axis: 'x' as const, value: collider.max.x + config.playerRadius },
        { depth: state.position.z - (collider.min.z - config.playerRadius), normal: vector(0, 0, -1), axis: 'z' as const, value: collider.min.z - config.playerRadius },
        { depth: collider.max.z + config.playerRadius - state.position.z, normal: vector(0, 0, 1), axis: 'z' as const, value: collider.max.z + config.playerRadius },
      ];
      penetrations.sort((a, b) => a.depth - b.depth);
      const hit = penetrations[0];
      state.position[hit.axis] = hit.value;
      const normalSpeed = dot(state.velocity, hit.normal);
      if (normalSpeed < 0) state.velocity = subtract(state.velocity, scale(hit.normal, normalSpeed));
      const footProbeTop = bottom + Math.min(config.playerHeight * 0.28, 0.55);
      const feetTouching = footProbeTop > collider.min.y - 0.04 && bottom < collider.max.y + 0.08;
      wall = { point: copy(state.position), normal: hit.normal, colliderId: collider.id, feetTouching };
    }
  }

  if (length(subtract(state.position, start)) < EPSILON && lengthSquared(displacement) > EPSILON) {
    state.velocity.x *= 0.98;
    state.velocity.z *= 0.98;
  }
  return { wall, grounded, landed };
}

function clampVelocity(state: TraversalState, maximumSpeed: number): void {
  const speed = length(state.velocity);
  if (speed > maximumSpeed) state.velocity = scale(state.velocity, maximumSpeed / speed);
  if (!Number.isFinite(state.position.x + state.position.y + state.position.z + state.velocity.x + state.velocity.y + state.velocity.z)) {
    throw new Error('Traversal physics produced a non-finite transform');
  }
}

function createContext(state: TraversalState, input: TraversalInput, config: TraversalConfig): TraversalContext {
  const speed = length(state.velocity);
  const horizontalSpeed = length(horizontal(state.velocity));
  const forward = normalize(horizontal(state.velocity), normalize(horizontal(input.cameraForward ?? vector(0, 0, -1))));
  const desiredYaw = Math.atan2(-forward.x, -forward.z);
  state.heading = dampAngle(state.heading, desiredYaw, state.grounded ? 14 : 7, 1 / 60);
  const cameraForward = normalize(horizontal(input.cameraForward ?? forward), forward);
  const lateral = dot(cross(cameraForward, forward), UP);
  const tension = state.swing?.tension ?? 0;
  const wallBlend = state.wall && (state.mode === 'wallRun' || state.mode === 'wallCrawl') ? 1 : 0;
  const launchBlend = saturate(state.pointLaunchSeconds / 0.32);
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
      bodyPitch,
      bodyRoll,
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
  else if (state.wall && state.wall.feetTouching && !state.grounded && input.wallCrawlHeld) state.mode = 'wallCrawl';
  else if (state.wall && !state.grounded) state.mode = 'wallRun';
  else if (state.grounded && state.landingSeconds > 0) state.mode = 'land';
  else if (state.grounded) state.mode = horizontalSpeed > 0.55 ? 'run' : 'idle';
  else if (input.diveHeld && state.velocity.y < 1) state.mode = 'dive';
  else state.mode = state.velocity.y >= -0.2 ? 'jump' : 'fall';
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
  const config = mergeConfig(overrides);
  const delta = clamp(value(deltaSeconds, 1 / 60), 1 / 1000, 0.05);
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

  if (environment.wallContact) updateWallFromContact(state, environment.wallContact, config, delta, events);

  if ((input.swingPressed || input.swingHeld) && !state.swing && !state.zip) {
    const anchor = chooseSwingAnchor(state, input, environment, config);
    if (anchor) attachSwing(state, anchor, config, events);
  }
  if ((input.swingReleased || input.swingHeld === false) && state.swing) releaseSwing(state, input, config, events);

  if (input.zipPressed && !state.zip) {
    const target = chooseZipTarget(state, input, environment, config);
    if (target) startZip(state, target, events);
  }
  if ((input.zipReleased || input.zipHeld === false) && state.zip && !input.jumpPressed) {
    const targetId = state.zip.targetId;
    state.zip = null;
    events.push(event('zip-cancelled', state, { anchorId: targetId }));
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

  if (state.grounded && !state.swing && !state.zip) applyGroundMovement(state, move, config, delta);
  else if (!state.swing && !state.zip) applyAirMovement(state, move, config, delta);

  applyWallTraversal(state, input, config, delta);
  if (state.swing) applySwing(state, input, config, delta);
  else if (state.zip) applyZip(state, input, config, delta, events);
  else if (!state.grounded && !state.wall) {
    const gravityMultiplier = input.diveHeld && state.velocity.y < 1 ? config.diveGravityMultiplier : 1;
    state.velocity.y -= config.gravity * gravityMultiplier * delta;
    if (input.diveHeld) {
      const diveForward = normalize(horizontal(input.cameraForward ?? move), vector(0, 0, -1));
      state.velocity = add(state.velocity, scale(diveForward, config.diveAcceleration * delta));
    }
  }

  clampVelocity(state, config.maximumSpeed);
  const collision = resolveMotion(state, environment, config, delta);
  enforceRopeConstraint(state);
  updateWallFromContact(state, collision.wall ?? environment.wallContact ?? null, config, delta, events);
  state.grounded = collision.grounded;
  if (collision.landed || (!wasGrounded && state.grounded)) {
    state.landingSeconds = clamp(Math.abs(state.velocity.y) / 25 + 0.12, 0.12, 0.34);
    events.push(event('land', state, { strength: saturate(Math.abs(state.velocity.y) / 30) }));
  }
  if (state.grounded) state.airSeconds = 0;
  else state.airSeconds += delta;
  updateMode(state, input);
  return { state, context: createContext(state, input, config), events };
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
    wallCrawlHeld: true,
    wallClimb: 1,
  }, {
    groundY: 0,
    wallContact: { point: vector(2, 3.9, 0), normal: vector(-1, 0, 0), colliderId: 'wall', feetTouching: false },
  }, delta);
  checks.wallCrawlRequiresFeet = torsoOnlyCrawl.state.mode !== 'wallCrawl';

  const feetContactState = createTraversalState(vector(1.54, 3, 0), vector());
  const feetCrawl = stepTraversal(feetContactState, {
    wallCrawlHeld: true,
    wallClimb: 1,
  }, {
    groundY: 0,
    wallContact: { point: vector(2, 3, 0), normal: vector(-1, 0, 0), colliderId: 'wall', feetTouching: true },
  }, delta);
  const lostFeetContact = stepTraversal(feetCrawl.state, {
    wallCrawlHeld: true,
    wallClimb: 1,
  }, { groundY: 0 }, delta);
  checks.wallCrawlWithFeet = feetCrawl.state.mode === 'wallCrawl';
  checks.wallCrawlStopsWithoutFeet = lostFeetContact.state.mode !== 'wallCrawl';

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

  checks.finite = [swingState, release.state, collisionState, wallJump.state, torsoOnlyCrawl.state, feetCrawl.state, lostFeetContact.state, launched.state].every((state) =>
    Number.isFinite(state.position.x + state.position.y + state.position.z + state.velocity.x + state.velocity.y + state.velocity.z));
  return { passed: Object.values(checks).every(Boolean), checks, diagnostics };
}
