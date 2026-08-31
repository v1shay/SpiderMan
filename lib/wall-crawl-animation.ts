import * as THREE from 'three';
import reference from './wall-crawl-motion.json' with { type: 'json' };
import { animateRigBones, type RigBone } from './three-assets.ts';

/** Bake once per loaded rig, using anatomical roles and model-space rotations.
 * Unlike local quaternion copying, this handles Blender/Bip/exporter axes and
 * extra intermediate joints. No animation retargeting runs per render frame. */
export function createWallCrawlClip(root: THREE.Object3D, bones: readonly RigBone[], ownRigOnly = false) {
  const referenceRoot = root.parent ?? root;
  referenceRoot.updateMatrixWorld(true);
  const parentRotation = root.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
  const inverseParent = parentRotation.clone().invert();
  const rest = bones.map(({ bone }) => ({ local: bone.quaternion.clone(), canonical: inverseParent.clone().multiply(bone.getWorldQuaternion(new THREE.Quaternion())) }));
  const roles = reference.rotations as Record<string, number[]>;
  const directions = reference.directions as Record<string, number[]>;
  const children = reference.chains as Record<string, string>;
  const duration = ownRigOnly ? 1.4 : reference.duration;
  const times = ownRigOnly ? Array.from({ length: 43 }, (_, index) => index * duration / 42) : reference.times;
  const values = bones.map(() => [] as number[]);
  const rotation = new THREE.Quaternion(), currentParent = new THREE.Quaternion();
  for (let frame = 0; frame < times.length; frame++) {
    if (ownRigOnly) {
      // Pavitr's original-only policy: key a gait on his own calibrated rig,
      // without replacing his clips with another character's animation pack.
      animateRigBones(bones, 'crawl', times[frame] / duration * Math.PI * 2 / 9.5, 10);
      referenceRoot.updateMatrixWorld(true);
    }
    bones.forEach(({ bone, role }, index) => {
      if (!ownRigOnly && roles[role]) {
        rotation.fromArray(roles[role], frame * 4).normalize();
        bone.parent?.getWorldQuaternion(currentParent);
        bone.quaternion.copy(currentParent.invert().multiply(parentRotation).multiply(rotation).multiply(rest[index].canonical)).normalize();
        bone.updateWorldMatrix(false, true);
        // Match the source limb direction too: A/T/standing reference poses
        // differ across downloads, so rest-delta rotation alone can leave a
        // thigh or upper arm pointing out of the intended crawl silhouette.
        const child = bones.find(entry => entry.role === children[role])?.bone;
        if (child && directions[role]) {
          const actual = child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
          const desired = new THREE.Vector3().fromArray(directions[role], frame * 3).applyQuaternion(parentRotation).normalize();
          const correction = new THREE.Quaternion().setFromUnitVectors(actual, desired);
          const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
          bone.quaternion.premultiply(parent.clone().invert().multiply(correction).multiply(parent)).normalize();
          bone.updateWorldMatrix(false, true);
        }
      }
      if (ownRigOnly || roles[role]) values[index].push(...bone.quaternion.toArray());
    });
  }
  bones.forEach(({ bone }, index) => bone.quaternion.copy(rest[index].local));
  referenceRoot.updateMatrixWorld(true);
  const tracks = bones.flatMap(({ bone }, index) => values[index].length
    ? [new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values[index])] : []);
  if (tracks.length < 12) throw new Error('Wall crawl requires a complete humanoid limb mapping');
  return new THREE.AnimationClip(ownRigOnly ? 'local-wall-crawl' : 'retargeted-wall-crawl', duration, tracks);
}
