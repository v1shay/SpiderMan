export interface GroundContactVector {
  x: number;
  y: number;
  z: number;
}

export interface SwingGroundContactInput {
  attemptedVelocity: GroundContactVector;
  sweptVelocity: GroundContactVector;
  grounded: boolean;
  swingHeld: boolean;
  obstructed: boolean;
  hitWall: boolean;
  anchorHeight: number;
  elevatedLaunch?: boolean;
  tension: number;
  attachedSeconds: number;
}

export interface SwingGroundContactResult {
  active: boolean;
  liftOff: boolean;
  velocity: GroundContactVector;
  horizontalRetention: number;
}

const horizontalSpeed = (velocity: GroundContactVector) => Math.hypot(velocity.x, velocity.z);

/**
 * Resolves the brief pavement phase of a ground-fired swing.
 *
 * Ground contact removes only downward velocity while preserving the attempted
 * horizontal arc. After a short, verified attachment it permits one bounded
 * assisted takeoff so a street or broad rooftop cannot cancel a swing before
 * the rope develops an arc. The assist never repeats during that contact phase,
 * and ordinary street skids do not receive an artificial minimum speed.
 */
export function resolveSwingGroundContact(input: SwingGroundContactInput): SwingGroundContactResult {
  const inactive = !input.grounded || !input.swingHeld || input.obstructed || input.hitWall
    || input.anchorHeight <= 2.8 && !input.elevatedLaunch;
  if (inactive) {
    return { active: false, liftOff: false, velocity: { ...input.sweptVelocity }, horizontalRetention: 1 };
  }

  const attemptedHorizontal = horizontalSpeed(input.attemptedVelocity);
  const sweptHorizontal = horizontalSpeed(input.sweptVelocity);
  const readyForAssistedTakeoff = input.attachedSeconds >= .24
    && (input.anchorHeight >= 14 || input.elevatedLaunch === true)
    && attemptedHorizontal >= 8;
  const upwardRopeMotion = readyForAssistedTakeoff || input.attachedSeconds >= .08
    && input.tension >= .06 && input.attemptedVelocity.y >= .32;
  const assistedTakeoffSpeed = Math.min(10.5, 8.5 + attemptedHorizontal * .08);
  const rooftopForwardScale = readyForAssistedTakeoff && input.elevatedLaunch && attemptedHorizontal > 1e-6
    ? Math.max(1, 26 / attemptedHorizontal)
    : 1;
  const velocity = {
    x: input.attemptedVelocity.x * rooftopForwardScale,
    y: upwardRopeMotion
      ? Math.max(input.attemptedVelocity.y, readyForAssistedTakeoff ? assistedTakeoffSpeed : .32)
      : 0,
    z: input.attemptedVelocity.z * rooftopForwardScale,
  };
  return {
    active: true,
    liftOff: upwardRopeMotion,
    velocity,
    horizontalRetention: attemptedHorizontal > 1e-6
      ? horizontalSpeed(velocity) / attemptedHorizontal
      : sweptHorizontal > 1e-6 ? 0 : 1,
  };
}
