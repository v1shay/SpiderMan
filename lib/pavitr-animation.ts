import * as THREE from 'three';
import type { AvatarMotion } from './avatar-animation.ts';
import { nativeSegment, type NativeSelection } from './native-animation.ts';

const canonical = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
export const PAVITR_SEGMENTS = {
  leap: ['specialintro', 0, 1.5],
  releaseFlip: ['entry', .95, 2.12],
  releaseTurn: ['basicsidehandspringrm', .28, 1.52],
  swing: ['speciala', 0, 2.0333333],
  zip: ['ultimateflyoffscreen', .12, .86],
  fall: ['dropin', 0, .43],
  landing: ['dropin', .43, 1.1333333],
  dive: ['speciald', 0, .82],
} as const;

/** Pavitr's exporter uses combat-sequence names, not generic Jump/Swing names.
 * Route visually inspected native sections explicitly, without changing physics.
 */
export class PavitrAnimationGraph {
  readonly derived: THREE.AnimationClip[] = [];
  readonly segments: Record<keyof typeof PAVITR_SEGMENTS, THREE.AnimationClip>;
  private entry: THREE.AnimationClip;
  private firstFrame = true;
  private entryTime = Infinity;
  private landingTime = Infinity;
  private wasGrounded = true;
  private wasLobby = false;
  private previousPose = 'idle';
  private release?: THREE.AnimationClip;
  private releaseTime = Infinity;
  private releaseCount = 0;

  constructor(source: readonly THREE.AnimationClip[]) {
    const get = (suffix: string) => {
      const clip = source.find(clip => canonical(clip.name) === `armatureanimspidermanpavitr${suffix}`);
      if (!clip) throw new Error(`Pavitr native clip missing: ${suffix}`);
      return clip;
    };
    this.entry = get('entry');
    this.segments = Object.fromEntries(Object.entries(PAVITR_SEGMENTS).map(([role, [suffix, start, end]]) => {
      const clip = nativeSegment(get(suffix), start, end, `pavitr-native:${role}`);
      this.derived.push(clip);
      return [role, clip];
    })) as typeof this.segments;
  }

  select(delta: number, motion: AvatarMotion): NativeSelection | undefined {
    const stationary = motion.pose === 'idle' || motion.pose === 'perch';
    if (this.firstFrame) {
      if (motion.lobby || motion.grounded && stationary) this.entryTime = 0;
      this.firstFrame = false;
    }
    // Selection can happen long after the showroom loaded. Show his entry at
    // that moment too, instead of making it a one-time offscreen event.
    if (motion.lobby && !this.wasLobby) this.entryTime = 0;
    if (!motion.lobby && this.wasLobby) this.entryTime = Infinity;
    this.wasLobby = Boolean(motion.lobby);
    if (!motion.lobby && (!motion.grounded || !stationary)) this.entryTime = Infinity;
    if (!motion.lobby && !this.wasGrounded && motion.grounded && stationary) this.landingTime = 0;
    if (!motion.grounded || !stationary) this.landingTime = Infinity;
    if (!motion.grounded && ['jump', 'fall'].includes(motion.pose) && ['swing', 'zip'].includes(this.previousPose)) {
      this.release = this.releaseCount++ % 2 ? this.segments.releaseTurn : this.segments.releaseFlip;
      this.releaseTime = 0;
    }
    if (motion.grounded || !['jump', 'fall'].includes(motion.pose)) { this.releaseTime = Infinity; this.release = undefined; }
    this.wasGrounded = motion.grounded;
    this.previousPose = motion.pose;
    const once = (clip: THREE.AnimationClip, rate = 1, bodySupport = false): NativeSelection => ({ clip, loop: THREE.LoopOnce, rate, bodySupport });
    if (this.entryTime < this.entry.duration) {
      this.entryTime += delta;
      return once(this.entry, 1, true);
    }
    if (motion.lobby) return undefined;
    if (this.landingTime < this.segments.landing.duration) {
      this.landingTime += delta;
      return once(this.segments.landing, 1, true);
    }
    if (this.release && this.releaseTime < this.release.duration) {
      this.releaseTime += delta;
      return once(this.release);
    }
    if (this.release) return { clip: this.segments.fall, loop: THREE.LoopPingPong, rate: .55 };
    switch (motion.pose) {
      case 'jump': return once(this.segments.leap);
      case 'zip': return once(this.segments.zip, 1.3);
      case 'fall': return { clip: this.segments.fall, loop: THREE.LoopPingPong, rate: .55 };
      case 'dive': return once(this.segments.dive);
      case 'swing': return { clip: this.segments.swing, loop: THREE.LoopPingPong, rate: .7 + (motion.tension ?? 0) * .4 };
      default: return undefined;
    }
  }
}
