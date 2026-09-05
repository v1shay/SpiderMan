import * as THREE from 'three';
import type { AvatarMotion } from './avatar-animation';
import { nativeSegment, type NativeSelection } from './native-animation.ts';

/** Browser equivalent of the reference's contextual catalog/selector. Clips
 * never own translation. Randomness only breaks ties inside safe families. */
export class ContextualAnimationGraph {
  readonly derived: THREE.AnimationClip[] = [];
  readonly history: string[] = [];
  private library = new Map<string, THREE.AnimationClip>();
  private previous = '';
  private grounded = true;
  private sequence = -1;
  private clock = 0;
  private stateTime = 0;
  private active?: NativeSelection;
  private activeUntil = 0;
  private seed = 2099;
  private nextTrick = 0;
  private shortHop = false;
  private swingVariant = 'Swinging';
  private crawlVariant = 'wall-crawl-slow';
  private idleVariant = 'Idle';
  private idleAfter = 0;
  private lastTrickRequest = -1;

  constructor(clips: readonly THREE.AnimationClip[]) {
    for (const clip of clips) if (clip.name.startsWith('mixamo:')) this.library.set(clip.name.slice(7), clip);
    const section = (source: string, start: number, end: number, name: string) => {
      const clip = this.library.get(source);
      if (!clip) return;
      const part = nativeSegment(clip, start * clip.duration, end * clip.duration, `context:${name}`);
      this.library.set(name, part); this.derived.push(part);
    };
    // Phase windows keep source landings out of attached swings and the
    // standing wind-up out of a launch that already happened in physics.
    section('Start Swinging', .22, .78, 'web-catch');
    section('Swinging', .18, .75, 'swing-a');
    section('Swinging (1)', .18, .75, 'swing-b');
    section('Stylish Flip', .2, .72, 'swing-style');
    section('Wall Run', .17, .64, 'wall-run');
    section('Running Crawl', .15, .78, 'wall-crawl-fast');
    section('Low Crawl', .18, .75, 'wall-crawl-slow');
    section('Jumping To Hanging', .6, .85, 'mantle-reach');
    section('Falling To Landing', .12, .85, 'soft-land');
    section('Running Jump', .2, .68, 'running-takeoff');
    for (const name of ['Jumping', 'Jumping (1)', 'Jumping (2)', 'Jumping (3)']) section(name, .22, .66, `${name}-air`);
    for (const name of ['Swing To Land', 'Swing To Land (1)', 'Swing To Land (2)', 'Swing To Land (3)']) section(name, .62, .96, `${name}-contact`);
  }

  private choose(names: string[]) {
    const available = names.filter(name => this.library.has(name));
    const unused = available.filter(name => !this.history.slice(-3).includes(name));
    const pool = unused.length ? unused : available.filter(name => name !== this.history.at(-1));
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    const name = (pool.length ? pool : available)[this.seed % Math.max(1, pool.length || available.length)];
    if (name) { this.history.push(name); if (this.history.length > 32) this.history.shift(); }
    return name;
  }

  private selection(name: string, rate = 1, loop: NativeSelection['loop'] = THREE.LoopOnce, bodySupport = false): NativeSelection | undefined {
    const clip = this.library.get(name);
    return clip ? { clip, rate, loop, bodySupport } : undefined;
  }

  private commit(names: string[], seconds?: number, bodySupport = false) {
    const name = this.choose(names);
    if (!name) return undefined;
    const clip = this.library.get(name)!;
    const rate = seconds ? THREE.MathUtils.clamp(clip.duration / seconds, .65, 2.4) : 1;
    this.active = this.selection(name, rate, THREE.LoopOnce, bodySupport);
    this.activeUntil = this.clock + clip.duration / rate;
    return this.active;
  }

  select(delta: number, motion: AvatarMotion): NativeSelection | undefined {
    this.clock += delta;
    const mode = motion.mode ?? motion.pose;
    const changed = this.previous !== mode;
    const landed = !this.grounded && motion.grounded;
    const released = ['swing', 'zip', 'webZip'].includes(this.previous) && !motion.grounded && ['jump', 'fall', 'pointLaunch'].includes(mode);
    const takeoff = this.grounded && !motion.grounded;
    const newAction = motion.actionSequence !== undefined && motion.actionSequence !== this.sequence;
    const doubleJump = mode === 'doubleJump' && (changed || newAction);
    this.stateTime = changed ? 0 : this.stateTime + delta;
    this.previous = mode; this.grounded = motion.grounded; this.sequence = motion.actionSequence ?? -1;
    const speed = motion.speed ?? 0;
    const air = motion.timeToLanding ?? 0;
    const clearance = motion.trickClearance ?? false;
    if (motion.lobby) return undefined;
    if (takeoff) this.shortHop = air < 1.5;
    if (doubleJump || released || motion.grounded || mode === 'swing' || air > 1.6) this.shortHop = false;

    if (mode === 'swing') {
      this.active = undefined;
      if (changed) this.swingVariant = this.choose(['swing-a', 'swing-b', 'swing-style']) ?? 'swing-a';
      if (this.stateTime < .2) return this.selection('web-catch', 1.6);
      const selection = this.selection(this.swingVariant, 0, THREE.LoopRepeat);
      if (selection) selection.time = selection.clip.duration * THREE.MathUtils.clamp(.5 + (motion.verticalSpeed ?? 0) / 58, .03, .97);
      return selection;
    }
    if (mode === 'wallRun' || mode === 'wall') {
      this.active = undefined;
      return this.selection('wall-run', THREE.MathUtils.clamp(speed / 9, .75, 1.8), THREE.LoopPingPong);
    }
    if (mode === 'wallCrawl' || mode === 'crawl') {
      this.active = undefined;
      if (speed > .1) this.crawlVariant = speed > 2.4 ? 'wall-crawl-fast' : 'wall-crawl-slow';
      return this.selection(this.crawlVariant, Math.min(1.25, speed / 2.7) * (motion.crawlDirection ?? 1), THREE.LoopRepeat);
    }
    if (mode === 'mantle') { this.active = undefined; return this.selection('mantle-reach', .6); }
    if (mode === 'webZip' || mode === 'zip') { this.active = undefined; return this.selection('web-catch', 1.4); }
    if (mode === 'dive') { this.active = undefined; return this.selection('Falling', .8, THREE.LoopPingPong); }

    if (motion.grounded) {
      if ((changed && mode === 'roll') || landed && mode === 'roll') this.commit(['Falling To Roll', 'Run To Rolling', 'Quick Roll To Run'], .8, true);
      else if (landed) this.commit(speed > 8 ? ['Swing To Land-contact', 'Swing To Land (1)-contact', 'Swing To Land (2)-contact', 'Swing To Land (3)-contact'] : ['soft-land'], .38, true);
      if (this.active?.bodySupport && this.clock < this.activeUntil && (mode === 'roll' || speed < 2 || this.clock < this.activeUntil - .12)) return this.active;
      this.active = undefined;
      if (speed > .6) {
        const strafe = motion.moveStrafe ?? 0, forward = motion.moveForward ?? 1;
        const name = speed > 5 ? 'Running' : forward < -.2 ? 'Walk Backward' : strafe < -.2 ? 'Left Strafe Walking' : strafe > .2 ? 'Right Strafe Walking' : 'Walking';
        return this.selection(name, THREE.MathUtils.clamp(speed / (name === 'Running' ? 9 : 2.4), .6, 1.7), THREE.LoopRepeat);
      }
      if (mode === 'perch') return this.selection('Male Crouch Pose', 0, THREE.LoopRepeat);
      if (this.clock > this.idleAfter) { this.idleVariant = this.choose(['Idle', 'Breathing Idle', 'Happy Idle']) ?? 'Idle'; this.idleAfter = this.clock + 6; }
      return this.selection(this.idleVariant, 1, THREE.LoopRepeat);
    }

    if (takeoff || doubleJump || released) { this.active = undefined; this.nextTrick = this.clock + .35; }
    // Whole rotations must fit before the predicted collision plus blend-out.
    // Interrupted by actual wall, web or ground contact above on the same frame.
    const explicitTrick = (motion.trickRequest ?? 0) !== this.lastTrickRequest;
    this.lastTrickRequest = motion.trickRequest ?? 0;
    const wantsTrick = doubleJump || released || explicitTrick || (this.clock > this.nextTrick && air > 1.7);
    if (!this.active && wantsTrick && clearance && air > .78) {
      const names = ['Backflip', 'Front Flip', 'Front Twist Flip'];
      if (speed > 8 && air > 1.4) names.push('Running Forward Flip', 'Run To Flip');
      if (air > 1.8) names.push('Butterfly Twirl', 'Aerial Evade', 'Corkscrew Evade', 'Big Jump');
      const eligible = names.filter(name => (this.library.get(name)?.duration ?? 99) / 2.4 + .12 < air);
      if (eligible.length) { this.commit(eligible, Math.min(1.15, air - .22)); this.nextTrick = this.activeUntil + .22; }
    }
    if (!this.active && takeoff) this.commit(speed > 6 ? ['running-takeoff'] : ['Jumping-air', 'Jumping (1)-air', 'Jumping (2)-air', 'Jumping (3)-air'], .45);
    if (this.active && this.clock < this.activeUntil && air > .12) return this.active;
    this.active = undefined;
    if (this.shortHop || air < .65) {
      const ready = this.selection('Jumping (1)-air', 0);
      if (ready) ready.time = ready.clip.duration * .88;
      return ready;
    }
    return this.selection('Falling', .65, THREE.LoopPingPong);
  }
}
