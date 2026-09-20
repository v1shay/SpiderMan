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
  /** Feed this to TraversalEnvironment.predictiveAssistAcceleration; do not apply twice. */
  acceleration: AssistanceVector;
  steering: number;
  groundLift: number;
  active: boolean;
  probeCount: number;
  refreshes: number;
  elapsed: number;
  nextProbeAt: number;
  sampledPosition: AssistanceVector;
  sampledForward: AssistanceVector;
  sampledWish: AssistanceVector;
  selectedDirection: AssistanceVector;
  avoidanceNormal: AssistanceVector;
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
    velocity: vector(), acceleration: vector(), steering: 0, groundLift: 0, active: false, probeCount: 0, refreshes: 0,
    elapsed: 0, nextProbeAt: 0, sampledPosition: vector(), sampledForward: vector(), sampledWish: vector(),
    selectedDirection: vector(), avoidanceNormal: vector(), origin: vector(), direction: vector(), distance: 0,
    clearance: Infinity, selectedClearance: Infinity, turnSide: 0, threatened: false,
  };
}

/**
 * A predictive capsule-width fan softly rotates velocity toward a real clear lane.
 * It never teleports, never invents an anchor, never bounces away from a facade,
 * and never starts a wall animation. Deliberate dives bypass the entire system.
 *
 * The caller reuses state and receives that same object back. Probe buffers are
 * temporary: probe implementations must read them synchronously, not retain them.
 * Ground clearance is deliberately left to the traversal force solver.
 */
export function stepSwingAssistance(state: SwingAssistanceState, input: SwingAssistanceInput, probe: AssistanceProbe): SwingAssistanceState {
  copy(state.velocity, input.velocity);
  state.acceleration.x = 0; state.acceleration.y = 0; state.acceleration.z = 0;
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
  const wish = input.desiredDirection;
  const wishLength = wish ? Math.hypot(wish.x, wish.z) : 0;
  const wx = wish && wishLength > .1 ? wish.x / wishLength : fx;
  const wz = wish && wishLength > .1 ? wish.z / wishLength : fz;
  const movedX = input.position.x - state.sampledPosition.x;
  const movedY = input.position.y - state.sampledPosition.y;
  const movedZ = input.position.z - state.sampledPosition.z;
  const moved = Math.hypot(movedX, movedY, movedZ);
  const changedHeading = fx * state.sampledForward.x + fz * state.sampledForward.z < .98
    || wx * state.sampledWish.x + wz * state.sampledWish.z < .98;
  if (state.elapsed >= state.nextProbeAt || moved > 4 || changedHeading) {
    state.refreshes++;
    state.nextProbeAt = state.elapsed + .1;
    copy(state.sampledPosition, input.position);
    state.sampledForward.x = fx; state.sampledForward.y = 0; state.sampledForward.z = fz;
    state.sampledWish.x = wx; state.sampledWish.z = wz;
    const radius = input.playerRadius ?? .46;
    const height = input.playerHeight ?? 2.05;
    // Faster traversal needs more than one reaction-time of visibility. This is
    // deliberately generous at the high-assist default, but it still follows
    // real raycast clearance and never moves the capsule itself.
    const maximum = clamp(speed * 1.7, 24, 145);
    const slope = clamp(input.velocity.y / speed, -1.5, 1.5);
    const normalization = 1 / Math.hypot(1, slope);
    state.distance = maximum;
    state.clearance = maximum;
    state.avoidanceNormal.x = 0; state.avoidanceNormal.y = 0; state.avoidanceNormal.z = 0;
    const origin = state.origin;
    const direction = state.direction;
    // Five parallel rays cover torso, feet, head and both shoulders. A single
    // center ray misses corner scrapes and thin geometry above/below the chest.
    for (let sample = 0; sample < 7; sample++) {
      const side = sample === 3 ? -radius : sample === 4 ? radius : 0;
      const y = sample === 1 ? radius : sample === 2 ? height - radius : height * .5;
      origin.x = input.position.x - fz * side;
      origin.y = input.position.y + y;
      origin.z = input.position.z + fx * side;
      direction.x = fx * normalization; direction.y = slope * normalization; direction.z = fz * normalization;
      // Also inspect level travel and the path a camera turn is about to take.
      // A descending center ray can hit the street before seeing the facade.
      if (sample === 5) { direction.x = fx; direction.y = 0; direction.z = fz; }
      if (sample === 6) {
        const angle = clamp(Math.atan2(fx * wz - fz * wx, fx * wx + fz * wz), -.65, .65);
        direction.x = fx * Math.cos(angle) - fz * Math.sin(angle);
        direction.y = 0;
        direction.z = fx * Math.sin(angle) + fz * Math.cos(angle);
      }
      const hit = probe(origin, direction, maximum);
      state.probeCount++;
      // Horizontal steering must not respond to the ground/roof surface. The
      // force solver owns ground skim, while final mesh contact owns collision.
      if (hit && Math.abs(hit.normal.y) < .65 && hit.distance >= 0 && hit.distance < state.clearance) {
        state.clearance = hit.distance;
        const sign = hit.normal.x * direction.x + hit.normal.z * direction.z > 0 ? -1 : 1;
        state.avoidanceNormal.x = hit.normal.x * sign;
        state.avoidanceNormal.z = hit.normal.z * sign;
      }
    }
    state.threatened = state.clearance < maximum - .05;
    state.selectedClearance = maximum;
    state.selectedDirection.x = fx; state.selectedDirection.y = 0; state.selectedDirection.z = fz;
    if (state.threatened) {
      let bestScore = -Infinity;
      let selectedSide = state.turnSide;
      // Wider fan rays look for usable lanes instead of simply adding an outward
      // wall normal. A modest previous-side bonus prevents left/right flicker.
      for (const angle of [-.3, .3, -.65, .65, -1.05, 1.05, -1.4, 1.4, -1.65, 1.65]) {
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const dx = fx * cos - fz * sin;
        const dz = fx * sin + fz * cos;
        let clearance = maximum;
        for (const sideOffset of [-radius - .35, 0, radius + .35]) {
          origin.x = input.position.x - dz * sideOffset;
          origin.y = input.position.y + height * .5;
          origin.z = input.position.z + dx * sideOffset;
          direction.x = dx; direction.y = 0; direction.z = dz;
          const hit = probe(origin, direction, maximum);
          state.probeCount++;
          if (hit && Math.abs(hit.normal.y) < .65) clearance = Math.min(clearance, hit.distance);
        }
        const side = Math.sign(angle);
        const intent = wx * dx + wz * dz;
        const score = clearance / maximum * 1.5 - Math.abs(angle) * .1 + intent * .32 + (side === state.turnSide ? .16 : 0);
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
  // Start rotating early. If there is too little turning room, shed speed
  // progressively while turning; never teleport or reflect off the facade.
  const maximumTurn = Math.min(2.6, 78 / speed) * (.8 + urgency * .2) * dt;
  const turn = clamp(targetAngle, -maximumTurn, maximumTurn);
  const collisionTime = clearance / speed;
  const normalLength = Math.hypot(state.avoidanceNormal.x, state.avoidanceNormal.z);
  const inward = normalLength > .01
    ? Math.max(0, -(fx * state.avoidanceNormal.x + fz * state.avoidanceNormal.z) / normalLength) : 0;
  const safeSpeed = Math.sqrt(2 * 54 * Math.max(0, clearance - 1));
  const braking = collisionTime < .65 && inward > .55
    ? Math.min(54 * dt, Math.max(0, speed - safeSpeed)) : 0;
  const correctedSpeed = Math.max(0, speed - braking);
  const cos = Math.cos(turn), sin = Math.sin(turn);
  const dx = fx * cos - fz * sin;
  const dz = fx * sin + fz * cos;
  state.velocity.x = dx * correctedSpeed;
  state.velocity.z = dz * correctedSpeed;
  // Y is exactly the caller's Y: ground assist, gravity, rope tension and dive
  // acceleration are composed once by the existing force-based solver.
  state.acceleration.x = (state.velocity.x - input.velocity.x) / dt;
  state.acceleration.z = (state.velocity.z - input.velocity.z) / dt;
  state.steering = turn / dt;
  state.active = Math.abs(turn) > 1e-6 || braking > 1e-6;
  return state;
}
