import * as THREE from 'three';
import type { SuitConfig } from './game-config';
import { animateRigBones, boneRole, collectRigBones, freezeClipPose, type ProceduralPose } from './three-assets.ts';
import { createWallCrawlClip } from './wall-crawl-animation.ts';
import { PavitrAnimationGraph } from './pavitr-animation.ts';
import { IronManAnimationGraph } from './ironman-animation.ts';
import { SymbioteAnimationGraph } from './symbiote-animation.ts';
import { MuaSpiderAnimationGraph } from './mua-spider-animation.ts';

const canonical = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const findClip = (clips: readonly THREE.AnimationClip[], names: readonly string[]) => {
  for (const name of names) {
    const clip = clips.find((item) => canonical(item.name) === name)
      ?? clips.find((item) => canonical(item.name).endsWith(name));
    if (clip) return clip;
  }
  return undefined;
};

const hasMotion = (clip: THREE.AnimationClip) => clip.tracks.some(track => {
  const size = track.getValueSize();
  for (let index = size; index < track.values.length; index++) {
    if (Math.abs(track.values[index] - track.values[index % size]) > 1e-5) return true;
  }
  return false;
});

export type AvatarMotion = {
  pose: ProceduralPose;
  grounded: boolean;
  speed?: number;
  verticalSpeed?: number;
  crawlDirection?: number;
  tension?: number;
  anchor?: THREE.Vector3 | null;
  lobby?: boolean;
  boost?: boolean;
};

/** One source of state/clip transitions for the showroom and playable avatar. */
export class AvatarAnimator {
  readonly root: THREE.Object3D;
  readonly suit: SuitConfig;
  readonly mixer: THREE.AnimationMixer;
  readonly bones;
  readonly clips: THREE.AnimationClip[];
  private actions = new Map<THREE.AnimationClip, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private pose: ProceduralPose = 'idle';
  private elapsed = 0;
  private stateTime = 0;
  private swingRising = false;
  private swingVerticalSpeed = 0;
  private baseY: number;
  private contactSamples: { mesh: THREE.SkinnedMesh; indices: number[] }[] = [];
  private bodySamples: { mesh: THREE.SkinnedMesh; indices: number[] }[] = [];
  private handSamples: { mesh: THREE.SkinnedMesh; left: number[]; right: number[] }[] = [];
  private pavitr?: PavitrAnimationGraph;
  private ironman?: IronManAnimationGraph;
  private symbiote?: SymbioteAnimationGraph;
  private muaSpider?: MuaSpiderAnimationGraph;
  private bodySupportTime = 0;
  private inverse = new THREE.Matrix4();
  private point = new THREE.Vector3();
  private normal = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private parentQuaternion = new THREE.Quaternion();
  private deltaQuaternion = new THREE.Quaternion();
  private handSide = 'right';
  private aimedBone: THREE.Bone | null = null;
  private preAim = new THREE.Quaternion();
  private emotes: THREE.AnimationClip[];
  private forcedLobbyEmote?: THREE.AnimationClip;
  private forcedLobbyEmoteUntil = 0;
  private previousLobbyEmote = -1;
  private idle?: THREE.AnimationClip;
  private run?: THREE.AnimationClip;
  private crawl?: THREE.AnimationClip;
  private perch?: THREE.AnimationClip;
  private hang?: THREE.AnimationClip;
  private swingDown?: THREE.AnimationClip;
  private swingUp?: THREE.AnimationClip;
  private overlays: { bone: THREE.Bone; before: THREE.Quaternion }[] = [];
  activeClip = 'procedural';
  contactError = 0;
  supportMode: 'soles' | 'body' = 'soles';
  get cruiseBlend() { return this.ironman?.cruiseBlend ?? 1; }

  /** Start a fresh, non-repeating random showroom dance on every model click. */
  playRandomLobbyEmote(random = Math.random) {
    if (!this.emotes.length) return undefined;
    let index = Math.floor(random() * this.emotes.length);
    if (this.emotes.length > 1 && index === this.previousLobbyEmote) index = (index + 1) % this.emotes.length;
    this.previousLobbyEmote = index;
    this.forcedLobbyEmote = this.emotes[index];
    this.forcedLobbyEmoteUntil = this.elapsed + Math.max(.65, this.forcedLobbyEmote.duration);
    const action = this.actions.get(this.forcedLobbyEmote);
    if (action === this.current) action?.reset().setEffectiveWeight(1).play();
    return this.forcedLobbyEmote.name;
  }

  constructor(root: THREE.Object3D, suit: SuitConfig, source: readonly THREE.AnimationClip[]) {
    this.root = root;
    this.suit = suit;
    // Defense in depth: even an accidentally appended shared library cannot
    // override Pavitr's supplied pack in the lobby, gameplay or remote avatars.
    this.clips = suit.id === 'pavitr' ? source.filter(clip => canonical(clip.name).startsWith('armatureanimspidermanpavitr')) : [...source];
    this.mixer = new THREE.AnimationMixer(root);
    this.bones = collectRigBones(root);
    this.baseY = root.position.y;
    this.idle = findClip(this.clips, ['shellidle', 'stand', 'idle', 'passive', 'combatidle']);
    const run = findClip(this.clips, ['runaboveground', 'run', 'bullywalking', 'walk']);
    // Pavitr's Run_ABOVEGROUND export has just one keyframe. Do not pretend
    // that holding that frame is a running animation; use the local gait when
    // there is no motion, without borrowing another character's clips.
    this.run = run && (suit.id !== 'pavitr' || hasMotion(run)) ? run : undefined;
    const authoredPerch = suit.id === 'venom' ? undefined
      : suit.id === 'tobey' ? findClip(this.clips, ['mixamocomlayer0'])
      : suit.id === 'pavitr' ? findClip(this.clips, ['specialattack'])
      : suit.id === 'playstation' ? findClip(this.clips, ['swingtoland'])
        : suit.id === 'symbiote' ? findClip(this.clips, ['swingtoland'])
          : findClip(this.clips, ['swingend', 'lowcrawl', 'crawl']);
    if (authoredPerch) {
      const time = suit.id === 'tobey' ? 1.473 : suit.id === 'pavitr' ? 2.3075 : suit.id === 'playstation' ? 1.52
        : suit.id === 'symbiote' ? 1.52 : canonical(authoredPerch.name) === 'swingend' ? 1.568 : .568;
      this.perch = freezeClipPose(authoredPerch, Math.min(time, authoredPerch.duration), 'rooftop-perch');
      this.clips.push(this.perch);
    }
    this.hang = findClip(this.clips, ['hanging']);
    const swingStart = findClip(this.clips, ['swingstart']);
    const swingEnd = findClip(this.clips, ['swingend']);
    if (swingStart && swingEnd) {
      this.swingDown = swingStart.clone(); this.swingDown.name = 'arc-downswing';
      this.swingUp = swingEnd.clone(); this.swingUp.name = 'arc-upswing';
      this.clips.push(this.swingDown, this.swingUp);
    }
    if (!this.hang) {
      const swing = findClip(this.clips, ['swingtoland', 'swingstart']);
      if (swing) {
        this.hang = freezeClipPose(swing, Math.min(.48, swing.duration * .25), 'sustained-swing');
        this.clips.push(this.hang);
      }
    }
    // Deliberately exclude attacks, root-motion acrobatics and fly-offscreen
    // clips from a tightly spaced selection lineup.
    this.emotes = this.clips.filter((clip) => /(?:shellfidget|fidgetvictoryin|hiphop|moonwalk|silly1|silly2|scream)$/.test(canonical(clip.name)));
    if (suit.id === 'pavitr') {
      const passive = findClip(this.clips, ['passive']);
      if (passive) this.emotes.push(passive);
      this.pavitr = new PavitrAnimationGraph(this.clips);
      this.clips.push(...this.pavitr.derived);
    }
    if (suit.id === 'ironman' && this.clips.some(clip => clip.name === 'fly_fast')) {
      this.ironman = new IronManAnimationGraph(this.clips);
      this.clips.push(...this.ironman.derived);
    }
    if (suit.id === 'symbiote') this.symbiote = new SymbioteAnimationGraph(this.clips);
    if (suit.id === 'mua-spider') {
      this.muaSpider = new MuaSpiderAnimationGraph(this.clips);
      this.clips.push(...this.muaSpider.derived);
    }
    // Register only after native perch/emote selection so the new crawl does
    // not silently replace an unrelated suit's spawn or lobby animation.
    if (suit.traversal === 'spider') {
      // Symbiote's Low Crawl is a ground-combat animation. Preserve the new
      // facade-calibrated cycle instead of rotating that clip onto a wall.
      this.crawl = suit.id === 'symbiote' ? undefined : findClip(this.clips, ['lowcrawl', 'crawl']);
      if (!this.crawl || !hasMotion(this.crawl)) {
        this.crawl = createWallCrawlClip(root, this.bones, suit.id === 'pavitr');
        this.clips.push(this.crawl);
      }
    }
    // Authored and retargeted libraries can both name a clip `stand`/`Run`.
    // Clip identity preserves the authored-first selection instead of silently
    // playing a same-named fallback with a different rest-pose orientation.
    for (const clip of this.clips) this.actions.set(clip, this.mixer.clipAction(clip));
    root.updateMatrixWorld(true);
    root.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh) || !object.visible) return;
      const joints = object.geometry.getAttribute('skinIndex');
      const weights = object.geometry.getAttribute('skinWeight');
      if (!joints || !weights) return;
      if (this.pavitr || this.ironman || this.muaSpider) {
        // Entry includes a handstand. Sample each joint's extremities, including
        // palms and head, so inverted poses never use the shoes as their floor.
        const selected = new Set<number>();
        const extrema = new Map<number, { min: number[]; max: number[]; low: number[]; high: number[] }>();
        for (let i = 0; i < joints.count; i++) {
          object.getVertexPosition(i, this.point);
          let strongest = 0;
          for (let j = 1; j < 4; j++) if (weights.getComponent(i, j) > weights.getComponent(i, strongest)) strongest = j;
          const joint = joints.getComponent(i, strongest);
          let ext = extrema.get(joint);
          if (!ext) { ext = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], low: [i, i, i], high: [i, i, i] }; extrema.set(joint, ext); }
          for (let axis = 0; axis < 3; axis++) {
            const value = this.point.getComponent(axis);
            if (value < ext.min[axis]) { ext.min[axis] = value; ext.low[axis] = i; }
            if (value > ext.max[axis]) { ext.max[axis] = value; ext.high[axis] = i; }
          }
        }
        for (const ext of extrema.values()) for (const i of [...ext.low, ...ext.high]) selected.add(i);
        for (let i = 0; i < 192; i++) selected.add(Math.floor(i * (joints.count - 1) / 191));
        this.bodySamples.push({ mesh: object, indices: [...selected] });
        const hands = { mesh: object, left: [] as number[], right: [] as number[] };
        for (const side of ['left', 'right'] as const) for (const index of selected) {
          let weight = 0;
          for (let j = 0; j < 4; j++) {
            const name = object.skeleton.bones[joints.getComponent(index, j)].name.toLowerCase();
            if (name.includes(`${side}hand`)) weight += weights.getComponent(index, j);
          }
          if (weight > .35) hands[side].push(index);
        }
        this.handSamples.push(hands);
      }
      const footBones = object.skeleton.bones.map((bone) => boneRole(bone.name).endsWith('Foot'));
      const indices: number[] = [];
      for (let i = 0; i < joints.count; i++) {
        let weight = 0;
        for (let component = 0; component < 4; component++) {
          if (footBones[joints.getComponent(i, component)]) weight += weights.getComponent(i, component);
        }
        if (weight > .35) indices.push(i);
      }
      // Bounded sole probes, including each extremity. No full mesh bounds in
      // the render loop; all sampling follows actual skinned shoe vertices.
      if (indices.length) {
        const selected = new Set<number>();
        for (let i = 0; i < 96; i++) selected.add(indices[Math.floor(i * (indices.length - 1) / 95)]);
        for (let axis = 0; axis < 3; axis++) {
          let low = Infinity, high = -Infinity, lowIndex = indices[0], highIndex = indices[0];
          for (const index of indices) {
            object.getVertexPosition(index, this.point);
            const value = this.point.getComponent(axis);
            if (value < low) { low = value; lowIndex = index; }
            if (value > high) { high = value; highIndex = index; }
          }
          selected.add(lowIndex); selected.add(highIndex);
        }
        this.contactSamples.push({ mesh: object, indices: [...selected] });
      }
    });
  }

  private choose(motion: AvatarMotion): THREE.AnimationClip | undefined {
    if (motion.lobby) {
      if (this.forcedLobbyEmote && this.elapsed < this.forcedLobbyEmoteUntil) return this.forcedLobbyEmote;
      this.forcedLobbyEmote = undefined;
      const period = this.pavitr ? 12 : 22;
      const cycle = this.elapsed % period;
      const emote = this.emotes[Math.floor(this.elapsed / period) % this.emotes.length];
      if (emote && cycle > 3 && cycle < 3 + Math.min(18, emote.duration)) return emote;
      return this.idle;
    }
    switch (motion.pose) {
      case 'perch': return this.perch;
      case 'idle': return this.idle;
      case 'run': return this.run;
      case 'swing': return this.swingDown && this.swingUp ? this.swingRising ? this.swingUp : this.swingDown : this.hang;
      case 'zip': return findClip(this.clips, ['jumpup']) ?? this.hang;
      // Venom's supplied Jump has its own heavy squat/launch silhouette. Keep
      // it authored-first instead of letting the appended shared `jumpUp`
      // clip win only because its alias appears earlier in the generic list.
      case 'jump': return this.suit.id === 'venom' ? findClip(this.clips, ['jump']) : findClip(this.clips, ['jumpup', 'jump']);
      case 'fall': return findClip(this.clips, ['jumpdown', 'bracedrop']);
      case 'dive': return findClip(this.clips, ['bracedrop', 'jumpdown']);
      case 'crawl': case 'wall': return this.crawl;
      default: return undefined;
    }
  }

  update(delta: number, motion: AvatarMotion) {
    // Ground/contact state is authoritative even if a stale network/physics
    // mode still says run on the first frame off a ledge.
    if (!motion.grounded && motion.pose === 'run') motion = { ...motion, pose: (motion.verticalSpeed ?? 0) > 1 ? 'jump' : 'fall' };
    if (this.aimedBone) this.aimedBone.quaternion.copy(this.preAim);
    this.aimedBone = null;
    for (const overlay of this.overlays) overlay.bone.quaternion.copy(overlay.before);
    this.overlays.length = 0;
    this.elapsed += delta;
    const changed = this.pose !== motion.pose;
    this.swingVerticalSpeed = THREE.MathUtils.damp(this.swingVerticalSpeed, motion.verticalSpeed ?? 0, 12, delta);
    if (changed && motion.pose === 'swing') this.swingRising = (motion.verticalSpeed ?? 0) > 2;
    else if (this.swingVerticalSpeed > 3) this.swingRising = true;
    else if (this.swingVerticalSpeed < -3) this.swingRising = false;
    if (changed) {
      this.stateTime = 0;
      if (motion.pose === 'swing') this.handSide = this.handSide === 'right' ? 'left' : 'right';
    }
    this.stateTime += delta;
    this.pose = motion.pose;
    this.root.position.y = this.baseY;
    const native = this.pavitr?.select(delta, motion)
      ?? this.ironman?.select(delta, motion)
      ?? this.symbiote?.select(delta, motion)
      ?? this.muaSpider?.select(delta, motion);
    const clip = native?.clip ?? this.choose(motion);
    // The outgoing inverted pose still contributes during the crossfade.
    this.bodySupportTime = native?.bodySupport ? .22 : Math.max(0, this.bodySupportTime - delta);
    this.supportMode = this.bodySupportTime > 0 && motion.grounded ? 'body' : 'soles';
    const action = clip ? this.actions.get(clip) ?? null : null;
    if (action !== this.current) {
      this.current?.fadeOut(.16);
      if (action) {
        const once = motion.lobby ? this.emotes.includes(clip!) : ['jump', 'fall', 'zip', 'dive'].includes(motion.pose);
        action.reset().setLoop(native?.loop ?? (once ? THREE.LoopOnce : THREE.LoopRepeat), Infinity);
        action.clampWhenFinished = native ? native.loop === THREE.LoopOnce : once;
        action.enabled = true;
        action.setEffectiveWeight(1).fadeIn(.16).play();
      }
      this.current = action;
    }
    if (action) {
      const rate = motion.pose === 'crawl' || motion.pose === 'wall' ? THREE.MathUtils.clamp((motion.speed ?? 0) / 4, 0, 1.5) * (motion.crawlDirection ?? 1)
        : motion.pose === 'run' ? THREE.MathUtils.clamp((motion.speed ?? 8) / 9, .65, 1.65)
        : motion.pose === 'swing' ? .85 + (motion.tension ?? 0) * .25 : 1;
      action.setEffectiveTimeScale(native?.rate ?? rate);
      if (clip === this.swingDown || clip === this.swingUp) {
        action.setEffectiveTimeScale(0);
        // Arc-driven playback never enters swingEnd's released backflip.
        action.time = clip === this.swingDown
          ? this.stateTime < .24 ? .7 + this.stateTime * 2.5 : 1.3 + THREE.MathUtils.clamp(1 - Math.abs(this.swingVerticalSpeed) / 24, 0, 1) * .6
          : .05 + THREE.MathUtils.clamp(this.swingVerticalSpeed / 24, 0, 1) * .4;
      }
    }
    this.mixer.update(delta);
    this.activeClip = clip?.name ?? `procedural:${motion.pose}`;
    if (!action) {
      const fallback = motion.lobby && this.elapsed % 14 > 9 ? 'emote' : motion.pose;
      animateRigBones(this.bones, fallback, this.elapsed, delta, this.suit.rigPreset);
    }
    if (action && motion.pose === 'swing') {
      const trough = (1 - THREE.MathUtils.clamp(Math.abs(motion.verticalSpeed ?? 0) / 5, 0, 1)) * (motion.tension ?? 0);
      for (const entry of this.bones) {
        if (!['leftLeg', 'rightLeg', 'leftUpLeg', 'rightUpLeg'].includes(entry.role)) continue;
        this.overlays.push({ bone: entry.bone, before: entry.bone.quaternion.clone() });
        entry.bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(entry.axisX, trough * (entry.role.endsWith('UpLeg') ? -.12 : -.22)));
      }
    }
    if (!motion.grounded && motion.anchor && (motion.pose === 'swing' || motion.pose === 'zip')) this.aimWebArm(motion.anchor);
    if (motion.grounded) {
      this.groundSoles();
      if (this.pavitr && this.supportMode === 'soles') this.clearGroundFingers();
    }
    else this.contactError = 0;
  }

  /** Keep the source perch's fingertips above the roof without lifting feet. */
  private clearGroundFingers() {
    const holder = this.root.parent;
    if (!holder) return;
    holder.updateMatrixWorld(true);
    this.inverse.copy(holder.matrixWorld).invert();
    for (const side of ['left', 'right'] as const) {
      const hand = this.bones.find(entry => entry.role === `${side}Hand`)?.bone;
      if (!hand?.parent) continue;
      let saved = false;
      for (let pass = 0; pass < 3; pass++) {
        let low = Infinity;
        const tip = new THREE.Vector3();
        for (const probe of this.handSamples) for (const index of probe[side]) {
          probe.mesh.getVertexPosition(index, this.point).applyMatrix4(probe.mesh.matrixWorld).applyMatrix4(this.inverse);
          if (this.point.y < low) { low = this.point.y; tip.copy(this.point); }
        }
        if (low >= .008) break;
        if (!saved) { this.overlays.push({ bone: hand, before: hand.quaternion.clone() }); saved = true; }
        const pivot = hand.getWorldPosition(new THREE.Vector3()).applyMatrix4(this.inverse);
        const from = tip.clone().sub(pivot);
        const targetY = THREE.MathUtils.clamp(.015 - pivot.y, -from.length(), from.length());
        const to = from.clone().setY(0).normalize().multiplyScalar(Math.sqrt(Math.max(0, from.lengthSq() - targetY * targetY))).setY(targetY);
        const holderRotation = holder.getWorldQuaternion(new THREE.Quaternion());
        const parentInverse = hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
        from.applyQuaternion(holderRotation).applyQuaternion(parentInverse).normalize();
        to.applyQuaternion(holderRotation).applyQuaternion(parentInverse).normalize();
        hand.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(from, to)).normalize();
        holder.updateMatrixWorld(true);
      }
    }
  }

  /** Restore the exact sole plane after a crouch/emote, not the bind-pose AABB. */
  private groundSoles() {
    const holder = this.root.parent;
    if (!holder || !this.contactSamples.length) return;
    holder.updateMatrixWorld(true);
    this.inverse.copy(holder.matrixWorld).invert();
    let lowest = Infinity;
    for (const { mesh, indices } of this.supportMode === 'body' ? this.bodySamples : this.contactSamples) {
      for (const index of indices) {
        mesh.getVertexPosition(index, this.point).applyMatrix4(mesh.matrixWorld).applyMatrix4(this.inverse);
        lowest = Math.min(lowest, this.point.y);
      }
    }
    if (!Number.isFinite(lowest)) return;
    const correction = THREE.MathUtils.clamp(-lowest, -2, 2);
    this.root.position.y = this.baseY + correction;
    this.contactError = lowest + correction;
    this.root.updateMatrixWorld(true);
  }

  private aimWebArm(anchor: THREE.Vector3) {
    // Rotate the real arm toward the anchor in its parent's space. This is a
    // small additive aim adjustment, never a replacement for the authored pose.
    const upper = this.bones.find((entry) => entry.role === `${this.handSide}Arm`)?.bone;
    const fore = this.bones.find((entry) => entry.role === `${this.handSide}ForeArm`)?.bone;
    if (!upper || !fore || !upper.parent) return;
    this.root.parent?.updateMatrixWorld(true);
    upper.getWorldPosition(this.point);
    fore.getWorldPosition(this.normal).sub(this.point).normalize();
    this.desired.copy(anchor).sub(this.point).normalize();
    upper.parent.getWorldQuaternion(this.parentQuaternion).invert();
    this.normal.applyQuaternion(this.parentQuaternion);
    this.desired.applyQuaternion(this.parentQuaternion);
    this.deltaQuaternion.setFromUnitVectors(this.normal, this.desired);
    const amount = Math.min(1, this.stateTime * 7) * .45;
    this.deltaQuaternion.slerp(new THREE.Quaternion(), 1 - amount);
    this.aimedBone = upper;
    this.preAim.copy(upper.quaternion);
    upper.quaternion.premultiply(this.deltaQuaternion);
  }

  webHand(target: THREE.Vector3) {
    const hand = this.bones.find((entry) => entry.role === `${this.handSide}Hand`)?.bone;
    if (hand) { this.root.parent?.updateMatrixWorld(true); return hand.getWorldPosition(target); }
    return this.root.getWorldPosition(target).add(new THREE.Vector3(0, 1.45, 0));
  }
}
