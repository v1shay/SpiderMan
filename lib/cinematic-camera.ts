export type CameraPhase = 'ground' | 'swing' | 'release' | 'air' | 'dive' | 'wall' | 'zip';

export type CinematicCameraState = {
  phase: CameraPhase;
  previousSpeed: number;
  releasePulse: number;
  zipBlend: number;
  zipEntryPulse: number;
  zipReleasePulse: number;
  impactPulse: number;
  wallKickPulse: number;
};

export type CinematicCameraInput = {
  mode: string;
  speed: number;
  verticalSpeed: number;
  turnRate: number;
  webLateral: number;
  grounded: boolean;
  boostStrength?: number;
  wallKick?: number;
};

export type CinematicCameraOutput = {
  phase: CameraPhase;
  fovOffset: number;
  distanceOffset: number;
  heightOffset: number;
  roll: number;
  shake: number;
  followStrength: number;
  checkpointLook: number;
  zoomDirection: 'in' | 'out' | 'neutral';
};

export const createCinematicCameraState = (): CinematicCameraState => ({
  phase: 'ground',
  previousSpeed: 0,
  releasePulse: 0,
  zipBlend: 0,
  zipEntryPulse: 0,
  zipReleasePulse: 0,
  impactPulse: 0,
  wallKickPulse: 0,
});

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * A bounded, phase-based traversal camera. It deliberately separates physical
 * chase distance from FOV so speed reads strongly without constantly pumping
 * the whole viewport in and out.
 */
export function stepCinematicCamera(state: CinematicCameraState, input: CinematicCameraInput, delta: number): CinematicCameraOutput {
  const wasSwinging = state.phase === 'swing';
  const wasZipping = state.phase === 'zip';
  const phase: CameraPhase = input.wallKick ? 'wall'
    : input.mode === 'swing' ? 'swing'
    : input.mode === 'webZip' || input.mode === 'pointLaunch' ? 'zip'
      : input.mode === 'wallCrawl' || input.mode === 'wallRun' ? 'wall'
        : input.mode === 'dive' ? 'dive'
          : input.grounded ? 'ground'
            : wasSwinging ? 'release' : 'air';
  if (wasSwinging && phase !== 'swing') state.releasePulse = 1;
  if (!wasZipping && phase === 'zip') state.zipEntryPulse = 1;
  if (wasZipping && phase !== 'zip') state.zipReleasePulse = 1;
  state.wallKickPulse = Math.max(state.wallKickPulse, input.wallKick ?? 0);
  const acceleration = (input.speed - state.previousSpeed) / Math.max(delta, 1 / 120);
  if (input.grounded && state.phase !== 'ground' && input.verticalSpeed < -5) state.impactPulse = clamp(-input.verticalSpeed / 45, 0, 1);
  state.releasePulse = Math.max(0, state.releasePulse - delta * 2.35);
  const zipTarget = phase === 'zip' ? 1 : 0;
  const zipDamping = phase === 'zip' ? 18 : 8;
  state.zipBlend += (zipTarget - state.zipBlend) * (1 - Math.exp(-zipDamping * delta));
  state.zipEntryPulse = Math.max(0, state.zipEntryPulse - delta * 4.5);
  state.zipReleasePulse = Math.max(0, state.zipReleasePulse - delta * 2.8);
  state.impactPulse = Math.max(0, state.impactPulse - delta * 4.5);
  state.wallKickPulse = Math.max(0, state.wallKickPulse - delta * 3.4);
  state.previousSpeed = input.speed;
  state.phase = phase;

  const speed = clamp(input.speed / 58, 0, 1);
  const swing = phase === 'swing' ? 1 : 0;
  const release = state.releasePulse;
  const dive = phase === 'dive' ? 1 : 0;
  const zip = state.zipBlend;
  const zipFocus = clamp(zip + state.zipEntryPulse * .38, 0, 1);
  const zipRelease = state.zipReleasePulse;
  const activeZipFocus = phase === 'zip' ? zipFocus : zipFocus * (1 - zipRelease);
  const boost = clamp(input.boostStrength ?? 0, 0, 1);
  const wallKick = state.wallKickPulse;
  // Attached swings sit slightly closer, as requested, while FOV still sells
  // velocity. Release expands outward into a wider launch composition.
  const distanceOffset = -swing * (1.45 + speed * 1.35)
    - activeZipFocus * (2.15 + speed * .9)
    + release * (3.15 + speed * 1.9)
    + zipRelease * (3.35 + speed * 1.65)
    + dive * 1.45 + boost * 1.55 + wallKick * 2.1;
  const fovOffset = speed * 8.2 + swing * 2.6
    - activeZipFocus * (9.5 + speed * 3.1)
    + release * 8.4
    + zipRelease * (8.7 + speed * 3.4)
    + dive * 5.5 + boost * 7.2 + wallKick * 4.8;
  const roll = clamp(input.turnRate * -.043 + input.webLateral * -.15, -.25, .25) * (.38 + speed * .62)
    + clamp(wallKick * input.webLateral * -.13, -.1, .1);
  const accelerationShake = clamp((Math.abs(acceleration) - 16) / 75, 0, 1);
  const shake = clamp(speed * .022 + accelerationShake * .032 + state.impactPulse * .05
    + release * .032 + activeZipFocus * .018 + zipRelease * .034
    + boost * .026 + wallKick * .048, 0, .095);
  return {
    phase,
    fovOffset,
    distanceOffset,
    heightOffset: dive * -.72 - activeZipFocus * .18 + release * .5 + zipRelease * .42 + boost * .18 + wallKick * .3,
    roll: clamp(roll, -.27, .27),
    shake,
    followStrength: phase === 'ground' ? .7 : phase === 'wall' ? .15 : .35 + speed * .4,
    checkpointLook: phase === 'ground' ? .08 : .12 + speed * .18,
    zoomDirection: phase === 'zip' ? 'in' : zipRelease > .08 ? 'out' : activeZipFocus > .22 ? 'in' : 'neutral',
  };
}
