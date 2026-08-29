import * as THREE from 'three';
import type { SuitConfig } from '@/lib/game-config';

export type RigBone = {
  bone: THREE.Bone;
  base: THREE.Quaternion;
  role: string;
};

const stripBoneName = (name: string) => name
  .toLowerCase()
  .replace(/^.*:/, '')
  .replace(/_\d+.*$/, '')
  .replace(/[^a-z0-9]/g, '');

export function boneRole(name: string) {
  const raw = name.toLowerCase();
  const normalized = stripBoneName(name);
  const left = /left|(?:^|[._])l(?:[._]|$)|l_\d/.test(raw);
  const right = /right|(?:^|[._])r(?:[._]|$)|r_\d/.test(raw);
  if (/hips|pelvis|rootx/.test(normalized)) return 'hips';
  if (/spine2|spine03|chest/.test(normalized)) return 'chest';
  if (/spine1|spine02/.test(normalized)) return 'spine2';
  if (/spine|spine01/.test(normalized)) return 'spine';
  if (/head/.test(normalized) && !/top|end/.test(normalized)) return 'head';
  if (/neck|subneck/.test(normalized)) return 'neck';
  if ((/shoulder/.test(raw) || /clavicle/.test(raw)) && left) return 'leftShoulder';
  if ((/shoulder/.test(raw) || /clavicle/.test(raw)) && right) return 'rightShoulder';
  if ((/leftarm/.test(normalized) || (/arm.*stretch/.test(raw) && left) || /arm_left/.test(raw)) && !/fore|hand|finger|twist/.test(raw)) return 'leftArm';
  if ((/rightarm/.test(normalized) || (/arm.*stretch/.test(raw) && right) || /arm_right/.test(raw)) && !/fore|hand|finger|twist/.test(raw)) return 'rightArm';
  if ((/leftforearm/.test(normalized) || (/forearm.*stretch/.test(raw) && left)) && !/twist/.test(raw)) return 'leftForeArm';
  if ((/rightforearm/.test(normalized) || (/forearm.*stretch/.test(raw) && right)) && !/twist/.test(raw)) return 'rightForeArm';
  if (/lefthand/.test(normalized) || (/hand/.test(raw) && left && !/finger|thumb|index|middle|ring|pinky/.test(raw))) return 'leftHand';
  if (/righthand/.test(normalized) || (/hand/.test(raw) && right && !/finger|thumb|index|middle|ring|pinky/.test(raw))) return 'rightHand';
  if ((/leftupleg|leftthigh/.test(normalized) || (/thigh.*stretch/.test(raw) && left) || /leg_left_thigh/.test(raw)) && !/twist/.test(raw)) return 'leftUpLeg';
  if ((/rightupleg|rightthigh/.test(normalized) || (/thigh.*stretch/.test(raw) && right) || /leg_right_thigh/.test(raw)) && !/twist/.test(raw)) return 'rightUpLeg';
  if ((/leftleg/.test(normalized) || (/leg.*stretch/.test(raw) && left) || /leg_left_knee/.test(raw)) && !/up|thigh|twist/.test(raw)) return 'leftLeg';
  if ((/rightleg/.test(normalized) || (/leg.*stretch/.test(raw) && right) || /leg_right_knee/.test(raw)) && !/up|thigh|twist/.test(raw)) return 'rightLeg';
  return '';
}

export function isolateRiggedMeshes(root: THREE.Object3D) {
  const skinned: THREE.SkinnedMesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) skinned.push(object);
  });
  if (!skinned.length) return;
  const remove: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh) return;
    remove.push(object);
  });
  for (const object of remove) object.parent?.remove(object);
}

export function prepareMaterials(root: THREE.Object3D, renderer: THREE.WebGLRenderer, mode: 'character' | 'environment' | 'baked') {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    // Rigged suits can be split across several meshes with stale imported
    // bounds. Never let per-part frustum culling make hands or legs pop out.
    if (mode === 'character') object.frustumCulled = false;
    object.castShadow = mode === 'character';
    object.receiveShadow = mode !== 'character';
    const source = Array.isArray(object.material) ? object.material : [object.material];
    const prepared = source.map((material) => {
      const standard = material as THREE.MeshStandardMaterial;
      if (standard.map) {
        standard.map.colorSpace = THREE.SRGBColorSpace;
        standard.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      }
      if (standard.normalMap) standard.normalMap.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      if (mode !== 'baked') {
        if ('metalness' in standard && !Number.isFinite(standard.metalness)) standard.metalness = 0;
        if ('envMapIntensity' in standard) standard.envMapIntensity = mode === 'character' ? .72 : .45;
        if (mode === 'environment') {
          standard.flatShading = false;
          standard.roughness = Number.isFinite(standard.roughness) ? Math.max(.42, standard.roughness) : .78;
          standard.metalness = Number.isFinite(standard.metalness) ? Math.min(.55, standard.metalness) : .05;
        }
        standard.needsUpdate = true;
        return standard;
      }
      const baked = new THREE.MeshBasicMaterial({
        map: standard.map ?? null,
        color: (standard.color ?? new THREE.Color('white')).clone().multiplyScalar(.88),
        transparent: standard.transparent,
        opacity: standard.opacity,
        alphaTest: standard.alphaTest,
        side: standard.side,
      });
      baked.toneMapped = true;
      return baked;
    });
    object.material = Array.isArray(object.material) ? prepared : prepared[0];
  });
}

export function normalizeSuit(root: THREE.Object3D, suit: SuitConfig, height = 2.05) {
  isolateRiggedMeshes(root);
  root.rotation.y = suit.modelYaw;
  root.updateWorldMatrix(true, true);
  let box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  root.scale.multiplyScalar((height * (suit.visualScale ?? 1)) / Math.max(size.y, .001));
  root.updateWorldMatrix(true, true);
  box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.x += suit.visualOffsetX ?? 0;
  root.position.y -= box.min.y;
  root.position.z -= center.z;
  root.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(root);
}

export function collectRigBones(root: THREE.Object3D) {
  const bones: RigBone[] = [];
  const seen = new Set<string>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return;
    const role = boneRole(object.name);
    if (!role || seen.has(role)) return;
    seen.add(role);
    bones.push({ bone: object, base: object.quaternion.clone(), role });
  });
  return bones;
}

function isMixamoRig(root: THREE.Object3D) {
  let mixamo = false;
  root.traverse((object) => {
    if (object instanceof THREE.Bone && object.name.toLowerCase().includes('mixamorig')) mixamo = true;
  });
  return mixamo;
}

export function retargetMixamoClips(source: readonly THREE.AnimationClip[], sourceRig: THREE.Object3D, targetRig: THREE.Object3D) {
  if (!isMixamoRig(sourceRig) || !isMixamoRig(targetRig)) return [];
  const sourceBones = new Map<string, THREE.Bone>();
  const targetBones = new Map<string, THREE.Bone>();
  sourceRig.traverse((object) => {
    if (object instanceof THREE.Bone) sourceBones.set(stripBoneName(object.name), object);
  });
  targetRig.traverse((object) => {
    if (object instanceof THREE.Bone) targetBones.set(stripBoneName(object.name), object);
  });
  const sourceRestInverse = new THREE.Quaternion();
  const animated = new THREE.Quaternion();
  const delta = new THREE.Quaternion();
  const retargeted = new THREE.Quaternion();
  return source.map((clip) => {
    const tracks = clip.tracks.flatMap((track) => {
      const dot = track.name.lastIndexOf('.');
      if (dot < 0) return [];
      const sourceNode = track.name.slice(0, dot);
      const property = track.name.slice(dot + 1);
      if (property !== 'quaternion') return [];
      const sourceBone = sourceBones.get(stripBoneName(sourceNode));
      const targetBone = targetBones.get(stripBoneName(sourceNode));
      if (!sourceBone || !targetBone) return [];
      const cloned = track.clone();
      cloned.name = `${targetBone.name}.${property}`;
      sourceRestInverse.copy(sourceBone.quaternion).invert();
      for (let offset = 0; offset < cloned.values.length; offset += 4) {
        animated.fromArray(cloned.values, offset);
        delta.copy(sourceRestInverse).multiply(animated);
        retargeted.copy(targetBone.quaternion).multiply(delta).normalize().toArray(cloned.values, offset);
      }
      return [cloned];
    });
    return new THREE.AnimationClip(clip.name, Math.max(.35, clip.duration), tracks);
  }).filter((clip) => clip.tracks.length > 4);
}

export function poseOnlyClips(source: readonly THREE.AnimationClip[]) {
  return source.map((clip) => new THREE.AnimationClip(
    clip.name,
    clip.duration,
    clip.tracks.filter((track) => track.name.endsWith('.quaternion')).map((track) => track.clone()),
  )).filter((clip) => clip.duration > .1 && clip.tracks.length > 4);
}

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const deltaRotation = new THREE.Quaternion();
const targetRotation = new THREE.Quaternion();

export type ProceduralPose = 'idle' | 'run' | 'jump' | 'swing' | 'wall' | 'crawl' | 'dive' | 'zip' | 'hover' | 'fly';

export function animateRigBones(
  bones: readonly RigBone[],
  state: ProceduralPose,
  elapsed: number,
  delta: number,
  rigPreset?: SuitConfig['rigPreset'],
) {
  const stride = Math.sin(elapsed * 9.5);
  const breathe = Math.sin(elapsed * 2.4);
  for (const entry of bones) {
    let x = 0;
    let z = 0;
    if (rigPreset === 't-pose') {
      if (entry.role === 'leftArm') z = -1.05;
      if (entry.role === 'rightArm') z = 1.05;
      if (entry.role === 'leftForeArm' || entry.role === 'rightForeArm') x = -.12;
    }
    if (state === 'run') {
      if (entry.role === 'leftUpLeg') x = stride * .68;
      if (entry.role === 'rightUpLeg') x = -stride * .68;
      if (entry.role === 'leftLeg') x = Math.max(0, -stride) * .72;
      if (entry.role === 'rightLeg') x = Math.max(0, stride) * .72;
      if (entry.role === 'leftArm') x = -stride * .58;
      if (entry.role === 'rightArm') x = stride * .58;
      if (entry.role === 'chest') z = stride * .055;
    } else if (state === 'swing' || state === 'zip') {
      if (entry.role === 'leftArm') z = -1.18;
      if (entry.role === 'rightArm') z = 1.18;
      if (entry.role === 'leftForeArm' || entry.role === 'rightForeArm') x = -.48;
      if (entry.role === 'leftUpLeg') x = .28 + breathe * .12;
      if (entry.role === 'rightUpLeg') x = -.34 - breathe * .12;
      if (entry.role === 'leftLeg' || entry.role === 'rightLeg') x = .5;
      if (entry.role === 'chest' || entry.role === 'spine2') x = -.16;
    } else if (state === 'jump') {
      if (entry.role === 'leftArm') z = -.62;
      if (entry.role === 'rightArm') z = .62;
      if (entry.role === 'leftUpLeg' || entry.role === 'rightUpLeg') x = .28;
      if (entry.role === 'leftLeg' || entry.role === 'rightLeg') x = .42;
    } else if (state === 'wall' || state === 'crawl') {
      const crawl = state === 'crawl' ? stride : .3;
      if (entry.role === 'leftArm') z = -.82 + crawl * .28;
      if (entry.role === 'rightArm') z = .82 - crawl * .28;
      if (entry.role === 'leftForeArm' || entry.role === 'rightForeArm') x = -.58;
      if (entry.role === 'leftUpLeg') x = .48 - crawl * .32;
      if (entry.role === 'rightUpLeg') x = .48 + crawl * .32;
      if (entry.role === 'leftLeg' || entry.role === 'rightLeg') x = -.62;
    } else if (state === 'dive') {
      if (entry.role === 'leftArm') z = -.25;
      if (entry.role === 'rightArm') z = .25;
      if (entry.role === 'chest' || entry.role === 'spine2') x = .28;
      if (entry.role === 'leftUpLeg' || entry.role === 'rightUpLeg') x = -.18;
    } else if (state === 'hover' || state === 'fly') {
      const bank = state === 'fly' ? .16 : breathe * .03;
      if (entry.role === 'leftArm') z = -.18 - bank;
      if (entry.role === 'rightArm') z = .18 + bank;
      if (entry.role === 'leftForeArm' || entry.role === 'rightForeArm') x = .2;
      if (entry.role === 'leftUpLeg' || entry.role === 'rightUpLeg') x = state === 'fly' ? -.12 : .04;
      if (entry.role === 'chest' || entry.role === 'spine2') x = state === 'fly' ? .22 : breathe * .012;
    } else if (entry.role === 'chest' || entry.role === 'spine2') x = breathe * .018;
    deltaRotation.setFromAxisAngle(AXIS_X, x);
    targetRotation.copy(entry.base).multiply(deltaRotation);
    if (z) {
      deltaRotation.setFromAxisAngle(AXIS_Z, z);
      targetRotation.multiply(deltaRotation);
    }
    entry.bone.quaternion.slerp(targetRotation, 1 - Math.exp(-12 * delta));
  }
}
