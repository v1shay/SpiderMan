import * as THREE from 'three';
import type { AvatarMotion } from './avatar-animation.ts';
import type { NativeSelection } from './native-animation.ts';

const canonical = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * These are the authored clips the pre-graph avatar router used for Symbiote
 * traversal. Keep the routes explicit: the newer shared spawn and wall-crawl
 * animations intentionally are not part of this graph.
 */
export const SYMBIOTE_NATIVE_ROUTES = {
  jump: 'Flying Knee Punch Combo',
  backflip: 'Swing to Land',
  dive: 'Flying Knee Punch Combo',
  swing: 'Swing to Land',
  zip: 'Swing to Land',
  fall: 'Swing to Land',
} as const;

type SymbioteNativePose = keyof typeof SYMBIOTE_NATIVE_ROUTES;

/**
 * Restore Symbiote's original traversal playback without retargeting,
 * subclipping, resampling, or replacing the shared crawl/spawn animations.
 * Returning the same clip across swing/zip/fall also preserves the authored
 * flip's phase when traversal changes state at the top of an arc.
 */
export class SymbioteAnimationGraph {
  readonly clips: Readonly<Record<SymbioteNativePose, THREE.AnimationClip>>;

  constructor(source: readonly THREE.AnimationClip[]) {
    const exact = (name: string) => {
      const clip = source.find(item => canonical(item.name) === canonical(name));
      if (!clip) throw new Error(`Symbiote native clip missing: ${name}`);
      return clip;
    };
    const knee = exact(SYMBIOTE_NATIVE_ROUTES.jump);
    const swing = exact(SYMBIOTE_NATIVE_ROUTES.swing);
    this.clips = {
      jump: knee,
      backflip: swing,
      dive: knee,
      swing,
      zip: swing,
      fall: swing,
    };
  }

  select(_delta: number, motion: AvatarMotion): NativeSelection | undefined {
    // Spawn/showroom and the new shared wall traversal stay authoritative.
    if (motion.lobby || motion.pose === 'crawl' || motion.pose === 'wall') return undefined;
    const clip = this.clips[motion.pose as SymbioteNativePose];
    if (!clip) return undefined;
    // The old router played both complete authored actions as repeating clips.
    // That complete playback contains the swing somersault and knee-flip beats
    // the user asked to restore; truncating either action loses those poses.
    const tension = THREE.MathUtils.clamp(motion.tension ?? 0, 0, 1);
    return {
      clip,
      loop: motion.pose === 'backflip' ? THREE.LoopOnce : THREE.LoopRepeat,
      rate: motion.pose === 'swing' ? .9 + tension * .2 : 1,
    };
  }
}
