export type CombatVector = { x: number; y: number; z: number };
export const cv = (x = 0, y = 0, z = 0): CombatVector => ({ x, y, z });
export const cadd = (a: CombatVector, b: CombatVector) => cv(a.x + b.x, a.y + b.y, a.z + b.z);
export const csub = (a: CombatVector, b: CombatVector) => cv(a.x - b.x, a.y - b.y, a.z - b.z);
export const cmul = (a: CombatVector, n: number) => cv(a.x * n, a.y * n, a.z * n);
export const clen = (a: CombatVector) => Math.hypot(a.x, a.y, a.z);
export const cunit = (a: CombatVector) => cmul(a, 1 / Math.max(.0001, clen(a)));

/** Continuous segment/sphere overlap; fast missiles cannot skip a hurtbox. */
export function sweptSphereHit(from: CombatVector, to: CombatVector, center: CombatVector, radius: number) {
  const direction = csub(to, from), target = csub(center, from);
  const denominator = direction.x ** 2 + direction.y ** 2 + direction.z ** 2;
  const t = denominator > 1e-9 ? Math.max(0, Math.min(1, (target.x * direction.x + target.y * direction.y + target.z * direction.z) / denominator)) : 0;
  return clen(csub(cadd(from, cmul(direction, t)), center)) <= radius;
}

export type AttackTiming = { startup: number; active: number; recovery: number };
export type CombatAttackKind = 'light' | 'heavy' | 'launcher' | 'airLight' | 'airHeavy' | 'grab' | 'webShot';
export type PlayerCombatAction = CombatAttackKind | 'dodge' | 'block' | 'webPull' | 'taunt' | 'hit' | 'defeated' | 'idle';
export type PlayerCombatInput = {
  lightPressed?: boolean;
  heavyPressed?: boolean;
  launcherPressed?: boolean;
  grabPressed?: boolean;
  dodgePressed?: boolean;
  blockHeld?: boolean;
  webPressed?: boolean;
  webHeld?: boolean;
  tauntPressed?: boolean;
  grounded?: boolean;
};
export type AttackClock = { elapsed: number; previous: number; hits: Set<string>; fired: boolean };
export const createAttackClock = (): AttackClock => ({ elapsed: 0, previous: 0, hits: new Set(), fired: false });
export function advanceAttack(clock: AttackClock, seconds: number) { clock.previous = clock.elapsed; clock.elapsed += Math.max(0, seconds); }
export function attackStage(clock: AttackClock, timing: AttackTiming) {
  return clock.elapsed < timing.startup ? 'startup' : clock.elapsed < timing.startup + timing.active ? 'active'
    : clock.elapsed < timing.startup + timing.active + timing.recovery ? 'recovery' : 'complete';
}
/** Interval overlap handles a timestep that crosses an entire narrow hit window. */
export function canAttackHit(clock: AttackClock, timing: AttackTiming, target: string) {
  return clock.elapsed >= timing.startup && clock.previous < timing.startup + timing.active && !clock.hits.has(target);
}
export function registerAttackHit(clock: AttackClock, target: string) { clock.hits.add(target); }

export class PlayerCombatState {
  health = 100;
  attack: AttackClock | null = null;
  attackKind: CombatAttackKind = 'light';
  comboIndex = 0;
  private bufferedAttack: CombatAttackKind | null = null;
  private comboGrace = 0;
  dodge = 0;
  dodgeCooldown = 0;
  hurtCooldown = 0;
  blocking = false;
  webPulling = false;
  webPullElapsed = 0;
  taunt = 0;
  lastDamageBlocked = false;
  readonly timings: Readonly<Record<CombatAttackKind, readonly AttackTiming[]>> = {
    light: [
      { startup: .16, active: .15, recovery: .24 },
      { startup: .18, active: .16, recovery: .27 },
      { startup: .21, active: .17, recovery: .31 },
      { startup: .24, active: .2, recovery: .38 },
    ],
    heavy: [
      { startup: .3, active: .2, recovery: .48 },
      { startup: .34, active: .22, recovery: .52 },
      { startup: .39, active: .24, recovery: .58 },
      { startup: .44, active: .28, recovery: .66 },
    ],
    launcher: [
      { startup: .3, active: .2, recovery: .52 },
      { startup: .38, active: .24, recovery: .58 },
    ],
    airLight: [
      { startup: .18, active: .2, recovery: .34 },
      { startup: .24, active: .22, recovery: .4 },
    ],
    airHeavy: [
      { startup: .3, active: .26, recovery: .52 },
      { startup: .38, active: .3, recovery: .6 },
    ],
    grab: [
      { startup: .42, active: .28, recovery: .7 },
      { startup: .5, active: .34, recovery: .78 },
    ],
    webShot: [{ startup: .14, active: .16, recovery: .24 }],
  };
  get timing() {
    const choices = this.timings[this.attackKind];
    return choices[this.comboIndex % choices.length];
  }
  get attackDamage() {
    const step = this.comboIndex;
    switch (this.attackKind) {
      case 'light': return 8 + step * 2;
      case 'heavy': return 15 + step * 3;
      case 'launcher': return 18 + step * 4;
      case 'airLight': return 11 + step * 3;
      case 'airHeavy': return 19 + step * 4;
      case 'grab': return 25 + step * 5;
      case 'webShot': return 0;
    }
  }
  get attackReach() {
    return this.attackKind === 'grab' ? 3.4 : this.attackKind === 'heavy' || this.attackKind === 'airHeavy' ? 5.2 : 4.7;
  }
  private beginAttack(kind: CombatAttackKind, index = 0) {
    const sameFamily = kind === this.attackKind;
    this.attackKind = kind;
    this.comboIndex = index % this.timings[kind].length;
    this.attack = createAttackClock();
    this.bufferedAttack = null;
    this.comboGrace = 1;
    this.blocking = false;
    this.taunt = 0;
    if (!sameFamily) this.comboIndex = index % this.timings[kind].length;
  }
  step(dt: number, inputOrAttack: PlayerCombatInput | boolean, legacyDodgePressed = false) {
    const input: PlayerCombatInput = typeof inputOrAttack === 'boolean'
      ? { lightPressed: inputOrAttack, dodgePressed: legacyDodgePressed, grounded: true }
      : inputOrAttack;
    this.dodge = Math.max(0, this.dodge - dt);
    this.dodgeCooldown = Math.max(0, this.dodgeCooldown - dt);
    this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);
    this.comboGrace = Math.max(0, this.comboGrace - dt);
    this.taunt = Math.max(0, this.taunt - dt);
    this.blocking = Boolean(input.blockHeld && this.health > 0 && this.dodge <= 0 && !this.attack);
    this.webPulling = Boolean(input.webHeld && this.health > 0 && this.dodge <= 0 && !this.blocking);
    this.webPullElapsed = this.webPulling ? this.webPullElapsed + dt : 0;
    if (input.dodgePressed && this.dodgeCooldown <= 0 && this.health > 0) {
      this.dodge = .62; this.dodgeCooldown = .9; this.attack = null;
      this.bufferedAttack = null; this.blocking = false; this.webPulling = false;
    } else if (this.health > 0 && this.dodge <= 0 && !this.blocking) {
      const grounded = input.grounded !== false;
      const requested: CombatAttackKind | null = input.grabPressed ? 'grab'
        : input.launcherPressed ? 'launcher'
          : input.heavyPressed ? (grounded ? 'heavy' : 'airHeavy')
            : input.lightPressed ? (grounded ? 'light' : 'airLight')
              : input.webPressed ? 'webShot' : null;
      if (requested) {
        if (!this.attack) {
          const continueCombo = this.comboGrace > 0 && requested === this.attackKind;
          this.beginAttack(requested, continueCombo ? this.comboIndex + 1 : 0);
        } else if (this.attack.elapsed >= this.timing.startup * .55) this.bufferedAttack = requested;
      } else if (input.tauntPressed && !this.attack && !this.webPulling) this.taunt = 1.8;
    }
    if (this.attack) {
      advanceAttack(this.attack, dt);
      if (attackStage(this.attack, this.timing) === 'complete') {
        if (this.bufferedAttack) {
          const next = this.bufferedAttack;
          this.beginAttack(next, next === this.attackKind ? this.comboIndex + 1 : 0);
        }
        else { this.attack = null; this.comboGrace = .82; }
      }
    } else if (this.comboGrace === 0) this.comboIndex = 0;
  }
  damage(amount: number) {
    if (this.dodge > 0 || this.hurtCooldown > 0 || this.health <= 0) return false;
    this.lastDamageBlocked = this.blocking;
    const applied = Math.max(0, amount) * (this.blocking ? .18 : 1);
    this.health = Math.max(0, this.health - applied);
    this.hurtCooldown = this.blocking ? .22 : .9;
    if (!this.blocking) this.attack = null;
    this.bufferedAttack = null;
    return true;
  }
}
