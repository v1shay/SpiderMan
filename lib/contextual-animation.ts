import * as THREE from 'three';
import type { AvatarMotion } from './avatar-animation';
import { nativeSegment, type NativeSelection } from './native-animation.ts';
import { closeWallRunLoop } from './looped-wall-run.ts';

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
    for (const clip of clips)
      if (clip.name.startsWith('mixamo:'))
        this.library.set(clip.name.slice(7), clip);
    const section = (
      source: string,
      start: number,
      end: number,
      name: string,
    ) => {
      const clip = this.library.get(source);
      if (!clip) return;
      const segment = nativeSegment(
        clip,
        start * clip.duration,
        end * clip.duration,
        `context:${name}`,
      );
      const part = name === 'wall-run' ? closeWallRunLoop(segment) : segment;
      this.library.set(name, part);
      this.derived.push(part);
    };
    // Phase windows keep source landings out of attached swings and the
    // standing wind-up out of a launch that already happened in physics.
    section('Start Swinging', 0.22, 0.78, 'web-catch');
    section('Falling', 0.2, 0.3, 'web-wings-glide');
    section('Swinging', 0.18, 0.75, 'swing-a');
    section('Swinging (1)', 0.18, 0.75, 'swing-b');
    section('Stylish Flip', 0.2, 0.72, 'swing-style');
    // The final source section climbs a ledge. Keep it out of the repeating
    // stride and reserve that authored motion for a real mantle transition.
    section('Wall Run', 0.17, 0.5, 'wall-run');
    section('Wall Run', 0.5, 0.96, 'wall-run-ledge');
    section('Running Crawl', 0.15, 0.78, 'wall-crawl-fast');
    section('Low Crawl', 0.18, 0.75, 'wall-crawl-slow');
    section('Jumping To Hanging', 0.6, 0.85, 'mantle-reach');
    section('Falling To Landing', 0.12, 0.85, 'soft-land');
    section('Running Jump', 0.2, 0.68, 'running-takeoff');
    for (const name of ['Jumping', 'Jumping (1)', 'Jumping (2)', 'Jumping (3)'])
      section(name, 0.22, 0.66, `${name}-air`);
    for (const name of [
      'Swing To Land',
      'Swing To Land (1)',
      'Swing To Land (2)',
      'Swing To Land (3)',
    ])
      section(name, 0.62, 0.96, `${name}-contact`);
  }

  private choose(names: string[]) {
    const available = names.filter((name) => this.library.has(name));
    const unused = available.filter(
      (name) => !this.history.slice(-3).includes(name),
    );
    const pool = unused.length
      ? unused
      : available.filter((name) => name !== this.history.at(-1));
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    const name = (pool.length ? pool : available)[
      this.seed % Math.max(1, pool.length || available.length)
    ];
    if (name) {
      this.history.push(name);
      if (this.history.length > 32) this.history.shift();
    }
    return name;
  }

  private selection(
    name: string,
    rate = 1,
    loop: NativeSelection['loop'] = THREE.LoopOnce,
    bodySupport = false,
  ): NativeSelection | undefined {
    const clip = this.library.get(name);
    return clip ? { clip, rate, loop, bodySupport } : undefined;
  }

  private commit(names: string[], seconds?: number, bodySupport = false) {
    const name = this.choose(names);
    if (!name) return undefined;
    const clip = this.library.get(name)!;
    const rate = seconds
      ? THREE.MathUtils.clamp(clip.duration / seconds, 0.65, 2.4)
      : 1;
    this.active = this.selection(name, rate, THREE.LoopOnce, bodySupport);
    this.activeUntil = this.clock + clip.duration / rate;
    return this.active;
  }

  select(delta: number, motion: AvatarMotion): NativeSelection | undefined {
    this.clock += delta;
    const mode = motion.mode ?? motion.pose;
    const changed = this.previous !== mode;
    const landed = !this.grounded && motion.grounded;
    const released =
      ['swing', 'zip', 'webZip'].includes(this.previous) &&
      !motion.grounded &&
      ['jump', 'fall', 'pointLaunch'].includes(mode);
    const takeoff = this.grounded && !motion.grounded;
    const newAction =
      motion.actionSequence !== undefined &&
      motion.actionSequence !== this.sequence;
    const doubleJump = mode === 'doubleJump' && (changed || newAction);
    this.stateTime = changed ? 0 : this.stateTime + delta;
    this.previous = mode;
    this.grounded = motion.grounded;
    this.sequence = motion.actionSequence ?? -1;
    const speed = motion.speed ?? 0;
    const air = motion.timeToLanding ?? 0;
    const clearance = motion.trickClearance ?? false;
    if (motion.lobby) return undefined;
    if (takeoff) this.shortHop = air < 1.5;
    if (
      doubleJump ||
      released ||
      motion.grounded ||
      mode === 'swing' ||
      air > 1.6
    )
      this.shortHop = false;

    if (mode === 'glide') {
      this.active = undefined;
      return this.selection('Flying', 0.8, THREE.LoopRepeat);
    }
    if (mode === 'slingshot') {
      this.active = undefined;
      const selection = this.selection(
        'Web Slingshot Charge',
        0,
        THREE.LoopOnce,
        true,
      );
      if (selection)
        selection.time =
          selection.clip.duration *
          THREE.MathUtils.clamp(motion.charge ?? 0, 0, 1);
      return selection;
    }
    if (mode === 'chargeJump') {
      this.active = undefined;
      return this.selection('Male Crouch Pose', 0, THREE.LoopRepeat);
    }
    if (mode === 'cornerTether') {
      this.active = undefined;
      return this.selection('web-catch', 1.3);
    }
    if (mode === 'swing') {
      this.active = undefined;
      if (changed)
        this.swingVariant =
          this.choose(['swing-a', 'swing-b', 'swing-style']) ?? 'swing-a';
      if (this.stateTime < 0.2) return this.selection('web-catch', 1.6);
      const selection = this.selection(this.swingVariant, 0, THREE.LoopRepeat);
      if (selection)
        selection.time =
          selection.clip.duration *
          THREE.MathUtils.clamp(
            0.5 + (motion.verticalSpeed ?? 0) / 58,
            0.03,
            0.97,
          );
      return selection;
    }
    if (mode === 'wallRun' || mode === 'wall') {
      this.active = undefined;
      return this.selection(
        'wall-run',
        THREE.MathUtils.clamp(speed / 12, 0.9, 2.4),
        THREE.LoopRepeat,
      );
    }
    if (mode === 'wallCrawl' || mode === 'crawl') {
      this.active = undefined;
      if (speed > 0.1)
        this.crawlVariant = speed > 2.4 ? 'wall-crawl-fast' : 'wall-crawl-slow';
      return this.selection(
        this.crawlVariant,
        Math.min(1.25, speed / 2.7) * (motion.crawlDirection ?? 1),
        THREE.LoopRepeat,
      );
    }
    if (mode === 'mantle') {
      this.active = undefined;
      return this.selection('wall-run-ledge', 1.25, THREE.LoopOnce);
    }
    if (mode === 'vault') {
      this.active = undefined;
      return this.selection('Jump Over', 1.8, THREE.LoopOnce);
    }
    if (mode === 'webZip' || mode === 'zip') {
      this.active = undefined;
      return this.selection('web-catch', 1.4);
    }
    if (mode === 'dive') {
      this.active = undefined;
      return this.selection('Falling', 0.8, THREE.LoopPingPong);
    }

    if (motion.grounded) {
      if ((changed && mode === 'roll') || (landed && mode === 'roll'))
        this.commit(
          ['Falling To Roll', 'Run To Rolling', 'Quick Roll To Run'],
          0.8,
          true,
        );
      else if (landed)
        this.commit(
          speed > 8
            ? [
                'Swing To Land-contact',
                'Swing To Land (1)-contact',
                'Swing To Land (2)-contact',
                'Swing To Land (3)-contact',
              ]
            : ['soft-land'],
          0.38,
          true,
        );
      if (
        this.active?.bodySupport &&
        this.clock < this.activeUntil &&
        (mode === 'roll' || speed < 2 || this.clock < this.activeUntil - 0.12)
      )
        return this.active;
      this.active = undefined;
      if (speed > 0.6) {
        const strafe = motion.moveStrafe ?? 0,
          forward = motion.moveForward ?? 1;
        const name =
          speed > 5
            ? 'Running'
            : forward < -0.2
              ? 'Walk Backward'
              : strafe < -0.2
                ? 'Left Strafe Walking'
                : strafe > 0.2
                  ? 'Right Strafe Walking'
                  : 'Walking';
        return this.selection(
          name,
          THREE.MathUtils.clamp(
            speed / (name === 'Running' ? 9 : 2.4),
            0.6,
            1.7,
          ),
          THREE.LoopRepeat,
        );
      }
      if (mode === 'perch')
        return this.selection('Male Crouch Pose', 0, THREE.LoopRepeat);
      if (this.clock > this.idleAfter) {
        this.idleVariant =
          this.choose(['Idle', 'Breathing Idle', 'Happy Idle']) ?? 'Idle';
        this.idleAfter = this.clock + 6;
      }
      return this.selection(this.idleVariant, 1, THREE.LoopRepeat);
    }

    if (takeoff || doubleJump || released) {
      this.active = undefined;
      this.nextTrick = this.clock + 0.35;
    }
    // Whole rotations must fit before the predicted collision plus blend-out.
    // Interrupted by actual wall, web or ground contact above on the same frame.
    const explicitTrick = (motion.trickRequest ?? 0) !== this.lastTrickRequest;
    this.lastTrickRequest = motion.trickRequest ?? 0;
    if (doubleJump) {
      const name =
        this.choose([
          'Backflip',
          'Front Flip',
          'Front Twist Flip',
          'Running Forward Flip',
        ]) ?? 'Front Flip';
      const clip = this.library.get(name);
      if (clip) {
        const seconds = THREE.MathUtils.clamp(
          air > 0.2 ? air - 0.12 : 0.65,
          0.4,
          0.85,
        );
        this.active = this.selection(name, clip.duration / seconds);
        this.activeUntil = this.clock + seconds;
        return this.active;
      }
    }
    const wantsTrick =
      doubleJump ||
      released ||
      explicitTrick ||
      (this.clock > this.nextTrick && air > 1.7);
    if (!this.active && wantsTrick && clearance && air > 0.78) {
      const names = ['Backflip', 'Front Flip', 'Front Twist Flip'];
      if (speed > 8 && air > 1.4)
        names.push('Running Forward Flip', 'Run To Flip');
      if (air > 1.8)
        names.push(
          'Butterfly Twirl',
          'Aerial Evade',
          'Corkscrew Evade',
          'Big Jump',
        );
      const eligible = names.filter(
        (name) => (this.library.get(name)?.duration ?? 99) / 2.4 + 0.12 < air,
      );
      if (eligible.length) {
        this.commit(eligible, Math.min(1.15, air - 0.22));
        this.nextTrick = this.activeUntil + 0.22;
      }
    }
    if (!this.active && takeoff)
      this.commit(
        speed > 6
          ? ['running-takeoff']
          : [
              'Jumping-air',
              'Jumping (1)-air',
              'Jumping (2)-air',
              'Jumping (3)-air',
            ],
        0.45,
      );
    if (this.active && this.clock < this.activeUntil && air > 0.12)
      return this.active;
    this.active = undefined;
    if (this.shortHop || air < 0.65) {
      const ready = this.selection('Jumping (1)-air', 0);
      if (ready) ready.time = ready.clip.duration * 0.88;
      return ready;
    }
    return this.selection('Falling', 0.65, THREE.LoopPingPong);
  }
}
