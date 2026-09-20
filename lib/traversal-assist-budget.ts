/** A shared per-tick impulse allowance. Rope tension/gravity are physical forces
 * and do not spend it. Every authored correction does, in safety-first order. */
export type AssistVector = { x: number; y: number; z: number };
export type AssistPriority = 'ground' | 'collision' | 'steering' | 'comfort';
export type AssistRequest = { priority: AssistPriority; deltaVelocity: AssistVector };
// Facade avoidance must never wait behind a cosmetic pump or the low-swing lift.
// The order mirrors the accessibility intent of a high swing-assist setting:
// save the player from a collision, protect the street skim, then honor steering.
const priorities: AssistPriority[] = ['collision', 'ground', 'steering', 'comfort'];
export function resolveTraversalAssists(requests: readonly AssistRequest[], dt: number, maximumAcceleration = 84) {
  const allowance = Math.max(0, Math.min(.05, Number.isFinite(dt) ? dt : 0)) * maximumAcceleration;
  let remaining = allowance;
  const deltaVelocity = { x: 0, y: 0, z: 0 };
  const applied: Record<AssistPriority, number> = { ground: 0, collision: 0, steering: 0, comfort: 0 };
  for (const priority of priorities) for (const request of requests) {
    if (request.priority !== priority) continue;
    const v = request.deltaVelocity, size = Math.hypot(v.x, v.y, v.z);
    if (!Number.isFinite(size) || size < 1e-9) continue;
    const spent = Math.min(remaining, size), scale = spent / size;
    deltaVelocity.x += v.x * scale; deltaVelocity.y += v.y * scale; deltaVelocity.z += v.z * scale;
    remaining -= spent; applied[priority] += spent;
  }
  return { deltaVelocity, applied, spent: allowance - remaining, allowance };
}
