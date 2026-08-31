import type { Vector3Like } from './traversal-physics.ts';

export type IronFlightMode = 'grounded' | 'freefall' | 'hover' | 'cruise';
export type IronFlightInput = {
  hoverToggle: boolean;
  cruiseToggle: boolean;
  ascend: boolean;
  ascendPressed?: boolean;
  descend: boolean;
  boost: boolean;
  aim: Vector3Like;
};
const damp = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt));

/** Forces only: movement still passes through the shared swept collision solver. */
export function updateIronFlight(mode: IronFlightMode, body: { grounded: boolean; velocity: Vector3Like }, input: IronFlightInput, dt: number): IronFlightMode {
  if (body.grounded && !input.ascend) mode = 'grounded';
  const wasGrounded = body.grounded;
  if (input.hoverToggle) mode = mode === 'hover' || mode === 'cruise' ? 'freefall' : 'hover';
  if (input.cruiseToggle) mode = mode === 'cruise' ? 'freefall' : 'cruise';
  // Explicit power-off wins over a still-held ascent key for this frame.
  const powerOff = (input.hoverToggle || input.cruiseToggle) && mode === 'freefall';
  if (input.ascend && !powerOff && mode !== 'cruise' && (mode !== 'freefall' || input.ascendPressed)) mode = 'hover';
  if (mode === 'grounded' && !body.grounded) mode = 'freefall';
  if (mode === 'hover' || mode === 'cruise') {
    body.grounded = false;
    if (wasGrounded) body.velocity.y = Math.max(body.velocity.y, mode === 'cruise' ? 12 : 10);
    if (mode === 'hover') {
      const vertical = input.ascend ? 18 : input.descend ? -13 : 0;
      body.velocity.y = damp(body.velocity.y, vertical, input.ascend || input.descend ? 6 : 8, dt);
    } else {
      const speed = input.boost ? 72 : 52;
      body.velocity.x = damp(body.velocity.x, input.aim.x * speed, 4.8, dt);
      body.velocity.z = damp(body.velocity.z, input.aim.z * speed, 4.8, dt);
      // Space/Shift trim altitude without silently cancelling cruise.
      const lift = input.ascend ? 18 : input.descend ? -15 : 0;
      const takeoffLift = wasGrounded ? 12 : input.aim.y * speed + lift;
      body.velocity.y = damp(body.velocity.y, takeoffLift, 4.8, dt);
    }
  }
  // Shift alone never switches on repulsors or launches a grounded character.
  return mode;
}
