/** Pure, deterministic velocity assistance; collision always owns position. */
export type AssistanceVector = { x: number; y: number; z: number };
export type AssistanceProbe = (origin: AssistanceVector, direction: AssistanceVector, maximum: number) =>
  { distance: number; normal: AssistanceVector } | null;
export type SwingAssistanceInput = {
  position: AssistanceVector;
  velocity: AssistanceVector;
  dt: number;
  swinging: boolean;
  diving: boolean;
  desiredDirection?: AssistanceVector;
  playerRadius?: number;
  playerHeight?: number;
};
export type SwingAssistanceState = {
  /** Output buffer; caller copies this velocity before normal force integration. */
  velocity: AssistanceVector;
  steering: number;
  groundLift: number;
  active: boolean;
  probeCount: number;
  refreshes: number;
  elapsed: number;
  nextProbeAt: number;
  sampledPosition: AssistanceVector;
  sampledForward: AssistanceVector;
  selectedDirection: AssistanceVector;
  origin: AssistanceVector;
  direction: AssistanceVector;
  distance: number;
  clearance: number;
  selectedClearance: number;
  turnSide: number;
  threatened: boolean;
};

const vector = (): AssistanceVector => ({ x: 0, y: 0, z: 0 });
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const copy = (target: AssistanceVector, source: AssistanceVector) => {
  target.x = source.x; target.y = source.y; target.z = source.z;
};

export function createSwingAssistanceState(): SwingAssistanceState {
  return {
    velocity: vector(), steering: 0, groundLift: 0, active: false, probeCount: 0, refreshes: 0,
    elapsed: 0, nextProbeAt: 0, sampledPosition: vector(), sampledForward: vector(),
    selectedDirection: vector(), origin: vector(), direction: vector(), distance: 0,
    clearance: Infinity, selectedClearance: Infinity, turnSide: 0, threatened: false,
  };
}

/**
 * A nine-ray predictive fan softly rotates velocity toward a real clear lane.
 * It never teleports, never invents an anchor, never bounces away from a facade,
 * and never starts a wall animation. Deliberate dives bypass the entire system.
 *
 * The caller reuses state and receives that same object back. Probe buffers are
 * temporary: probe implementations must read them synchronously, not retain them.
 * Ground clearance is deliberately left to the traversal force solver.
 */
export function stepSwingAssistance(state: SwingAssistanceState, input: SwingAssistanceInput, probe: AssistanceProbe): SwingAssistanceState {
  copy(state.velocity, input.velocity);
  state.steering = 0;
  state.groundLift = 0;
  state.active = false;
  state.probeCount = 0;
  const dt = clamp(Number.isFinite(input.dt) ? input.dt : 0, 0, .05);
  state.elapsed += dt;
  const speed = Math.hypot(input.velocity.x, input.velocity.z);
  if (!input.swinging || input.diving || speed < 6 || !Number.isFinite(speed + input.velocity.y) || dt === 0) {
    state.threatened = false;
    state.nextProbeAt = state.elapsed;
    state.turnSide = 0;
    return state;
  }
  const fx = input.velocity.x / speed;
  const fz = input.velocity.z / speed;
  const movedX = input.position.x - state.sampledPosition.x;
  const movedY = input.position.y - state.sampledPosition.y;
  const movedZ = input.position.z - state.sampledPosition.z;
  const moved = Math.hypot(movedX, movedY, movedZ);
  const changedHeading = fx * state.sampledForward.x + fz * state.sampledForward.z < .94;
  if (state.elapsed >= state.nextProbeAt || moved > 4 || changedHeading) {
    state.refreshes++;
    state.nextProbeAt = state.elapsed + .1;
    copy(state.sampledPosition, input.position);
    state.sampledForward.x = fx; state.sampledForward.y = 0; state.sampledForward.z = fz;
    const radius = input.playerRadius ?? .46;
    const height = input.playerHeight ?? 2.05;
    const maximum = clamp(speed * .85, 9, 52);
    const slope = clamp(input.velocity.y / speed, -1.5, 1.5);
    const normalization = 1 / Math.hypot(1, slope);
    state.distance = maximum;
    state.clearance = maximum;
    const origin = state.origin;
    const direction = state.direction;
    // Five parallel rays cover torso, feet, head and both shoulders. A single
    // center ray misses corner scrapes and thin geometry above/below the chest.
    for (let sample = 0; sample < 5; sample++) {
      const side = sample === 3 ? -radius : sample === 4 ? radius : 0;
      const y = sample === 1 ? radius : sample === 2 ? height - radius : height * .5;
      origin.x = input.position.x - fz * side;
      origin.y = input.position.y + y;
      origin.z = input.position.z + fx * side;
      direction.x = fx * normalization; direction.y = slope * normalization; direction.z = fz * normalization;
      const hit = probe(origin, direction, maximum);
      state.probeCount++;
      // Horizontal steering must not respond to the ground/roof surface. The
      // force solver owns ground skim, while final mesh contact owns collision.
      if (hit && Math.abs(hit.normal.y) < .65 && hit.distance >= 0) state.clearance = Math.min(state.clearance, hit.distance);
    }
    state.threatened = state.clearance < maximum - .05;
    state.selectedClearance = maximum;
    state.selectedDirection.x = fx; state.selectedDirection.y = 0; state.selectedDirection.z = fz;
    if (state.threatened) {
      let bestScore = -Infinity;
      let selectedSide = state.turnSide;
      const wish = input.desiredDirection;
      const wishLength = wish ? Math.hypot(wish.x, wish.z) : 0;
      // Wider fan rays look for usable lanes instead of simply adding an outward
      // wall normal. A modest previous-side bonus prevents left/right flicker.
      for (const angle of [-.55, .55, -1.05, 1.05]) {
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const dx = fx * cos - fz * sin;
        const dz = fx * sin + fz * cos;
        origin.x = input.position.x; origin.y = input.position.y + height * .5; origin.z = input.position.z;
        direction.x = dx * normalization; direction.y = slope * normalization; direction.z = dz * normalization;
        const hit = probe(origin, direction, maximum);
        state.probeCount++;
        const clearance = hit && Math.abs(hit.normal.y) < .65 ? hit.distance : maximum;
        const side = Math.sign(angle);
        const intent = wish && wishLength > .1 ? (wish.x * dx + wish.z * dz) / wishLength : 0;
        const score = clearance / maximum - Math.abs(angle) * .1 + intent * .2 + (side === state.turnSide ? .065 : 0);
        if (score > bestScore) {
          bestScore = score;
          state.selectedDirection.x = dx; state.selectedDirection.z = dz;
          state.selectedClearance = clearance;
          selectedSide = side;
        }
      }
      state.turnSide = selectedSide;
    } else state.turnSide = 0;
  }
  if (!state.threatened) return state;
  const progress = (input.position.x - state.sampledPosition.x) * state.sampledForward.x
    + (input.position.z - state.sampledPosition.z) * state.sampledForward.z;
  const clearance = Math.max(0, state.clearance - progress - (input.playerRadius ?? .46));
  const targetAngle = Math.atan2(fx * state.selectedDirection.z - fz * state.selectedDirection.x,
    fx * state.selectedDirection.x + fz * state.selectedDirection.z);
  const urgency = clamp(1 - clearance / Math.max(1, state.distance), 0, 1);
  // Rotation preserves horizontal kinetic speed. Lateral acceleration is capped,
  // and emergency braking only ever removes forward speed, never reverses it.
  const maximumTurn = Math.min(1.25, 42 / speed) * (.3 + urgency * .7) * dt;
  const turn = clamp(targetAngle, -maximumTurn, maximumTurn);
  const collisionTime = clearance / speed;
  const selectedStillBlocked = state.selectedClearance < state.distance * .78;
  const braking = selectedStillBlocked && collisionTime < .35 ? 18 * clamp(1 - collisionTime / .35, 0, 1) * dt : 0;
  const correctedSpeed = Math.max(0, speed - braking);
  const cos = Math.cos(turn), sin = Math.sin(turn);
  state.velocity.x = (fx * cos - fz * sin) * correctedSpeed;
  state.velocity.z = (fx * sin + fz * cos) * correctedSpeed;
  // Y is exactly the caller's Y: ground assist, gravity, rope tension and dive
  // acceleration are composed once by the existing force-based solver.
  state.steering = turn / dt;
  state.active = Math.abs(turn) > 1e-6 || braking > 1e-6;
  return state;
}
