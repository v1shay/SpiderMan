export type WindVector = { x: number; y: number; z: number };
export type WindTunnelField = {
  center: WindVector;
  direction: WindVector;
  halfLength: number;
  radius: number;
  acceleration: number;
  maximumSpeed: number;
};

export type WindTunnelStep = { velocity: WindVector; active: number; strength: number };

const dot = (a: WindVector, b: WindVector) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Velocity-only boost volume. Collision remains owned by the world sweep on
 * the next physics tick, so a tunnel can never move the player through a wall. */
export function stepWindTunnels(
  position: WindVector,
  velocity: WindVector,
  tunnels: readonly WindTunnelField[],
  delta: number,
): WindTunnelStep {
  for (let index = 0; index < tunnels.length; index += 1) {
    const tunnel = tunnels[index];
    const offset = {
      x: position.x - tunnel.center.x,
      y: position.y - tunnel.center.y,
      z: position.z - tunnel.center.z,
    };
    const longitudinal = dot(offset, tunnel.direction);
    if (Math.abs(longitudinal) > tunnel.halfLength) continue;
    const radial = {
      x: offset.x - tunnel.direction.x * longitudinal,
      y: offset.y - tunnel.direction.y * longitudinal,
      z: offset.z - tunnel.direction.z * longitudinal,
    };
    const radialDistance = Math.hypot(radial.x, radial.y, radial.z);
    if (radialDistance > tunnel.radius) continue;
    const strength = Math.max(.15, 1 - radialDistance / tunnel.radius);
    const forward = dot(velocity, tunnel.direction);
    if (forward < -8) return { velocity: { ...velocity }, active: index, strength: 0 };
    const nextForward = Math.min(tunnel.maximumSpeed, Math.max(0, forward) + tunnel.acceleration * strength * delta);
    const align = Math.exp(-2.1 * strength * delta);
    const lateral = {
      x: velocity.x - tunnel.direction.x * forward,
      y: velocity.y - tunnel.direction.y * forward,
      z: velocity.z - tunnel.direction.z * forward,
    };
    return {
      velocity: {
        x: lateral.x * align + tunnel.direction.x * nextForward,
        y: lateral.y * align + tunnel.direction.y * nextForward,
        z: lateral.z * align + tunnel.direction.z * nextForward,
      },
      active: index,
      strength,
    };
  }
  return { velocity: { ...velocity }, active: -1, strength: 0 };
}
