import * as THREE from 'three';
import type { SuitConfig } from '@/lib/game-config';

export type RigBone = {
  bone: THREE.Bone;
  base: THREE.Quaternion;
  axisX: THREE.Vector3;
  axisZ: THREE.Vector3;
  role: string;
};

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

const stripBoneName = (name: string) => name
  .toLowerCase()
  .replace(/^.*:/, '')
  // GLTFLoader removes `:` from node names, turning the new model's
  // `peter:Hips` namespace into `peterHips` before we see it.
  .replace(/^(?:mixamorig|peter)/, '')
  .replace(/_\d+.*$/, '')
  .replace(/[^a-z0-9]/g, '');

export function boneRole(name: string) {
  const raw = name.toLowerCase();
  const normalized = stripBoneName(name);
  // Spider-Woman's Blender export numbers a pelvis-to-head spine chain;
  // without these aliases every joint is deduplicated as the same "spine".
  if (raw === 'spine_68') return 'hips';
  if (raw.startsWith('spine001_')) return 'spine';
  if (raw.startsWith('spine002_')) return 'spine2';
  if (raw.startsWith('spine003_')) return 'chest';
  if (raw.startsWith('spine004_')) return 'neck';
  if (raw.startsWith('spine005_')) return 'head';
  if (raw.startsWith('spine006_')) return '';
  const left = /left|(?:^|[._\s])l(?:[._\s]|$)|l_\d/.test(raw);
  const right = /right|(?:^|[._\s])r(?:[._\s]|$)|r_\d/.test(raw);
  if (/hips|pelvis|rootx|bip001$/.test(normalized)) return 'hips';
  if (/spine2|spine03|chest/.test(normalized)) return 'chest';
  if (/spine1|spine02/.test(normalized)) return 'spine2';
  if (/spine|spine01/.test(normalized)) return 'spine';
  if (/head/.test(normalized) && !/top|end/.test(normalized)) return 'head';
  if (/neck|subneck/.test(normalized)) return 'neck';
  if ((/shoulder/.test(raw) || /clavicle/.test(raw)) && left) return 'leftShoulder';
  if ((/shoulder/.test(raw) || /clavicle/.test(raw)) && right) return 'rightShoulder';
  if ((/leftarm/.test(normalized) || (/upper.?arm/.test(raw) && left) || (/arm.*stretch/.test(raw) && left) || /arm_left/.test(raw)) && !/fore|hand|finger|twist/.test(raw)) return 'leftArm';
  if ((/rightarm/.test(normalized) || (/upper.?arm/.test(raw) && right) || (/arm.*stretch/.test(raw) && right) || /arm_right/.test(raw)) && !/fore|hand|finger|twist/.test(raw)) return 'rightArm';
  if ((/leftforearm/.test(normalized) || (/forearm/.test(raw) && left)) && !/twist/.test(raw)) return 'leftForeArm';
  if ((/rightforearm/.test(normalized) || (/forearm/.test(raw) && right)) && !/twist/.test(raw)) return 'rightForeArm';
  if (/lefthand/.test(normalized) || (/hand/.test(raw) && left && !/finger|thumb|index|middle|ring|pinky/.test(raw))) return 'leftHand';
  if (/righthand/.test(normalized) || (/hand/.test(raw) && right && !/finger|thumb|index|middle|ring|pinky/.test(raw))) return 'rightHand';
  if ((/leftupleg|leftthigh/.test(normalized) || (/thigh/.test(raw) && left) || /leg_left_thigh/.test(raw)) && !/twist/.test(raw)) return 'leftUpLeg';
  if ((/rightupleg|rightthigh/.test(normalized) || (/thigh/.test(raw) && right) || /leg_right_thigh/.test(raw)) && !/twist/.test(raw)) return 'rightUpLeg';
  if ((/leftleg/.test(normalized) || (/leg.*stretch/.test(raw) && left) || (/(?:shin|calf)/.test(raw) && left) || /leg_left_knee/.test(raw)) && !/up|thigh|twist/.test(raw)) return 'leftLeg';
  if ((/rightleg/.test(normalized) || (/leg.*stretch/.test(raw) && right) || (/(?:shin|calf)/.test(raw) && right) || /leg_right_knee/.test(raw)) && !/up|thigh|twist/.test(raw)) return 'rightLeg';
  if (/foot|toe/.test(raw) && left) return 'leftFoot';
  if (/foot|toe/.test(raw) && right) return 'rightFoot';
  return '';
}

export function isolateRiggedMeshes(root: THREE.Object3D, discardRigidMeshes = false) {
  const skinned: THREE.SkinnedMesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) skinned.push(object);
  });
  // Keep rigid authored meshes. Eyes, emblems, web shooters, and armor plates
  // are often parented directly to bones rather than skinned; deleting every
  // regular Mesh also removes those authored accessories. Only assets with a
  // verified complete static duplicate (Miles) opt into discarding this set.
  if (!skinned.length) return;
  if (!discardRigidMeshes) return;
  const rigid: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && !(object instanceof THREE.SkinnedMesh)) rigid.push(object);
  });
  rigid.forEach((object) => object.parent?.remove(object));
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
      if (standard.emissiveMap) {
        standard.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        standard.emissiveMap.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
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
      // Several city assets bake their entire facade texture into the glTF
      // emissive slot. Preserve that texture when converting environments to
      // low-latency unlit materials instead of replacing it with flat white.
      const bakedMap = standard.map ?? standard.emissiveMap ?? null;
      const bakedColor = standard.emissiveMap && !standard.map
        ? new THREE.Color('#9db3c2')
        : (standard.color ?? new THREE.Color('white')).clone().multiplyScalar(.88);
      const baked = new THREE.MeshBasicMaterial({
        map: bakedMap,
        color: bakedColor,
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
  isolateRiggedMeshes(root, suit.discardRigidMeshes);
  for (const name of suit.hiddenMeshes ?? []) {
    const mesh = root.getObjectByName(name);
    if (mesh) mesh.visible = false;
  }
  if (suit.modelRotation) root.rotation.set(...suit.modelRotation);
  else root.rotation.y = suit.modelYaw;
  // SkinnedMesh.updateMatrixWorld refreshes bindMatrixInverse. The similarly
  // named updateWorldMatrix does not, producing doubled transforms in bounds.
  root.updateMatrixWorld(true);
  const boundsRoot = (suit.normalizationMesh && root.getObjectByName(suit.normalizationMesh)) || root;
  const excludedBones = suit.normalizationExcludeBones ? new RegExp(suit.normalizationExcludeBones, 'i') : null;
  // These source-only mechanical appendages must remain animated, but must not
  // make the actual human body tiny/off-center. Measure once at load time.
  const measure = () => {
    if (!(boundsRoot instanceof THREE.SkinnedMesh) || !excludedBones) return new THREE.Box3().setFromObject(boundsRoot, true);
    const box = new THREE.Box3();
    const indices = boundsRoot.geometry.getAttribute('skinIndex');
    const weights = boundsRoot.geometry.getAttribute('skinWeight');
    const point = new THREE.Vector3();
    if (!indices || !weights) return box.setFromObject(boundsRoot);
    const excluded = boundsRoot.skeleton.bones.map((bone) => excludedBones.test(bone.name));
    for (let index = 0; index < indices.count; index++) {
      let excludedWeight = 0;
      for (let component = 0; component < 4; component++) {
        if (excluded[indices.getComponent(index, component)]) excludedWeight += weights.getComponent(index, component);
      }
      if (excludedWeight > .5) continue;
      boundsRoot.getVertexPosition(index, point).applyMatrix4(boundsRoot.matrixWorld);
      box.expandByPoint(point);
    }
    return box.isEmpty() ? box.setFromObject(boundsRoot) : box;
  };
  let box = measure();
  const size = box.getSize(new THREE.Vector3());
  root.scale.multiplyScalar((height * (suit.visualScale ?? 1)) / Math.max(size.y, .001));
  root.updateMatrixWorld(true);
  box = measure();
  const center = box.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.x += suit.visualOffsetX ?? 0;
  root.position.y -= box.min.y;
  root.position.y += suit.visualOffsetY ?? 0;
  root.position.z -= center.z;
  root.updateMatrixWorld(true);
  return measure();
}

export function collectRigBones(root: THREE.Object3D) {
  const bones: RigBone[] = [];
  const seen = new Set<string>();
  root.updateWorldMatrix(true, true);
  const rootWorldInverse = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const parentWorld = new THREE.Quaternion();
  const parentRelativeInverse = new THREE.Quaternion();
  root.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return;
    const role = boneRole(object.name);
    if (!role || seen.has(role)) return;
    seen.add(role);
    parentWorld.identity();
    object.parent?.getWorldQuaternion(parentWorld);
    parentRelativeInverse.copy(rootWorldInverse).multiply(parentWorld).invert();
    bones.push({
      bone: object,
      base: object.quaternion.clone(),
      axisX: AXIS_X.clone().applyQuaternion(parentRelativeInverse).normalize(),
      axisZ: AXIS_Z.clone().applyQuaternion(parentRelativeInverse).normalize(),
      role,
    });
  });
  return bones;
}

const MIXAMO_CORE_BONES = [
  'hips', 'spine', 'spine1', 'spine2', 'neck', 'head',
  'leftarm', 'leftforearm', 'lefthand', 'rightarm', 'rightforearm', 'righthand',
  'leftupleg', 'leftleg', 'leftfoot', 'rightupleg', 'rightleg', 'rightfoot',
] as const;

function isMixamoRig(root: THREE.Object3D) {
  let mixamo = false;
  const bones = new Set<string>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return;
    if (object.name.toLowerCase().includes('mixamorig')) mixamo = true;
    bones.add(stripBoneName(object.name));
  });
  // Some Mixamo exports replace the `mixamorig:` namespace with a character
  // namespace while preserving the exact Mixamo hierarchy.
  return mixamo || MIXAMO_CORE_BONES.every((bone) => bones.has(bone));
}

export function retargetMixamoClips(source: readonly THREE.AnimationClip[], sourceRig: THREE.Object3D, targetRig: THREE.Object3D) {
  // The offline 2099 pack is already calibrated to this exact character.
  // Animation-only glTF has transform nodes but no skin, so GLTFLoader does
  // not mark them as Bones. Validate every binding before using it directly.
  if (source.length && source.every(clip => clip.name.startsWith('mixamo:'))) {
    return source.filter(clip => clip.tracks.every(track => {
      const name = track.name.slice(0, track.name.lastIndexOf('.'));
      return targetRig.getObjectByName(name) instanceof THREE.Bone;
    })).map(clip => clip.clone());
  }
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
    clip.tracks.filter((track) => {
      if (track.name.endsWith('.quaternion') || track.name.endsWith('.scale')) return true;
      if (!track.name.endsWith('.position')) return false;
      const nodeName = track.name.slice(0, track.name.lastIndexOf('.'));
      // Preserve exporter-authored limb translations (the PlayStation rig
      // depends on them), while keeping player movement under the controller.
      return boneRole(nodeName) !== 'hips' && !/(?:^|[|:_])(?:root|armature)(?:$|[|:_])/i.test(nodeName);
    }).map((track) => track.clone()),
  )).filter((clip) => clip.tracks.length > 4).map((clip) => clip.duration <= .15 ? freezeClipPose(clip, 0, clip.name) : clip);
}

/** Hold an actual authored pose, without replaying a jump/landing every loop. */
export function freezeClipPose(clip: THREE.AnimationClip, time: number, name: string) {
  const tracks = clip.tracks.map((track) => {
    const frozen = track.clone();
    const value = track.InterpolantFactoryMethodLinear().evaluate(time);
    frozen.times = new Float32Array([0, 1]);
    frozen.values = new Float32Array([...value, ...value]);
    return frozen;
  });
  return new THREE.AnimationClip(name, 1, tracks);
}

export function suitAnimationClips(source: readonly THREE.AnimationClip[], suit: SuitConfig) {
  const clips = poseOnlyClips(source);
  if (suit.id === 'ironman' || suit.id === 'mua-spider') {
    // MUA uses additional locomotion roots above the pelvis. Their authored
    // rotations carry the flying pose; translation must not bypass physics.
    for (const clip of clips) clip.tracks = clip.tracks.filter(track => !/^(?:ActorRoot_\d+|Motion_\d+|Bip01_02)\.position$/.test(track.name));
  }
  if (suit.id !== 'playstation' && suit.id !== 'venom') return clips;
  const jump = clips.find((clip) => /jump/i.test(clip.name));
  if (!jump) return clips;
  // This exporter has a horizontal bind pose. Jump's first frame is the
  // measured grounded stance; frame 30 is a crouch. Hold exact first values
  // instead of subclipping a one-frame range with a zero/unstable duration.
  const tracks = jump.tracks.map((track) => {
    const frozen = track.clone();
    const first = Array.from(track.values.slice(0, track.getValueSize()));
    frozen.times = new Float32Array([0, 1]);
    frozen.values = new Float32Array([...first, ...first]);
    return frozen;
  });
  clips.unshift(new THREE.AnimationClip('stand', 1, tracks));
  return clips;
}

export function applySuitRestPose(root: THREE.Object3D, suit: SuitConfig, clips: readonly THREE.AnimationClip[]) {
  if (!['playstation', 'venom', 'pavitr', 'ironman'].includes(suit.id)) return;
  // Pavitr's exported rest pose is crouched/twisted. Measuring that pose makes
  // his actual Shell_Idle stand 64% taller than the rest of the lineup.
  const stand = suit.id === 'ironman' ? clips.find(clip => clip.name === 'menu_idle') : suit.id === 'pavitr'
    ? clips.find((clip) => /shell.?idle$/i.test(clip.name))
    : clips.find((clip) => clip.name === 'stand');
  if (!stand) return;
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(stand).play();
  mixer.update(0);
  // Leave the sampled transforms in place for bounds and procedural baselines.
  root.updateWorldMatrix(true, true);
}

const deltaRotation = new THREE.Quaternion();
const targetRotation = new THREE.Quaternion();

export type ProceduralPose = 'idle' | 'perch' | 'emote' | 'run' | 'jump' | 'fall' | 'swing' | 'wall' | 'crawl' | 'dive' | 'zip' | 'hover' | 'fly';

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
    } else if (state === 'perch') {
      if (entry.role === 'leftUpLeg') { x = -1.05; z = -.28; }
      if (entry.role === 'rightUpLeg') { x = -1.05; z = .28; }
      if (entry.role === 'leftLeg' || entry.role === 'rightLeg') x = 1.7;
      if (entry.role === 'leftArm') { x = -.6; z = -.32; }
      if (entry.role === 'rightArm') { x = -.6; z = .32; }
      if (entry.role === 'chest' || entry.role === 'spine2') x = .32;
    } else if (state === 'emote') {
      if (entry.role === 'rightArm') { x = -.3; z = .95 + Math.sin(elapsed * 3) * .12; }
      if (entry.role === 'rightForeArm') x = -.9 + Math.sin(elapsed * 4) * .15;
      if (entry.role === 'head') z = Math.sin(elapsed * 2) * .08;
    } else if (state === 'fall') {
      if (entry.role === 'leftArm') { x = -.25; z = -.68; }
      if (entry.role === 'rightArm') { x = -.2; z = .72; }
      if (entry.role === 'leftUpLeg') x = .28;
      if (entry.role === 'rightUpLeg') x = -.18;
      if (entry.role === 'leftLeg' || entry.role === 'rightLeg') x = .3;
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
    deltaRotation.setFromAxisAngle(entry.axisX, x);
    targetRotation.copy(entry.base).premultiply(deltaRotation);
    if (z) {
      deltaRotation.setFromAxisAngle(entry.axisZ, z);
      targetRotation.premultiply(deltaRotation);
    }
    entry.bone.quaternion.slerp(targetRotation, 1 - Math.exp(-12 * delta));
  }
}
