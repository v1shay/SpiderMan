import * as THREE from 'three';
import type { RigBone } from './three-assets.ts';

/** Small pooled emitters track the actual animated palms and boots in meters. */
export class IronManRepulsors {
  readonly root: THREE.Group;
  readonly emitters: { group: THREE.Group; bone: THREE.Bone; parentBone: THREE.Bone; plume: THREE.Mesh; foot: boolean }[] = [];
  readonly light = new THREE.PointLight('#73e7ff', 0, 7, 2);
  private point = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private inverse = new THREE.Matrix4();
  private inverseRotation = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(root: THREE.Group, bones: readonly RigBone[]) {
    this.root = root;
    const cone = new THREE.ConeGeometry(.075, 1, 8).translate(0, .5, 0);
    const glow = new THREE.SphereGeometry(.075, 8, 6);
    const coreMaterial = new THREE.MeshBasicMaterial({ color: '#e4fcff', toneMapped: false });
    const jetMaterial = new THREE.MeshBasicMaterial({ color: '#50cfff', transparent: true, opacity: .58, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    for (const side of ['left', 'right']) for (const limb of ['Hand', 'Foot']) {
      const bone = bones.find(entry => entry.role === `${side}${limb}`)?.bone;
      const parentBone = bones.find(entry => entry.role === `${side}${limb === 'Hand' ? 'ForeArm' : 'Leg'}`)?.bone;
      if (!bone || !parentBone) continue;
      const group = new THREE.Group(); group.name = `${side} ${limb} repulsor`; group.visible = false;
      const plume = new THREE.Mesh(cone, jetMaterial); group.add(plume, new THREE.Mesh(glow, coreMaterial)); root.add(group);
      this.emitters.push({ group, bone, parentBone, plume, foot: limb === 'Foot' });
    }
    this.light.name = 'Iron Man repulsor light'; root.add(this.light);
  }

  update(active: boolean, speed: number, boost: boolean, elapsed: number) {
    this.root.updateMatrixWorld(true);
    this.inverse.copy(this.root.matrixWorld).invert();
    this.inverseRotation.copy(this.root.getWorldQuaternion(new THREE.Quaternion())).invert();
    for (const emitter of this.emitters) {
      emitter.group.visible = active;
      if (!active) continue;
      emitter.bone.getWorldPosition(this.point);
      emitter.parentBone.getWorldPosition(this.direction);
      this.direction.subVectors(this.point, this.direction).normalize();
      this.point.addScaledVector(this.direction, emitter.foot ? .12 : .07);
      emitter.group.position.copy(this.point.applyMatrix4(this.inverse));
      emitter.group.quaternion.setFromUnitVectors(this.up, this.direction.applyQuaternion(this.inverseRotation));
      const flicker = 1 + Math.sin(elapsed * 39 + (emitter.foot ? 1 : 0)) * .075;
      emitter.plume.scale.set(1, (.32 + Math.min(speed, 75) * .015 + (boost ? .6 : 0)) * flicker, 1);
    }
    this.light.position.set(0, .5, 0);
    this.light.intensity = active ? (boost ? 3 : 1.5) : 0;
  }
}
