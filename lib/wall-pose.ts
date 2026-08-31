import * as THREE from 'three';
import { boneRole, type RigBone } from './three-assets.ts';
import type { SurfaceContact } from './traversal-physics';

/** Surface-space correction shared by every source rig. The actor's collision
 * capsule remains upright; only the posed mesh is aligned to the facade. */
export class WallPose {
  private probes: { mesh: THREE.Mesh; body: number[]; feet: number[]; left: number[]; right: number[] }[] = [];
  private restored: { bone: THREE.Bone; rotation: THREE.Quaternion }[] = [];
  footGap = 0;
  bodyClearance = 0;

  constructor(model: THREE.Object3D) {
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.visible) return;
      const positions = object.geometry.getAttribute('position');
      if (!positions) return;
      const skinIndex = object.geometry.getAttribute('skinIndex');
      const skinWeight = object.geometry.getAttribute('skinWeight');
      const roles = object instanceof THREE.SkinnedMesh ? object.skeleton.bones.map(bone => boneRole(bone.name)) : [];
      const feet = roles.map(role => role.endsWith('Foot'));
      const bodyIndices = new Set<number>();
      const footIndices: number[] = [];
      const left: number[] = [], right: number[] = [];
      const extremes = new Map<number, { values: number[]; indices: number[] }>();
      for (let index = 0; index < positions.count; index++) {
        let dominant = 0, greatest = 0, sole = 0;
        if (skinIndex && skinWeight) for (let joint = 0; joint < 4; joint++) {
          const weight = skinWeight.getComponent(index, joint);
          const bone = skinIndex.getComponent(index, joint);
          if (weight > greatest) { greatest = weight; dominant = bone; }
          if (feet[bone]) sole += weight;
        }
        if (sole > .35) {
          footIndices.push(index);
          (roles[dominant] === 'leftFoot' ? left : right).push(index);
        }
        const entry = extremes.get(dominant) ?? { values: [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity], indices: Array<number>(6).fill(index) };
        for (let axis = 0; axis < 3; axis++) {
          const value = positions.getComponent(index, axis);
          if (value < entry.values[axis * 2]) { entry.values[axis * 2] = value; entry.indices[axis * 2] = index; }
          if (value > entry.values[axis * 2 + 1]) { entry.values[axis * 2 + 1] = value; entry.indices[axis * 2 + 1] = index; }
        }
        extremes.set(dominant, entry);
      }
      for (const entry of extremes.values()) for (const index of entry.indices) bodyIndices.add(index);
      for (let index = 0; index < 256; index++) bodyIndices.add(Math.floor(index * (positions.count - 1) / 255));
      // All sole vertices are cheap compared with the entire suit and provide
      // exact planted-foot depth through the source's animated shoe shape.
      this.probes.push({ mesh: object, body: [...bodyIndices], feet: footIndices, left, right });
    });
  }

  reset(frame: THREE.Group) {
    for (const { bone, rotation } of this.restored) bone.quaternion.copy(rotation);
    this.restored.length = 0;
    frame.position.set(0, 0, 0);
    frame.quaternion.identity();
  }

  apply(frame: THREE.Group, bones: readonly RigBone[], wall: SurfaceContact) {
    const actor = frame.parent;
    if (!actor) return;
    actor.updateMatrixWorld(true);
    const position = (role: string) => bones.find(entry => entry.role === role)?.bone.getWorldPosition(new THREE.Vector3());
    const head = position('head'), leftFoot = position('leftFoot'), rightFoot = position('rightFoot');
    const left = position('leftArm'), right = position('rightArm');
    if (!head || !leftFoot || !rightFoot || !left || !right) return;
    const sourceUp = head.clone().sub(leftFoot.clone().add(rightFoot).multiplyScalar(.5)).normalize();
    const sourceRight = right.sub(left);
    sourceRight.addScaledVector(sourceUp, -sourceRight.dot(sourceUp)).normalize();
    const sourceBack = new THREE.Vector3().crossVectors(sourceRight, sourceUp).normalize();
    const normal = new THREE.Vector3(wall.normal.x, 0, wall.normal.z).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const wallRight = new THREE.Vector3().crossVectors(up, normal).normalize();
    const source = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(sourceRight, sourceUp, sourceBack));
    const target = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(wallRight, up, normal));
    const parentRotation = actor.getWorldQuaternion(new THREE.Quaternion());
    frame.quaternion.copy(parentRotation).invert().multiply(target.multiply(source.invert())).multiply(parentRotation);
    actor.updateMatrixWorld(true);
    const point = new THREE.Vector3(), planePoint = new THREE.Vector3().copy(wall.point);
    let footY = Infinity, minT = Infinity, maxT = -Infinity, footN = Infinity, bodyN = Infinity;
    for (const probe of this.probes) {
      for (const index of probe.body) {
        probe.mesh.getVertexPosition(index, point).applyMatrix4(probe.mesh.matrixWorld);
        bodyN = Math.min(bodyN, point.dot(normal) - planePoint.dot(normal));
      }
      for (const index of probe.feet) {
        probe.mesh.getVertexPosition(index, point).applyMatrix4(probe.mesh.matrixWorld);
        footY = Math.min(footY, point.y);
        minT = Math.min(minT, point.dot(wallRight)); maxT = Math.max(maxT, point.dot(wallRight));
        footN = Math.min(footN, point.dot(normal) - planePoint.dot(normal));
      }
    }
    if (!Number.isFinite(footY + footN + bodyN)) return;
    const actorPosition = actor.getWorldPosition(new THREE.Vector3());
    const normalShift = Math.max(.015 - footN, .035 - bodyN);
    const shift = up.multiplyScalar(actorPosition.y - footY)
      .addScaledVector(wallRight, actorPosition.dot(wallRight) - (minT + maxT) * .5)
      .addScaledVector(normal, normalShift);
    frame.position.copy(shift.applyQuaternion(parentRotation.invert()));
    this.footGap = footN + normalShift;
    this.bodyClearance = bodyN + normalShift;
    actor.updateMatrixWorld(true);

    // Preserve the authored crawl, then plant each shoe on the facade with a
    // two-bone leg solve. Merely pushing the whole mesh outside the wall leaves
    // some source rigs' feet half a metre in midair.
    for (const side of ['left', 'right'] as const) {
      const hip = bones.find(entry => entry.role === `${side}UpLeg`)?.bone;
      const knee = bones.find(entry => entry.role === `${side}Leg`)?.bone;
      const ankle = bones.find(entry => entry.role === `${side}Foot`)?.bone;
      if (!hip || !knee || !ankle) continue;
      for (const bone of [hip, knee, ankle]) this.restored.push({ bone, rotation: bone.quaternion.clone() });
      let depth = Infinity;
      for (const probe of this.probes) for (const index of probe[side]) {
        probe.mesh.getVertexPosition(index, point).applyMatrix4(probe.mesh.matrixWorld);
        depth = Math.min(depth, point.dot(normal) - planePoint.dot(normal));
      }
      if (!Number.isFinite(depth)) continue;
      const h = hip.getWorldPosition(new THREE.Vector3()), k = knee.getWorldPosition(new THREE.Vector3()), a = ankle.getWorldPosition(new THREE.Vector3());
      const footRotation = ankle.getWorldQuaternion(new THREE.Quaternion());
      const targetFoot = a.clone().addScaledVector(normal, .02 - depth);
      const upperLength = h.distanceTo(k), lowerLength = k.distanceTo(a);
      const axis = targetFoot.clone().sub(h).normalize();
      const reach = THREE.MathUtils.clamp(h.distanceTo(targetFoot), Math.abs(upperLength - lowerLength) + .001, upperLength + lowerLength - .001);
      const along = (upperLength ** 2 - lowerLength ** 2 + reach ** 2) / (2 * reach);
      const pole = k.clone().sub(h).addScaledVector(axis, -k.clone().sub(h).dot(axis));
      if (pole.lengthSq() < 1e-6) pole.copy(normal).addScaledVector(axis, -normal.dot(axis));
      if (pole.dot(normal) < 0) pole.negate();
      pole.normalize();
      const targetKnee = h.clone().addScaledVector(axis, along).addScaledVector(pole, Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2)));
      const turn = (bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3) => {
        const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
        const rotation = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
        bone.quaternion.premultiply(parent.clone().invert().multiply(rotation).multiply(parent)).normalize();
        actor.updateMatrixWorld(true);
      };
      turn(hip, k.clone().sub(h), targetKnee.clone().sub(h));
      const newKnee = knee.getWorldPosition(new THREE.Vector3());
      turn(knee, ankle.getWorldPosition(new THREE.Vector3()).sub(newKnee), targetFoot.clone().sub(newKnee));
      ankle.quaternion.copy(ankle.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(footRotation));
      actor.updateMatrixWorld(true);
    }
    // Expose the actual post-IK contact, not the pre-correction estimate.
    footN = Infinity; bodyN = Infinity; footY = Infinity;
    for (const probe of this.probes) {
      for (const index of probe.body) {
        probe.mesh.getVertexPosition(index, point).applyMatrix4(probe.mesh.matrixWorld);
        bodyN = Math.min(bodyN, point.dot(normal) - planePoint.dot(normal));
      }
      for (const index of probe.feet) {
        probe.mesh.getVertexPosition(index, point).applyMatrix4(probe.mesh.matrixWorld);
        footN = Math.min(footN, point.dot(normal) - planePoint.dot(normal));
        footY = Math.min(footY, point.y);
      }
    }
    // Different shin lengths can slightly lift a sole during the reach solve.
    // Restore the controller's foot height without changing facade clearance.
    if (Number.isFinite(footY)) {
      frame.position.add(new THREE.Vector3(0, actorPosition.y - footY, 0)
        .applyQuaternion(actor.getWorldQuaternion(new THREE.Quaternion()).invert()));
      actor.updateMatrixWorld(true);
    }
    this.footGap = footN;
    this.bodyClearance = bodyN;
  }
}
