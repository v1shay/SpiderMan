export type SkimVector = { x: number; y: number; z: number };

export type WallSkimResult = {
  eligible: boolean;
  velocity: SkimVector;
  direction: SkimVector;
  strength: number;
};

const dot = (a: SkimVector, b: SkimVector) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (value: SkimVector) => Math.hypot(value.x, value.y, value.z);
const normalize = (value: SkimVector, fallback: SkimVector): SkimVector => {
  const magnitude = length(value);
  return magnitude > 1e-6
    ? { x: value.x / magnitude, y: value.y / magnitude, z: value.z / magnitude }
    : { ...fallback };
};

/**
 * Converts a fast, inward swing impact into a short run along the facade and
 * an outward kick. This never changes position and cannot enable crawling;
 * the authoritative mesh sweep remains responsible for contact clearance.
 */
export function calculateWallSkim(
  velocity: SkimVector,
  wallNormal: SkimVector,
  desiredForward: SkimVector,
  maximumSpeed = 94,
): WallSkimResult {
  const normal = normalize(wallNormal, { x: 0, y: 0, z: 1 });
  const speed = length(velocity);
  const inwardSpeed = Math.max(0, -dot(velocity, normal));
  if (speed < 10 || inwardSpeed < 1.6 || Math.abs(normal.y) > .36) {
    return { eligible: false, velocity: { ...velocity }, direction: { x: 0, y: 0, z: 0 }, strength: 0 };
  }

  const tangent = {
    x: velocity.x - normal.x * dot(velocity, normal),
    y: 0,
    z: velocity.z - normal.z * dot(velocity, normal),
  };
  const fallbackA = normalize({ x: -normal.z, y: 0, z: normal.x }, { x: 1, y: 0, z: 0 });
  const fallbackB = { x: -fallbackA.x, y: 0, z: -fallbackA.z };
  const desired = normalize({ x: desiredForward.x, y: 0, z: desiredForward.z }, fallbackA);
  const fallback = dot(fallbackA, desired) >= dot(fallbackB, desired) ? fallbackA : fallbackB;
  const direction = normalize(tangent, fallback);
  const tangentialSpeed = Math.max(10.5, Math.hypot(tangent.x, tangent.z), speed * .78);
  const strength = Math.min(1, (speed - 10) / 38 + inwardSpeed / 55);
  const outwardSpeed = 5.8 + strength * 3.7;
  const upwardSpeed = Math.max(velocity.y * .68, 4.4 + strength * 4.2);
  let result = {
    x: direction.x * tangentialSpeed + normal.x * outwardSpeed,
    y: upwardSpeed,
    z: direction.z * tangentialSpeed + normal.z * outwardSpeed,
  };
  const resultSpeed = length(result);
  if (resultSpeed > maximumSpeed) {
    const scale = maximumSpeed / resultSpeed;
    result = { x: result.x * scale, y: result.y * scale, z: result.z * scale };
  }
  return { eligible: true, velocity: result, direction, strength };
}
