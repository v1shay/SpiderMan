/**
 * Deterministic, trajectory-aware swing-anchor ranking.
 *
 * This module is deliberately renderer and THREE.js independent. Callers can
 * adapt the optional safety probes to BVH/capsule queries without allowing the
 * scoring layer to move the player or bypass collision authority.
 */

export interface SwingAnchorVector {
  x: number;
  y: number;
  z: number;
}

export interface SwingAnchorCandidateLike {
  id?: string;
  point: SwingAnchorVector;
  normal?: SwingAnchorVector;
  kind?: 'facade' | 'roof' | 'ledge' | 'perch' | 'generic';
  lineOfSight?: boolean;
  weight?: number;
}

export interface SwingAnchorScoringContext {
  position: SwingAnchorVector;
  velocity: SwingAnchorVector;
  aimDirection: SwingAnchorVector;
  /** Preferred travel direction after the bottom of the arc. */
  desiredDirection?: SwingAnchorVector;
  groundY?: number;
  playerRadius?: number;
  playerHeight?: number;
  gravity?: number;
  /**
   * Return false when the capsule cannot occupy a sampled trajectory point.
   * Samples cover the incoming arc, bottom of arc, and early outgoing arc.
   */
  isCapsuleClear?: (position: SwingAnchorVector, radius: number, height: number) => boolean;
  /** Return the highest support Y beneath a trajectory sample, or null. */
  sampleGround?: (position: SwingAnchorVector, maximumDrop: number) => number | null;
}

export interface SwingAnchorScoringConfig {
  minimumDistance: number;
  maximumDistance: number;
  minimumHeight: number;
  maximumIncomingArc: number;
  outgoingPredictionRadians: number;
  trajectorySamples: number;
  minimumGroundClearance: number;
  idealBottomClearance: number;
  idealArcDepth: number;
}

export interface SwingAnchorTrajectoryScore {
  candidate: SwingAnchorCandidateLike;
  valid: boolean;
  score: number;
  rejection?: 'line-of-sight' | 'range' | 'height' | 'degenerate' | 'ground' | 'collision';
  range: number;
  predictedBottom: SwingAnchorVector;
  predictedOutgoingTangent: SwingAnchorVector;
  predictedOutgoingSpeed: number;
  swingPlaneNormal: SwingAnchorVector;
  incomingArcRadians: number;
  arcDepth: number;
  bottomClearance: number;
  forwardProgress: number;
  aimAlignment: number;
  tangentialFraction: number;
  collisionSafety: number;
}

export const DEFAULT_SWING_ANCHOR_SCORING_CONFIG: Readonly<SwingAnchorScoringConfig> = Object.freeze({
  minimumDistance: 4,
  maximumDistance: 78,
  minimumHeight: 1.2,
  // A candidate requiring more than 225 degrees before reaching its bottom is
  // technically possible but will feel like an unexpected backward orbit.
  maximumIncomingArc: Math.PI * 1.25,
  outgoingPredictionRadians: .42,
  trajectorySamples: 9,
  minimumGroundClearance: .32,
  idealBottomClearance: 3.2,
  idealArcDepth: 18,
});

const EPSILON = 1e-8;
const UP: SwingAnchorVector = Object.freeze({ x: 0, y: 1, z: 0 });
const DOWN: SwingAnchorVector = Object.freeze({ x: 0, y: -1, z: 0 });
const ZERO: SwingAnchorVector = Object.freeze({ x: 0, y: 0, z: 0 });
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const saturate = (value: number) => clamp(value, 0, 1);
const vector = (x = 0, y = 0, z = 0): SwingAnchorVector => ({ x, y, z });
const add = (a: SwingAnchorVector, b: SwingAnchorVector) => vector(a.x + b.x, a.y + b.y, a.z + b.z);
const subtract = (a: SwingAnchorVector, b: SwingAnchorVector) => vector(a.x - b.x, a.y - b.y, a.z - b.z);
const scale = (source: SwingAnchorVector, scalar: number) => vector(source.x * scalar, source.y * scalar, source.z * scalar);
const dot = (a: SwingAnchorVector, b: SwingAnchorVector) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: SwingAnchorVector, b: SwingAnchorVector) => vector(
  a.y * b.z - a.z * b.y,
  a.z * b.x - a.x * b.z,
  a.x * b.y - a.y * b.x,
);
const magnitude = (source: SwingAnchorVector) => Math.hypot(source.x, source.y, source.z);
const normalize = (source: SwingAnchorVector, fallback: SwingAnchorVector = ZERO) => {
  const length = magnitude(source);
  return length > EPSILON ? scale(source, 1 / length) : vector(fallback.x, fallback.y, fallback.z);
};
const reject = (source: SwingAnchorVector, normal: SwingAnchorVector) => subtract(source, scale(normal, dot(source, normal)));
const horizontal = (source: SwingAnchorVector) => vector(source.x, 0, source.z);

function rotateAroundAxis(source: SwingAnchorVector, axis: SwingAnchorVector, radians: number): SwingAnchorVector {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return add(add(scale(source, cosine), scale(cross(axis, source), sine)), scale(axis, dot(axis, source) * (1 - cosine)));
}

function positiveAngleAroundAxis(from: SwingAnchorVector, to: SwingAnchorVector, axis: SwingAnchorVector): number {
  let angle = Math.atan2(dot(axis, cross(from, to)), clamp(dot(from, to), -1, 1));
  if (angle < 0) angle += Math.PI * 2;
  return angle;
}

function invalidScore(
  candidate: SwingAnchorCandidateLike,
  rejection: SwingAnchorTrajectoryScore['rejection'],
  range = 0,
): SwingAnchorTrajectoryScore {
  return {
    candidate, valid: false, score: -Infinity, rejection, range,
    predictedBottom: vector(), predictedOutgoingTangent: vector(), predictedOutgoingSpeed: 0,
    swingPlaneNormal: vector(), incomingArcRadians: 0, arcDepth: 0, bottomClearance: -Infinity,
    forwardProgress: -1, aimAlignment: -1, tangentialFraction: 0, collisionSafety: 0,
  };
}

/** Predict and score one real geometry anchor without mutating caller data. */
export function scoreSwingAnchorTrajectory(
  candidate: SwingAnchorCandidateLike,
  context: SwingAnchorScoringContext,
  overrides: Partial<SwingAnchorScoringConfig> = {},
): SwingAnchorTrajectoryScore {
  const config = { ...DEFAULT_SWING_ANCHOR_SCORING_CONFIG, ...overrides };
  if (candidate.lineOfSight === false) return invalidScore(candidate, 'line-of-sight');
  const radial = subtract(context.position, candidate.point);
  const range = magnitude(radial);
  if (!Number.isFinite(range) || range < config.minimumDistance || range > config.maximumDistance) {
    return invalidScore(candidate, 'range', range);
  }
  const height = candidate.point.y - context.position.y;
  if (height < config.minimumHeight) return invalidScore(candidate, 'height', range);

  const radialDirection = scale(radial, 1 / range);
  const velocity = context.velocity;
  const speed = magnitude(velocity);
  const aim = normalize(context.aimDirection, vector(0, .25, -1));
  const desired = normalize(horizontal(context.desiredDirection ?? context.aimDirection), horizontal(aim));
  const towardAnchor = scale(radialDirection, -1);
  const aimAlignment = dot(aim, towardAnchor);

  // Angular momentum defines the actual swing plane. At very low speed, use a
  // deterministic desired tangent rather than allowing floating-point noise to
  // choose which side of the anchor the player will orbit.
  let tangentialVelocity = reject(velocity, radialDirection);
  if (magnitude(tangentialVelocity) < .35) {
    tangentialVelocity = reject(desired, radialDirection);
    if (magnitude(tangentialVelocity) < EPSILON) tangentialVelocity = reject(UP, radialDirection);
  }
  const tangentialSpeed = magnitude(tangentialVelocity);
  if (tangentialSpeed < EPSILON) return invalidScore(candidate, 'degenerate', range);
  const planeNormal = normalize(cross(radialDirection, tangentialVelocity));
  if (magnitude(planeNormal) < EPSILON) return invalidScore(candidate, 'degenerate', range);
  const bottomDirection = normalize(reject(DOWN, planeNormal), DOWN);
  const incomingArcRadians = positiveAngleAroundAxis(radialDirection, bottomDirection, planeNormal);
  if (incomingArcRadians > config.maximumIncomingArc) return invalidScore(candidate, 'degenerate', range);

  const predictedBottom = add(candidate.point, scale(bottomDirection, range));
  const outgoingDirection = rotateAroundAxis(bottomDirection, planeNormal, config.outgoingPredictionRadians);
  const predictedOutgoingTangent = normalize(cross(planeNormal, outgoingDirection));
  const arcDepth = context.position.y - predictedBottom.y;
  const gravity = Number.isFinite(context.gravity) ? Math.max(0, context.gravity as number) : 29;
  const predictedOutgoingSpeed = Math.sqrt(Math.max(0, tangentialSpeed * tangentialSpeed + 2 * gravity * Math.max(0, arcDepth)));
  const forwardProgress = dot(normalize(horizontal(predictedOutgoingTangent), desired), desired);
  const tangentialFraction = speed > EPSILON ? saturate(tangentialSpeed / speed) : 0;

  const radius = context.playerRadius ?? .46;
  const playerHeight = context.playerHeight ?? 2.05;
  const groundAtBottom = context.sampleGround?.(predictedBottom, Math.max(8, range)) ?? context.groundY ?? -Infinity;
  const bottomClearance = predictedBottom.y - groundAtBottom;
  if (bottomClearance < config.minimumGroundClearance) {
    return { ...invalidScore(candidate, 'ground', range), predictedBottom, predictedOutgoingTangent,
      predictedOutgoingSpeed, swingPlaneNormal: planeNormal, incomingArcRadians, arcDepth, bottomClearance,
      forwardProgress, aimAlignment, tangentialFraction };
  }

  if (context.isCapsuleClear && !context.isCapsuleClear(predictedBottom, radius, playerHeight)) {
    return { ...invalidScore(candidate, 'collision', range), predictedBottom, predictedOutgoingTangent,
      predictedOutgoingSpeed, swingPlaneNormal: planeNormal, incomingArcRadians, arcDepth, bottomClearance,
      forwardProgress, aimAlignment, tangentialFraction, collisionSafety: 0 };
  }

  const sampleCount = Math.max(3, Math.floor(config.trajectorySamples));
  let safeSamples = 0;
  for (let index = 1; index <= sampleCount; index++) {
    const progress = index / sampleCount;
    const radians = (incomingArcRadians + config.outgoingPredictionRadians) * progress;
    const radialAtSample = rotateAroundAxis(radialDirection, planeNormal, radians);
    const point = add(candidate.point, scale(radialAtSample, range));
    if (context.isCapsuleClear && !context.isCapsuleClear(point, radius, playerHeight)) {
      return { ...invalidScore(candidate, 'collision', range), predictedBottom, predictedOutgoingTangent,
        predictedOutgoingSpeed, swingPlaneNormal: planeNormal, incomingArcRadians, arcDepth, bottomClearance,
        forwardProgress, aimAlignment, tangentialFraction, collisionSafety: safeSamples / sampleCount };
    }
    const localGround = context.sampleGround?.(point, Math.max(8, range)) ?? context.groundY ?? -Infinity;
    if (point.y - localGround < config.minimumGroundClearance) {
      return { ...invalidScore(candidate, 'ground', range), predictedBottom, predictedOutgoingTangent,
        predictedOutgoingSpeed, swingPlaneNormal: planeNormal, incomingArcRadians, arcDepth, bottomClearance,
        forwardProgress, aimAlignment, tangentialFraction, collisionSafety: safeSamples / sampleCount };
    }
    safeSamples++;
  }

  const clearanceQuality = saturate(bottomClearance / Math.max(EPSILON, config.idealBottomClearance));
  const depthQuality = saturate(arcDepth / Math.max(EPSILON, config.idealArcDepth));
  const distanceQuality = 1 - Math.abs(range - 34) / Math.max(EPSILON, config.maximumDistance);
  const arcDirectness = 1 - incomingArcRadians / Math.max(EPSILON, config.maximumIncomingArc);
  const surfaceQuality = candidate.kind === 'facade' || candidate.kind === 'ledge' ? .16
    : candidate.kind === 'roof' || candidate.kind === 'perch' ? .1 : 0;
  // Forward-producing trajectory and safety dominate cursor alignment. This is
  // the key behavioral difference from a nearest/most-visible anchor picker.
  const rawScore = forwardProgress * 3.4
    + depthQuality * 1.15
    + clearanceQuality * 1.05
    + tangentialFraction * .8
    + arcDirectness * .65
    + aimAlignment * .62
    + distanceQuality * .25
    + surfaceQuality;
  const weight = clamp(Number.isFinite(candidate.weight) ? candidate.weight as number : 1, .05, 4);
  return {
    candidate, valid: true, score: rawScore + Math.log2(weight) * .35, range, predictedBottom,
    predictedOutgoingTangent, predictedOutgoingSpeed, swingPlaneNormal: planeNormal,
    incomingArcRadians, arcDepth, bottomClearance, forwardProgress, aimAlignment,
    tangentialFraction, collisionSafety: 1,
  };
}

function deterministicCandidateKey(candidate: SwingAnchorCandidateLike): string {
  return `${candidate.id ?? ''}|${candidate.point.x.toFixed(6)}|${candidate.point.y.toFixed(6)}|${candidate.point.z.toFixed(6)}`;
}

/** Rank valid anchors by predicted traversal value, with deterministic ties. */
export function rankSwingAnchorTrajectories(
  candidates: readonly SwingAnchorCandidateLike[],
  context: SwingAnchorScoringContext,
  overrides: Partial<SwingAnchorScoringConfig> = {},
): SwingAnchorTrajectoryScore[] {
  return candidates.map((candidate) => scoreSwingAnchorTrajectory(candidate, context, overrides))
    .filter((result) => result.valid)
    .sort((a, b) => b.score - a.score || deterministicCandidateKey(a.candidate).localeCompare(deterministicCandidateKey(b.candidate)));
}

export function selectTrajectoryAwareSwingAnchor(
  candidates: readonly SwingAnchorCandidateLike[],
  context: SwingAnchorScoringContext,
  overrides: Partial<SwingAnchorScoringConfig> = {},
): SwingAnchorTrajectoryScore | null {
  return rankSwingAnchorTrajectories(candidates, context, overrides)[0] ?? null;
}
