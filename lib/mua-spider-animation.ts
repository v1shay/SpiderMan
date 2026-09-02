import * as THREE from 'three';
import type { AvatarMotion } from './avatar-animation.ts';
import type { NativeSelection } from './native-animation.ts';
import { freezeClipPose } from './three-assets.ts';

const canonical = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Explicit routing for the new Ultimate Alliance Spider-Man's own Bip01 rig. */
export class MuaSpiderAnimationGraph {
  readonly native: Readonly<Record<string, THREE.AnimationClip>>;
  readonly derived: readonly THREE.AnimationClip[];
  private previousPose = 'idle';

  constructor(source: readonly THREE.AnimationClip[]) {
    const get = (name: string) => {
      const clip = source.find(item => canonical(item.name) === canonical(name));
      if (!clip) throw new Error(`Ultimate Alliance Spider-Man clip missing: ${name}`);
      return clip;
    };
    const standingSource = get('zone_attilan1.zone5');
    const stand = freezeClipPose(standingSource, standingSource.duration, 'mua-native:stand');
    const perchSource = get('idle');
    const perch = freezeClipPose(perchSource, Math.min(.568, perchSource.duration), 'mua-native:perch');
    this.native = {
      stand,
      perch,
      run: get('run'),
      walk: get('walk'),
      jump: get('jump_start'),
      doubleJump: get('jumpdouble_start'),
      swing: get('power_8_loop'),
      zip: get('power_8_start'),
      aerial: get('power_10'),
    };
    this.derived = [stand, perch];
  }

  select(_delta: number, motion: AvatarMotion): NativeSelection | undefined {
    if (motion.lobby) {
      this.previousPose = motion.pose;
      return { clip: this.native.stand, loop: THREE.LoopRepeat, rate: 1 };
    }
    // The facade-calibrated crawl remains authoritative. The supplied idle is
    // an excellent compact rooftop crouch, while the final zone pose is its
    // clean authored standing stance. Avoid power_4_end here: it contains a
    // three-metre cinematic root drop intended for a fixed game camera.
    if (motion.pose === 'crawl' || motion.pose === 'wall') {
      this.previousPose = motion.pose;
      return undefined;
    }
    const once = (clip: THREE.AnimationClip, rate = 1): NativeSelection => ({ clip, loop: THREE.LoopOnce, rate });
    let selection: NativeSelection | undefined;
    switch (motion.pose) {
      case 'idle': selection = { clip: this.native.stand, loop: THREE.LoopRepeat, rate: 1 }; break;
      case 'perch': selection = { clip: this.native.perch, loop: THREE.LoopRepeat, rate: 1 }; break;
      case 'run': selection = { clip: this.native.run, loop: THREE.LoopRepeat, rate: THREE.MathUtils.clamp((motion.speed ?? 8) / 9, .7, 1.7) }; break;
      case 'jump': selection = once(['swing', 'zip'].includes(this.previousPose) ? this.native.doubleJump : this.native.jump, 1.08); break;
      case 'backflip': selection = once(this.native.doubleJump, 1.12); break;
      case 'swing': selection = { clip: this.native.swing, loop: THREE.LoopRepeat, rate: 1 }; break;
      case 'zip': selection = once(this.native.zip, 1.2); break;
      case 'fall': selection = once(this.native.aerial, .9); break;
      case 'dive': selection = once(this.native.aerial, 1.15); break;
      default: selection = undefined;
    }
    this.previousPose = motion.pose;
    return selection;
  }
}
