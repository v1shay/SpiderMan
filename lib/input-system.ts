import type { TraversalInput, Vector3Like } from './traversal-physics';

/** Physical state belongs to the device, not to the current race/game phase. */
export interface RawInputState {
  keys: Set<string>;
  buttons: Set<number>;
  focused: boolean;
  pointerPressure?: number;
}

export const ACTION_BINDINGS = {
  moveForward: ['KeyW'],
  moveBack: ['KeyS'],
  moveLeft: ['KeyA'],
  moveRight: ['KeyD'],
  swing: ['Mouse0'],
  zip: ['Mouse2'],
  pointLaunch: ['KeyE'],
  jump: ['Space'],
  dive: ['ShiftLeft', 'ShiftRight'],
  roll: ['KeyR'],
  trick: ['KeyF'],
  wallCrawl: ['KeyQ'],
  glide: ['KeyG'],
  chargeJump: ['KeyC'],
  slingshot: ['KeyX'],
  corner: ['KeyZ'],
  loop: ['KeyL'],
  reelIn: ['KeyV'],
  reelOut: ['KeyB'],
} as const;

export type InputAction = keyof typeof ACTION_BINDINGS;
export interface ActionButtonState {
  held: boolean;
  pressed: boolean;
  released: boolean;
}
export type ActionInputState = Record<InputAction, ActionButtonState> & {
  enabled: boolean;
  moveX: number;
  moveY: number;
  pointerPressure?: number;
  cancelAbilities: boolean;
};
export interface InputPolicy {
  enabled?: boolean;
  disabledActions?: ReadonlySet<InputAction>;
}

const actions = Object.keys(ACTION_BINDINGS) as InputAction[];
const physicalHeld = (raw: RawInputState, code: string) =>
  code.startsWith('Mouse')
    ? raw.buttons.has(Number(code.slice(5)))
    : raw.keys.has(code);

/** Sample once per simulation frame. Never clear raw state to pause gameplay. */
export class InputSystem {
  readonly raw: RawInputState = {
    keys: new Set(),
    buttons: new Set(),
    focused: true,
  };
  private previous = new Set<InputAction>();
  private presses = new Set<string>();
  private releases = new Set<string>();
  private cancelPending = false;

  setKey(code: string, down: boolean): void {
    const wasDown = this.raw.keys.has(code);
    if (down) this.raw.keys.add(code);
    else this.raw.keys.delete(code);
    if (down !== wasDown) (down ? this.presses : this.releases).add(code);
  }

  setButton(button: number, down: boolean): void {
    const wasDown = this.raw.buttons.has(button);
    if (down) this.raw.buttons.add(button);
    else this.raw.buttons.delete(button);
    if (down !== wasDown)
      (down ? this.presses : this.releases).add(`Mouse${button}`);
    if (!this.raw.buttons.size) this.raw.pointerPressure = undefined;
  }

  setPressure(pressure?: number): void {
    this.raw.pointerPressure =
      pressure !== undefined && Number.isFinite(pressure)
        ? Math.max(0, Math.min(1, pressure))
        : undefined;
  }

  /** Teleports/restarts cancel abilities but preserve what the player is holding. */
  resetActions(): void {
    this.previous.clear();
    this.presses.clear();
    this.releases.clear();
    this.cancelPending = true;
  }

  /** Only real focus loss/Escape clears physical state: keyup may never arrive. */
  loseFocus(): void {
    this.raw.focused = false;
    this.raw.keys.clear();
    this.raw.buttons.clear();
    this.raw.pointerPressure = undefined;
    this.resetActions();
  }

  gainFocus(): void {
    this.raw.focused = true;
  }

  sample(policy: InputPolicy = {}): ActionInputState {
    const enabled = (policy.enabled ?? true) && this.raw.focused;
    const next = new Set<InputAction>();
    const result = {} as ActionInputState;
    let cancelAbilities = this.cancelPending;
    for (const action of actions) {
      const permitted = enabled && !policy.disabledActions?.has(action);
      const bindings: readonly string[] = ACTION_BINDINGS[action];
      const held =
        permitted && bindings.some((code) => physicalHeld(this.raw, code));
      const wasHeld = this.previous.has(action);
      // Preserve a down/up occurring between frames. Paused taps are consumed,
      // whereas held buttons create a fresh rising edge on the first GO frame.
      const tapped =
        permitted && bindings.some((code) => this.presses.has(code));
      result[action] = {
        held,
        pressed: permitted && !wasHeld && (held || tapped),
        released:
          permitted &&
          !held &&
          (wasHeld ||
            (tapped && bindings.some((code) => this.releases.has(code)))),
      };
      if (held) next.add(action);
      if (!permitted && wasHeld) cancelAbilities = true;
    }
    result.enabled = enabled;
    result.moveX = Number(result.moveRight.held) - Number(result.moveLeft.held);
    result.moveY =
      Number(result.moveForward.held) - Number(result.moveBack.held);
    result.pointerPressure = result.swing.held
      ? this.raw.pointerPressure
      : undefined;
    result.cancelAbilities = cancelAbilities;
    this.previous = next;
    this.presses.clear();
    this.releases.clear();
    this.cancelPending = false;
    return result;
  }
}

/** Camera-relative action conversion is independent of DOM and race state. */
export function toTraversalInput(
  action: ActionInputState,
  cameraForward: Vector3Like,
  aimDirection: Vector3Like = cameraForward,
): TraversalInput {
  const length = Math.hypot(cameraForward.x, cameraForward.z);
  const forward =
    length > 1e-6
      ? { x: cameraForward.x / length, y: 0, z: cameraForward.z / length }
      : { x: 0, y: 0, z: -1 };
  const scale = 1 / Math.max(1, Math.hypot(action.moveX, action.moveY));
  const zipHeld = action.zip.held || action.pointLaunch.held;
  return {
    move: {
      x: (forward.x * action.moveY - forward.z * action.moveX) * scale,
      y: 0,
      z: (forward.z * action.moveY + forward.x * action.moveX) * scale,
    },
    cameraForward: forward,
    aimDirection,
    jumpPressed: action.jump.pressed,
    jumpHeld: action.jump.held,
    swingPressed: action.swing.pressed,
    swingHeld: action.swing.held,
    swingReleased: action.swing.released,
    zipPressed: action.zip.pressed || action.pointLaunch.pressed,
    zipHeld,
    zipReleased:
      !zipHeld && (action.zip.released || action.pointLaunch.released),
    zipStyle: 'point',
    diveHeld: action.dive.held,
    rollPressed: action.roll.pressed,
    trickPressed: action.trick.pressed,
    wallCrawlPressed: action.wallCrawl.pressed,
    wallClimb: action.moveY,
    wallStrafe: action.moveX,
    glidePressed: action.glide.pressed,
    glidePitch: -action.moveY,
    chargeJumpHeld: action.chargeJump.held,
    chargeJumpReleased: action.chargeJump.released,
    slingshotHeld: action.slingshot.held,
    slingshotReleased: action.slingshot.released,
    cornerHeld: action.corner.held,
    loopHeld: action.loop.held,
    reel: Number(action.reelOut.held) - Number(action.reelIn.held),
    pointerPressure: action.pointerPressure,
    cancelAbilities: action.cancelAbilities,
  };
}
