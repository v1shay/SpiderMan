import * as THREE from 'three';
import type { AvatarMotion } from './avatar-animation.ts';
import { nativeSegment, type NativeSelection } from './native-animation.ts';

// These intervals were reviewed visually in all 36 supplied clips. Attack
// follow-throughs and the disappearing part of power_9 are intentionally excluded.
export const IRONMAN_SEGMENTS = {
  coil: ['power_5', .12, .50],
  rise: ['power_13', .15, .74],
  ignite: ['fly_slow', 0, .40],
  boost: ['attack_heavy1', .10, .3333333],
  redirect: ['power_14', .16, .48],
  tuck: ['power_7', .60, 1.17],
  drift: ['jump_start', .50, 1.10],
  landing: ['power_6', .62, 1.20],
} as const;

export class IronManAnimationGraph {
  readonly derived: THREE.AnimationClip[];
  readonly segments: Record<keyof typeof IRONMAN_SEGMENTS, THREE.AnimationClip>;
  private source: Map<string, THREE.AnimationClip>;
  private previousGrounded = true;
  private previousPowered = false;
  private previousBoost = false;
  private previousLobby = false;
  private lobbyTime = 0;
  private sequence: { clip: THREE.AnimationClip; rate: number }[] = [];
  private sequenceTime = 0;
  private sequenceKind: 'powered' | 'fall' | 'landing' | null = null;
  private fast = false;
  /** Fade outer cruise pitch in only after the upright launch section. */
  cruiseBlend = 0;

  constructor(clips: readonly THREE.AnimationClip[]) {
    this.source = new Map(clips.map(clip => [clip.name, clip]));
    this.segments = Object.fromEntries(Object.entries(IRONMAN_SEGMENTS).map(([role, [name, start, end]]) => {
      const source = this.source.get(name);
      if (!source) throw new Error(`Iron Man native clip missing: ${name}`);
      return [role, nativeSegment(source, start, end, `ironman-native:${role}`)];
    })) as typeof this.segments;
    for (const name of ['menu_idle', 'menu_action', 'menu_goodbye', 'fly_idle', 'fly_slow', 'fly_fast', 'jump_start']) {
      if (!this.source.has(name)) throw new Error(`Iron Man native clip missing: ${name}`);
    }
    this.derived = Object.values(this.segments);
  }

  private start(kind: typeof this.sequenceKind, roles: (keyof typeof IRONMAN_SEGMENTS)[]) {
    this.sequenceKind = kind;
    this.sequenceTime = 0;
    this.sequence = roles.map(role => ({ clip: this.segments[role], rate: role === 'coil' ? 1.8 : role === 'rise' ? 1.4 : 1.15 }));
  }

  select(delta: number, motion: AvatarMotion): NativeSelection | undefined {
    const powered = !motion.grounded && (motion.pose === 'hover' || motion.pose === 'fly');
    const boost = motion.boost ?? (motion.pose === 'fly' && (motion.speed ?? 0) > 62);
    const stationary = motion.pose === 'idle' || motion.pose === 'perch';
    if (!motion.lobby) {
      if (powered && this.previousGrounded) this.start('powered', ['coil', 'rise', 'ignite']);
      else if (powered && !this.previousPowered) this.start('powered', ['boost', 'ignite']);
      else if (powered && boost && !this.previousBoost) this.start('powered', ['redirect']);
      else if (!powered && this.previousPowered && !motion.grounded) this.start('fall', ['tuck']);
      else if (motion.grounded && !this.previousGrounded && stationary) this.start('landing', ['landing']);
      if (this.sequenceKind === 'powered' && !powered || this.sequenceKind === 'fall' && (powered || motion.grounded)
        || this.sequenceKind === 'landing' && (!motion.grounded || !stationary)) this.sequence = [];
    } else this.sequence = [];
    this.previousGrounded = motion.grounded;
    this.previousPowered = powered;
    this.previousBoost = boost;
    if (motion.lobby && !this.previousLobby) this.lobbyTime = 0;
    this.previousLobby = Boolean(motion.lobby);
    this.lobbyTime += delta;
    const selection = (clip: THREE.AnimationClip, loop: NativeSelection['loop'] = THREE.LoopRepeat, rate = 1, bodySupport = false): NativeSelection => ({ clip, loop, rate, bodySupport });
    const source = (name: string) => this.source.get(name)!;
    const cruiseReady = this.sequence.length === 0 || this.sequence[0].clip === this.segments.redirect;
    this.cruiseBlend = THREE.MathUtils.damp(this.cruiseBlend, motion.pose === 'fly' && powered && cruiseReady ? 1 : 0, 5, delta);
    if (motion.lobby) {
      if (this.lobbyTime < 2.5) return selection(source('menu_goodbye'), THREE.LoopOnce);
      const cycle = (this.lobbyTime - 2.5) % 12;
      return cycle > 3 && cycle < 4.5 ? selection(source('menu_action'), THREE.LoopOnce) : selection(source('menu_idle'));
    }
    if (this.sequence.length) {
      const next = this.sequence[0];
      this.sequenceTime += delta * next.rate;
      if (this.sequenceTime >= next.clip.duration) { this.sequence.shift(); this.sequenceTime = 0; }
      return selection(next.clip, THREE.LoopOnce, next.rate, this.sequenceKind === 'landing');
    }
    if (motion.grounded) return stationary ? selection(source('menu_idle')) : undefined;
    if (motion.pose === 'hover') return selection(source((motion.speed ?? 0) > 6 ? 'fly_slow' : 'fly_idle'));
    if (motion.pose === 'fly') {
      if ((motion.speed ?? 0) > 50 || boost) this.fast = true;
      else if ((motion.speed ?? 0) < 42) this.fast = false;
      return selection(source(this.fast ? 'fly_fast' : 'fly_slow'), THREE.LoopRepeat, boost ? 1.2 : 1);
    }
    if (motion.pose === 'jump') return selection(source('jump_start'), THREE.LoopOnce);
    if (motion.pose === 'fall' || motion.pose === 'dive') return selection(this.segments.drift, THREE.LoopPingPong, .7);
    return undefined;
  }
}
