import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BOSS_DEFINITIONS, type BossId } from './boss-definitions.ts';
import type { BossSnapshot } from './boss-system.ts';

/** Native source animation only. Physics owns world placement; no per-frame skin bounds. */
export function prepareBossClips(clips: readonly THREE.AnimationClip[]) {
  return clips.map(source => {
    const clip = source.clone();
    for (const track of clip.tracks) {
      if (!track.name.endsWith('.position') || !/(?:^|\.)root_\d+\.position$|ActorRoot|Bip01_02\.position$/.test(track.name)) continue;
      const first = Array.from(track.values.slice(0, track.getValueSize()));
      for (let i = 0; i < track.values.length; i++) track.values[i] = first[i % first.length];
    }
    return clip;
  });
}

function disposeObject(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>(), materials = new Set<THREE.Material>(), geometries = new Set<THREE.BufferGeometry>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose()); geometries.forEach(g => g.dispose());
}

export class BossVisuals {
  readonly group = new THREE.Group();
  private avatar = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private currentKey = '';
  private baseModelY = 0;
  private footBones: THREE.Bone[] = [];
  private footBaseline = 0;
  private loading = 0;
  private loaded: BossId | null = null;
  private ring = new THREE.Mesh(new THREE.RingGeometry(.92, 1, 64), new THREE.MeshBasicMaterial({ color: '#ffcf45', transparent: true, opacity: .65, side: THREE.DoubleSide, depthWrite: false }));
  private beam = new THREE.Mesh(new THREE.CylinderGeometry(.065, .065, 1, 8), new THREE.MeshBasicMaterial({ color: '#ffcd58', transparent: true, opacity: .65, depthWrite: false }));
  private restraint = new THREE.Group();
  private bullets: { group: THREE.Group; bolt: THREE.Mesh; orb: THREE.Mesh; missile: THREE.Mesh; beam: THREE.Mesh }[] = [];
  private webs = [0, 1].map(() => new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: '#dcf8ff', transparent: true, opacity: .82 }),
  ));
  private error: string | null = null;
  private beacon = new THREE.Group();
  constructor(scene: THREE.Scene) {
    this.group.name = 'Boss encounter visuals'; this.group.visible = false;
    this.group.add(this.avatar, this.ring, this.beam, this.restraint, ...this.webs, this.beacon); scene.add(this.group);
    const beaconMaterial = new THREE.MeshBasicMaterial({ color: '#fb6381', transparent: true, opacity: .48, depthWrite: false, depthTest: false, toneMapped: false });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.13,.35,24,8),beaconMaterial);
    pole.position.y = 12; this.beacon.add(pole);
    const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(.9),new THREE.MeshBasicMaterial({color:'#bcefff',wireframe:true,depthTest:false,depthWrite:false}));
    diamond.position.y = 25; this.beacon.add(diamond); this.beacon.renderOrder = 25;
    this.ring.rotation.x = -Math.PI / 2;
    for(let i = 0; i < 5; i++) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(.9, .022, 5, 32), new THREE.MeshBasicMaterial({ color: '#caf4ff', transparent: true, opacity: .8 }));
      band.rotation.x = Math.PI / 2 + i * .11; band.position.y = .4 + i * .38; this.restraint.add(band);
    }
    const projectileMaterial = () => new THREE.MeshBasicMaterial({
      color: '#61eaff', transparent: true, opacity: .92, toneMapped: false,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i < 24; i++) {
      const group = new THREE.Group();
      const bolt = new THREE.Mesh(new THREE.CapsuleGeometry(.24, 1.8, 4, 8), projectileMaterial());
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(.72, 2), projectileMaterial());
      const missile = new THREE.Mesh(new THREE.ConeGeometry(.42, 1.8, 8), projectileMaterial());
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(.42, .18, 4.8, 10), projectileMaterial());
      group.add(bolt, orb, missile, beam);
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(1, 10, 6),
        new THREE.MeshBasicMaterial({ color: '#baf8ff', transparent: true, opacity: .22, wireframe: true, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      group.add(halo); group.visible = false;
      this.bullets.push({ group, bolt, orb, missile, beam }); this.group.add(group);
    }
  }
  async load(id: BossId) {
    const generation = ++this.loading;
    this.error = null; this.loaded = null;
    this.clearModel();
    try {
      const gltf = await new GLTFLoader().loadAsync(BOSS_DEFINITIONS[id].asset);
      if (generation !== this.loading) { disposeObject(gltf.scene); return; }
      const root = gltf.scene, definition = BOSS_DEFINITIONS[id];
      const clips = prepareBossClips(gltf.animations);
      root.rotation.y = definition.modelYaw;
      const mixer = new THREE.AnimationMixer(root);
      const idle = clips.find(clip => clip.name === definition.clips.idle);
      if (idle) { const pose = mixer.clipAction(idle); pose.play(); mixer.update(0); pose.stop(); }
      root.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(root, true), size = bounds.getSize(new THREE.Vector3());
      const scale = definition.height / Math.max(.001, size.y), center = bounds.getCenter(new THREE.Vector3());
      root.scale.multiplyScalar(scale); root.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
      this.baseModelY = root.position.y;
      this.footBones = [];
      root.traverse(object => {
        if (!(object instanceof THREE.Bone)) return;
        const name = object.name.toLowerCase().replace(/[^a-z]/g, '');
        if ((name.includes('leftfoot') || name.includes('rightfoot') || /[lr]foot/.test(name)) && !name.includes('toe')) this.footBones.push(object);
      });
      root.updateMatrixWorld(true);
      this.footBaseline = this.footBones.length
        ? Math.min(...this.footBones.map(bone => bone.getWorldPosition(new THREE.Vector3()).y))
        : 0;
      root.traverse(object => { if (object instanceof THREE.Mesh) { object.frustumCulled = false; object.castShadow = true; } });
      this.model = root; this.mixer = mixer; this.avatar.add(root);
      this.actions = new Map(clips.map(clip => [clip.name, mixer.clipAction(clip)]));
      this.loaded = id;
    } catch (error) {
      if (generation === this.loading) this.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }
  get ready() { return this.loaded !== null; }
  get loadError() { return this.error; }
  private clearModel() {
    if (this.model) { this.mixer?.stopAllAction(); this.mixer?.uncacheRoot(this.model); this.avatar.remove(this.model); disposeObject(this.model); }
    this.model = null; this.mixer = null; this.actions.clear(); this.current = null; this.currentKey = ''; this.footBones = [];
  }
  update(snapshot: BossSnapshot | null, dt: number, playerHands?: readonly { x: number; y: number; z: number }[]) {
    this.group.visible = !!snapshot && snapshot.id === this.loaded;
    if (!snapshot || snapshot.id !== this.loaded) return;
    const definition = BOSS_DEFINITIONS[snapshot.id];
    this.beacon.visible = false;
    this.avatar.position.copy(snapshot.position);
    const targetYaw = Math.atan2(-snapshot.facing.x, -snapshot.facing.z);
    this.avatar.quaternion.slerp(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),targetYaw),1-Math.exp(-dt*12));
    // Ordinary attack recovery leaves a short damage window, but it is not a
    // physical stagger. Playing the full-body stun clip for that window made
    // large bosses (especially Hulk) rise out of their idle stance and then
    // snap back to the floor. Reserve that clip for real restraints/staggers.
    const visiblyStunned = snapshot.vulnerable > 1.8 && !snapshot.attack;
    let clip = snapshot.status === 'victory' ? definition.clips.dead : snapshot.cinematic === 'intro' ? definition.clips.intro : snapshot.hitReact > 0 ? definition.clips.hit : visiblyStunned ? definition.clips.stunned
      : snapshot.attack?.clip ?? (snapshot.moving ? definition.clips.move : definition.clips.idle);
    if (snapshot.escaping) clip = snapshot.id === 'hulk' ? '101291_Jump_Attack_Float'
      : snapshot.id === 'venom' ? '103531_Descent_Loop' : 'fly_fast';
    if (snapshot.attack?.kind === 'leap') {
      const stage = snapshot.attack.stage;
      clip = snapshot.id === 'hulk'
        ? stage === 'startup' ? snapshot.attack.clip : stage === 'active' ? '101291_Jump_Attack_Float' : '101291_Jump_Attack_Land'
        : stage === 'startup' ? snapshot.attack.clip : stage === 'active' ? '103531_Descent_Loop' : '103531_Descent_End';
    }
    const action = this.actions.get(clip) ?? this.actions.get(definition.clips.idle);
    const key = `${clip}:${snapshot.attack?.id ?? ''}:${snapshot.status}`;
    if (action && key !== this.currentKey) {
      const old = this.current; action.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
      const playOnce = snapshot.status === 'victory' || snapshot.cinematic === 'intro' || snapshot.hitReact > 0 || Boolean(snapshot.attack && snapshot.attack.kind !== 'charge');
      action.setLoop(playOnce ? THREE.LoopOnce : THREE.LoopRepeat, playOnce ? 1 : Infinity);
      action.clampWhenFinished = true;
      if (old && old !== action) old.crossFadeTo(action, .16, false);
      this.current = action; this.currentKey = key;
    }
    if (action && snapshot.attack && snapshot.attack.kind !== 'charge' && snapshot.attack.kind !== 'leap') {
      // Advance the authored attack on the exact simulation clock. Pausing or
      // frame drops cannot move hit frames independently from its playback.
      action.timeScale = 0;
      action.time = Math.min(action.getClip().duration - .0001, snapshot.attack.time / snapshot.attack.duration * action.getClip().duration);
    } else if (action) action.timeScale = snapshot.cinematic === 'intro' ? action.getClip().duration / .72 : 1;
    this.mixer?.update(Math.max(0, dt));
    if (this.model) {
      this.model.position.y = this.baseModelY;
      this.avatar.updateMatrixWorld(true);
      if (this.footBones.length) {
        const currentFootY = Math.min(...this.footBones.map(bone => bone.getWorldPosition(new THREE.Vector3()).y));
        const correction = THREE.MathUtils.clamp(snapshot.position.y + this.footBaseline - currentFootY, -.65, 1.8);
        this.model.position.y = this.baseModelY + correction;
      }
    }
    const attack = snapshot.attack;
    this.ring.visible = false;
    this.beam.visible = false;
    if (attack) {
      const center = attack.kind === 'leap' ? attack.target : snapshot.position;
      this.ring.position.set(center.x, center.y + .09, center.z);
      const scale = attack.radius * (attack.stage === 'startup' ? .75 + attack.progress * .25 : 1);
      this.ring.scale.setScalar(scale);
      this.ring.material.color.set(attack.stage === 'startup' ? definition.accent : attack.stage === 'active' ? '#ff3158' : '#69def8');
      const from = new THREE.Vector3().copy(snapshot.position).add(new THREE.Vector3(0, 1.5, 0));
      const to = new THREE.Vector3().copy(attack.target).add(new THREE.Vector3(0,1,0));
      const offset = to.clone().sub(from);
      this.beam.position.copy(from).addScaledVector(offset,.5); this.beam.scale.y = offset.length();
      this.beam.material.color.set(snapshot.id === 'ironman' ? '#55e9ff' : attack.stage === 'active' ? '#ad376e' : definition.accent);
      this.beam.scale.x = this.beam.scale.z = attack.stage === 'active' ? 3 : 1;
      this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),offset.normalize());
    }
    this.restraint.visible = snapshot.vulnerable > 1.8 && !snapshot.attack;
    this.restraint.position.copy(snapshot.position); this.restraint.rotation.y += dt * .3;
    const webVisible = snapshot.webProgress > .02 && Boolean(playerHands?.length);
    const webRight = new THREE.Vector3(-snapshot.facing.z, 0, snapshot.facing.x);
    this.webs.forEach((web, index) => {
      web.visible = webVisible;
      const hand = playerHands?.[index] ?? playerHands?.[0];
      if (!webVisible || !hand) return;
      const positions = web.geometry.getAttribute('position');
      positions.setXYZ(0, hand.x, hand.y, hand.z);
      positions.setXYZ(
        1,
        snapshot.position.x + webRight.x * (index ? .28 : -.28),
        snapshot.position.y + definition.height * .6,
        snapshot.position.z + webRight.z * (index ? .28 : -.28),
      );
      positions.needsUpdate = true;
      web.geometry.computeBoundingSphere();
    });
    this.bullets.forEach((visual,index) => {
      const projectile = snapshot.projectiles[index]; visual.group.visible = !!projectile;
      if(projectile){
        visual.group.position.copy(projectile.position);
        visual.bolt.visible = projectile.style === 'bolt';
        visual.orb.visible = projectile.style === 'orb';
        visual.missile.visible = projectile.style === 'missile';
        visual.beam.visible = projectile.style === 'beam';
        visual.group.scale.setScalar(projectile.radius);
        const velocity = new THREE.Vector3().copy(projectile.velocity).normalize();
        visual.group.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), velocity);
        visual.group.rotation.y += dt * (projectile.style === 'missile' ? 8 : 3);
      }
    });
  }
  dispose() {
    ++this.loading; this.clearModel(); this.group.removeFromParent(); disposeObject(this.group);
    this.webs.forEach((web) => { web.geometry.dispose(); (web.material as THREE.Material).dispose(); });
  }
}
