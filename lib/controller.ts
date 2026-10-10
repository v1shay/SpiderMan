import type { InputAction } from './input-system';

export const CONTROLLER_DEFAULTS: Record<InputAction, number[]> = {
  moveForward: [], moveBack: [], moveLeft: [], moveRight: [],
  aim: [6], swing: [7], zip: [6, 7], pointLaunch: [6, 0], jump: [0],
  dive: [10], roll: [1], trick: [2], wallCrawl: [6, 3], glide: [3],
  chargeJump: [7, 0], slingshot: [4, 6], corner: [7, 1], loop: [4, 7],
  reelIn: [12], reelOut: [13], attack: [2], heavy: [4, 2], launcher: [4, 0],
  grab: [3], dodge: [1], block: [4], web: [5], taunt: [15], interact: [14],
};
export type ControllerSettings = {
  bindings: Record<InputAction, number[]>;
  deadzone: number; sensitivity: number; invertY: boolean;
  moveAxes: [number, number]; lookAxes: [number, number];
};
export const defaultControllerSettings = (): ControllerSettings => ({
  bindings: structuredClone(CONTROLLER_DEFAULTS), deadzone: .15, sensitivity: 2.4,
  invertY: false, moveAxes: [0, 1], lookAxes: [2, 3],
});
const KEY = 'spiderman-controller-v1';
export function loadControllerSettings(): ControllerSettings {
  const defaults = defaultControllerSettings();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!saved) return defaults;
    for (const action of Object.keys(defaults.bindings) as InputAction[]) {
      const binding = saved.bindings?.[action];
      if (Array.isArray(binding) && binding.length <= 3 && binding.every((v: unknown) => Number.isInteger(v) && Number(v) >= 0 && Number(v) < 64)) defaults.bindings[action] = binding;
    }
    for (const field of ['deadzone', 'sensitivity'] as const) {
      if (Number.isFinite(saved[field])) defaults[field] = Math.max(field === 'deadzone' ? .05 : .3, Math.min(field === 'deadzone' ? .4 : 6, saved[field]));
    }
    defaults.invertY = saved.invertY === true;
    for (const field of ['moveAxes', 'lookAxes'] as const) {
      if (Array.isArray(saved[field]) && saved[field].length === 2 && saved[field].every((v: unknown) => Number.isInteger(v) && Number(v) >= 0 && Number(v) < 16)) defaults[field] = [saved[field][0], saved[field][1]];
    }
  } catch { /* Storage is optional. */ }
  return defaults;
}
export function saveControllerSettings(settings: ControllerSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* Session settings still work. */ }
  window.dispatchEvent(new CustomEvent('controller-settings', { detail: settings }));
}
export function stick(x = 0, y = 0, deadzone = .15) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  const length = Math.hypot(x, y);
  if (length <= deadzone) return { x: 0, y: 0 };
  const scale = Math.min(1, (length - deadzone) / (1 - deadzone)) / length;
  return { x: x * scale, y: y * scale };
}
export function controllerName(id: string) { return /dualsense|dualshock|playstation|054c/i.test(id) ? 'PlayStation' : /xbox|xinput|045e/i.test(id) ? 'Xbox' : 'Controller'; }
export function buttonName(button: number, family = 'Xbox') {
  const xbox = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS click', 'RS click', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'Home'];
  const ps = ['Cross', 'Circle', 'Square', 'Triangle', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'PS', 'Touchpad'];
  return (family === 'PlayStation' ? ps : xbox)[button] ?? `Button ${button}`;
}
export function readController(pad: Pick<Gamepad, 'buttons' | 'axes'> | null, settings: ControllerSettings, combat = false, grounded = false) {
  const held = new Set<InputAction>();
  const pressed = (i: number) => Boolean(pad?.buttons[i]?.pressed || (pad?.buttons[i]?.value ?? 0) > .55);
  const combatActions = new Set(['attack','heavy','launcher','grab','dodge','block','web','taunt']);
  const entries = (Object.entries(settings.bindings) as [InputAction, number[]][]).filter(([action]) => {
    if (combatActions.has(action)) return combat;
    if (combat && ['trick','roll','glide','wallCrawl','chargeJump','slingshot','corner','loop'].includes(action)) return false;
    if (action === 'chargeJump') return grounded;
    return true;
  }).sort((a, b) => b[1].length - a[1].length);
  const consumed = new Set<number>();
  for (const [action, buttons] of entries) {
    if (buttons.length && buttons.every(pressed) && !buttons.some(i => consumed.has(i))) {
      held.add(action); buttons.forEach(i => consumed.add(i));
    }
  }
  const move = stick(pad?.axes[settings.moveAxes[0]], pad?.axes[settings.moveAxes[1]], settings.deadzone);
  const look = stick(pad?.axes[settings.lookAxes[0]], pad?.axes[settings.lookAxes[1]], settings.deadzone);
  return { held, moveX: move.x, moveY: -move.y, lookX: look.x, lookY: look.y * (settings.invertY ? -1 : 1) };
}
