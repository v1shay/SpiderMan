import fs from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { boneRole } from '../lib/three-assets.ts';
import { retargetWorldSpace } from './retarget-world-space.mjs';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }
};

const ROOT = process.cwd();
const DOWNLOADS = '/Users/vishayagarwal/Downloads';
const candidates = [
  {
    id: 'mua-spider',
    name: 'Ultimate Alliance Spider-Man',
    universe: 'Marvel Ultimate Alliance',
    source: path.join(DOWNLOADS, '09_spider-man_mua.glb'),
    profile: 'role',
    rejected: 'The Bip01 skin passes isolated retarget sampling but fails the integrated wall-crawl gate: keeping the torso upright leaves the soles 20–35 cm off the facade.',
  },
  {
    id: 'iron-spider',
    name: 'Iron Spider',
    universe: 'Marvel Cinematic Universe',
    source: path.join(DOWNLOADS, 'iron_spidermantexturedrigged.glb'),
    profile: 'role',
    normalizationMesh: 'Object_6',
    normalizationExcludeBones: 'bone180|shengzi',
    hiddenMeshes: ['Object_8', 'Object_9', 'Object_10'],
    rejected: 'The Bip01 body retargets for locomotion, but all tested crawl sources tilt the torso about 31 degrees sideways on a facade.',
  },
  {
    id: 'miguel-classic',
    name: 'Spider-Man 2099 (Classic)',
    universe: 'Earth-928',
    source: path.join(DOWNLOADS, 'miguel_ohara_spiderman_2099_rigged_textured.glb'),
    profile: 'stretch',
    rejected: 'The exported skin does not render after canonical bone repair, so traversal retargeting cannot be verified reliably.',
  },
  {
    id: 'scarlet-spider',
    name: 'Scarlet Spider',
    universe: 'Across the Spider-Verse',
    source: path.join(DOWNLOADS, 'scarlet_spider_across_the_spider_verse.glb'),
    profile: 'scarlet',
    rejected: 'The exported deformation bones are disconnected from the humanoid control hierarchy; full-pack sampling inverted limb directions.',
  },
  {
    id: 'amazing-2',
    name: 'The Amazing Spider-Man 2',
    universe: 'The Amazing Spider-Man 2 (2014)',
    source: path.join(DOWNLOADS, 'spider-man_2014_the_amazing_spider-man_2.glb'),
    profile: 'mixamo',
    rejected: 'The full rig animates, but integrated wall crawl leaves the soles about 18 cm off the facade on every tested orientation.',
  },
  {
    id: 'homecoming-tech',
    name: 'Homecoming Tech Suit',
    universe: 'Spider-Man: Homecoming',
    source: path.join(DOWNLOADS, 'spider-man_2017_homecoming_-_tech_suit.glb'),
    profile: 'mixamo',
  },
  {
    id: 'future-2099',
    name: 'Spider-Man 2099 (Future Fight)',
    universe: 'Marvel Future Fight',
    source: path.join(DOWNLOADS, 'spider-man_2099_marvel_future_fight_heroes.glb'),
    profile: 'role',
    normalizationMesh: 'Object_98',
    hiddenMeshes: ['Object_96', 'Object_100', 'Object_102', 'Object_104', 'Object_106', 'Object_108'],
    rejected: 'The skin is split across unsupported twist/deformation chains; sampled traversal poses detach the head, hands, and torso sections.',
  },
  {
    id: 'advanced-2',
    name: 'Advanced Suit 2.0',
    universe: "Marvel's Spider-Man 2",
    source: path.join(DOWNLOADS, 'spider-man_2_advanced_suit_2.0.glb'),
    profile: 'mixamo',
    rejected: 'Removed from the live selector after repeatable building and ground contact hitches during play.',
  },
  {
    id: 'symbiote-ps5',
    name: 'Symbiote Suit',
    universe: "Marvel's Spider-Man 2",
    source: path.join(DOWNLOADS, 'spider-man_2_symbiote_suit_ps5.glb'),
    profile: 'mixamo',
  },
  {
    id: 'pavitr-prabhakar',
    legacyIds: ['pavitr'],
    name: 'Pavitr Prabhakar',
    universe: 'Mumbattan',
    source: path.join(DOWNLOADS, 'spider-man_pavitr_prabhakar.glb'),
    profile: 'mixamo',
  },
  {
    id: 'playstation',
    name: 'Advanced Suit',
    universe: "Marvel's Spider-Man",
    source: path.join(DOWNLOADS, 'spider_man_playstation_rigged (1).glb'),
    profile: 'mixamo',
    rejected: 'Removed from the live selector after repeatable building and ground contact hitches during play.',
  },
  {
    id: 'spider-woman-atsv',
    legacyIds: ['spider-woman'],
    name: 'Spider-Woman',
    universe: 'Spider-Verse',
    source: path.join(DOWNLOADS, 'spider_woman_rigged (1).glb'),
    profile: 'spider-woman',
  },
  {
    id: 'classic-suit',
    name: 'Classic Spider-Man',
    universe: 'Earth-616',
    source: path.join(DOWNLOADS, 'spiderman_classic_textured_rigged.glb'),
    profile: 'mixamo',
  },
  {
    id: 'symbiote-advanced',
    legacyIds: ['symbiote'],
    name: 'Symbiote Advanced Suit',
    universe: 'PlayStation',
    source: path.join(DOWNLOADS, 'spiderman_venom_playstion_ps5.glb'),
    profile: 'mixamo',
    rejected: 'Removed from the live selector after repeatable building and ground contact hitches during play.',
  },
  {
    id: 'venom-insomniac',
    legacyIds: ['venom'],
    name: 'Venom',
    universe: "Marvel's Spider-Man 2",
    source: path.join(DOWNLOADS, 'the_venom_spiderman_2_playstation.glb'),
    profile: 'mixamo',
    visualScale: .9,
    rejected: 'The full rig animates, but integrated wall crawl leaves the soles about 30 cm off the facade and cannot produce reliable wall contact.',
  },
];

const canonicalNames = {
  hips: 'mixamorigHips',
  spine: 'mixamorigSpine',
  spine2: 'mixamorigSpine1',
  chest: 'mixamorigSpine2',
  neck: 'mixamorigNeck',
  head: 'mixamorigHead',
  leftShoulder: 'mixamorigLeftShoulder',
  leftArm: 'mixamorigLeftArm',
  leftForeArm: 'mixamorigLeftForeArm',
  leftHand: 'mixamorigLeftHand',
  rightShoulder: 'mixamorigRightShoulder',
  rightArm: 'mixamorigRightArm',
  rightForeArm: 'mixamorigRightForeArm',
  rightHand: 'mixamorigRightHand',
  leftUpLeg: 'mixamorigLeftUpLeg',
  leftLeg: 'mixamorigLeftLeg',
  leftFoot: 'mixamorigLeftFoot',
  rightUpLeg: 'mixamorigRightUpLeg',
  rightLeg: 'mixamorigRightLeg',
  rightFoot: 'mixamorigRightFoot',
};
const requiredRoles = Object.keys(canonicalNames);

const rigKey = (name) => name.toLowerCase().replace(/^.*:/, '').replace(/^(?:mixamorig|peter)/, '').replace(/_\d+.*$/, '').replace(/[^a-z0-9]/g, '');
function retargetWithRestFrames(clip, source, target, fps = 30) {
  const sourceBones = new Map();
  const targetBones = new Map();
  const saved = [];
  source.traverse((object) => { if (object.isBone) sourceBones.set(rigKey(object.name), object); });
  target.traverse((object) => {
    if (!object.isBone) return;
    targetBones.set(rigKey(object.name), object);
    saved.push([object, object.quaternion.clone()]);
  });
  source.updateMatrixWorld(true);
  target.updateMatrixWorld(true);
  const pairs = [];
  const segmentRoles = new Set(['leftarm', 'leftforearm', 'rightarm', 'rightforearm', 'leftupleg', 'leftleg', 'rightupleg', 'rightleg']);
  source.traverse((sourceBone) => {
    if (!sourceBone.isBone) return;
    const targetBone = targetBones.get(rigKey(sourceBone.name));
    if (!targetBone) return;
    const sourceRest = sourceBone.getWorldQuaternion(new THREE.Quaternion());
    const targetRest = targetBone.getWorldQuaternion(new THREE.Quaternion());
    const restOffset = sourceRest.invert().multiply(targetRest);
    const sourceChild = sourceBone.children.find((child) => child.isBone && targetBones.has(rigKey(child.name)));
    const targetChild = sourceChild ? targetBones.get(rigKey(sourceChild.name)) : null;
    const segmentOffset = new THREE.Quaternion();
    const useSegment = segmentRoles.has(rigKey(sourceBone.name))
      && sourceChild
      && targetChild?.parent === targetBone
      && sourceChild.position.lengthSq() > 1e-10
      && targetChild.position.lengthSq() > 1e-10;
    if (useSegment) segmentOffset.setFromUnitVectors(targetChild.position.clone().normalize(), sourceChild.position.clone().normalize());
    // Some rigs insert twist helpers between a main limb and its canonical
    // child. In that case there is no safe local segment axis to compare; use
    // the source world frame instead of applying a second rest-frame rotation.
    const mainSegment = segmentRoles.has(rigKey(sourceBone.name));
    pairs.push({
      sourceBone,
      targetBone,
      offset: useSegment ? segmentOffset : mainSegment ? new THREE.Quaternion() : restOffset,
      values: [],
    });
  });
  const mixer = new THREE.AnimationMixer(source);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const frames = Math.max(2, Math.ceil(clip.duration * fps) + 1);
  const times = [];
  const world = new THREE.Quaternion();
  const parentInverse = new THREE.Quaternion();
  for (let frame = 0; frame < frames; frame++) {
    const time = clip.duration * frame / (frames - 1);
    times.push(time);
    mixer.setTime(time);
    source.updateMatrixWorld(true);
    for (const pair of pairs) {
      pair.sourceBone.getWorldQuaternion(world).multiply(pair.offset);
      pair.targetBone.parent.getWorldQuaternion(parentInverse).invert();
      pair.targetBone.quaternion.copy(parentInverse.multiply(world)).normalize();
      pair.targetBone.updateMatrixWorld(true);
      pair.values.push(...pair.targetBone.quaternion.toArray());
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(source);
  for (const [bone, rotation] of saved) bone.quaternion.copy(rotation);
  target.updateMatrixWorld(true);
  return new THREE.AnimationClip(
    clip.name,
    Math.max(.35, clip.duration),
    pairs.map((pair) => new THREE.QuaternionKeyframeTrack(`${pair.targetBone.name}.quaternion`, times, pair.values)),
  );
}

const loader = new GLTFLoader();
loader.register((parser) => {
  parser.loadTextureImage = () => Promise.resolve(new THREE.Texture());
  return { name: 'CPU texture placeholder' };
});
const parse = (bytes) => loader.parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  '',
);

function exactRole(name, profile) {
  const raw = name.toLowerCase();
  if (profile === 'stretch' || profile === 'scarlet') {
    if (/^root\.x(?:_\d+)*$/.test(raw)) return 'hips';
    if (/^spine_01\.x(?:_\d+)*$/.test(raw)) return 'spine';
    if (/^spine_02\.x(?:_\d+)*$/.test(raw)) return 'spine2';
    if (/^spine_03\.x(?:_\d+)*$/.test(raw)) return 'chest';
    if (/^neck\.x(?:_\d+)*$/.test(raw)) return 'neck';
    if (/^head\.x(?:_\d+)*$/.test(raw)) return 'head';
    for (const [suffix, side] of [['l', 'left'], ['r', 'right']]) {
      if (new RegExp(`^shoulder\\.${suffix}(?:_\\d+)*$`).test(raw)) return `${side}Shoulder`;
      if (new RegExp(`^arm_stretch\\.${suffix}(?:_\\d+)*$`).test(raw)) return `${side}Arm`;
      if (new RegExp(`^forearm_stretch\\.${suffix}(?:_\\d+)*$`).test(raw)) return `${side}ForeArm`;
      if (new RegExp(`^hand\\.${suffix}(?:_\\d+)*$`).test(raw)) return `${side}Hand`;
      if (new RegExp(`^thigh_stretch\\.${suffix}(?:_\\d+)*$`).test(raw)) return `${side}UpLeg`;
      if (new RegExp(`^leg_stretch\\.${suffix}(?:_\\d+)*$`).test(raw)) return `${side}Leg`;
      if (new RegExp(`^foot\\.${suffix}(?:_\\d+)*$`).test(raw)) return `${side}Foot`;
    }
    return '';
  }
  if (profile === 'spider-woman') {
    if (/^spine_\d+/.test(raw)) return 'hips';
    if (raw.startsWith('spine.001_')) return 'spine';
    if (raw.startsWith('spine.002_')) return 'spine2';
    if (raw.startsWith('spine.003_')) return 'chest';
    if (raw.startsWith('spine.004_')) return 'neck';
    if (raw.startsWith('spine.005_')) return 'head';
    const left = /\.l(?:_|$)/.test(raw);
    const right = /\.r(?:_|$)/.test(raw);
    if (raw.startsWith('shoulder.') && left) return 'leftShoulder';
    if (raw.startsWith('shoulder.') && right) return 'rightShoulder';
    if (raw.startsWith('upper_arm.') && left) return 'leftArm';
    if (raw.startsWith('upper_arm.') && right) return 'rightArm';
    if (raw.startsWith('forearm.') && left) return 'leftForeArm';
    if (raw.startsWith('forearm.') && right) return 'rightForeArm';
    if (raw.startsWith('hand.') && left) return 'leftHand';
    if (raw.startsWith('hand.') && right) return 'rightHand';
    if (/^thigh\.[lr]_/.test(raw) && !/\.001_/.test(raw)) return left ? 'leftUpLeg' : 'rightUpLeg';
    if (raw.startsWith('shin.')) return left ? 'leftLeg' : 'rightLeg';
    if (raw.startsWith('foot.')) return left ? 'leftFoot' : 'rightFoot';
    return '';
  }
  return boneRole(name);
}

function roleScore(name, role, profile) {
  const raw = name.toLowerCase();
  let score = exactRole(name, profile) ? 100 : 0;
  if (/mixamorig/.test(raw)) score += 30;
  if (role === 'hips' && /pelvis/.test(raw)) score += 50;
  if (role === 'hips' && /hips/.test(raw)) score += 40;
  if (/end|twist|pole|ref|helper|control/.test(raw)) score -= 80;
  if (/^c[_.]/.test(raw)) score -= 35;
  return score;
}

function rewriteGlb(bytes, profile) {
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const jointIndices = new Set((json.skins ?? []).flatMap((skin) => skin.joints ?? []));
  const selected = new Map();
  for (const index of jointIndices) {
    const name = json.nodes[index]?.name ?? '';
    const role = exactRole(name, profile);
    if (!role || !canonicalNames[role]) continue;
    const prior = selected.get(role);
    if (!prior || roleScore(name, role, profile) > prior.score) selected.set(role, { index, name, score: roleScore(name, role, profile) });
  }
  const missing = requiredRoles.filter((role) => !selected.has(role));
  if (missing.length) throw new Error(`Missing canonical roles: ${missing.join(', ')}`);
  for (const node of json.nodes ?? []) {
    if (/^mixamorig[:_]?/i.test(node.name ?? '')) {
      node.name = node.name.replace(/^mixamorig[:_]?/i, 'mixamorig').replace(/_\d+.*$/, '').replace(/[^a-zA-Z0-9]/g, '');
    }
  }
  for (const [role, match] of selected) json.nodes[match.index].name = canonicalNames[role];
  json.animations = [];
  let encoded = Buffer.from(JSON.stringify(json));
  encoded = Buffer.concat([encoded, Buffer.alloc((4 - (encoded.length % 4)) % 4, 32)]);
  const tail = bytes.subarray(20 + jsonLength);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + encoded.length + tail.length, 8);
  header.writeUInt32LE(encoded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return {
    bytes: Buffer.concat([header, encoded, tail]),
    roles: Object.fromEntries([...selected].map(([role, match]) => [role, match.name])),
  };
}

const sourceRig = (await parse(await fs.readFile(path.join(ROOT, 'public/assets/suits/miguel-2099.glb')))).scene;
const sourcePack = await parse(await fs.readFile(path.join(ROOT, 'public/assets/animations/mixamo-2099.glb')));
const traversalSource = sourcePack.animations.filter((clip) => clip.name.startsWith('mixamo:'));
const danceFiles = [
  'X Bot@House Dancing.fbx',
  'X Bot@Hip Hop Dancing.fbx',
  'X Bot@Belly Dance.fbx',
  'X Bot@Booty Hip Hop Dance.fbx',
  'X Bot@Wave Hip Hop Dance.fbx',
  'X Bot@Snake Hip Hop Dance.fbx',
  'X Bot@Step Hip Hop Dance.fbx',
];
async function loadDance(file) {
  const bytes = await fs.readFile(path.join(DOWNLOADS, file));
  let sourceBytes = bytes;
  if (bytes.toString('utf8', 0, 5) === '; FBX') {
    const text = ';' + '.'.repeat(256) + '\n' + bytes.toString('utf8')
      .replace(/^( +)/gm, (match) => '\t'.repeat(match.length / 4))
      .replace(/AnimCurveNode::([TRS])_[^"]+/g, 'AnimCurveNode::$1');
    sourceBytes = Buffer.from(text);
  }
  const scene = new FBXLoader().parse(sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength), '');
  return { scene, clip: scene.animations[0], source: file };
}
const danceLibraries = await Promise.all(danceFiles.map(loadDance));

const requestedIds = new Set(
  (process.env.SUIT_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean),
);
const selectedCandidates = requestedIds.size
  ? candidates.filter((candidate) => requestedIds.has(candidate.id))
  : candidates;
let reports = [];
if (requestedIds.size) {
  const replacedIds = new Set(selectedCandidates.flatMap((candidate) => [
    candidate.id,
    ...(candidate.legacyIds ?? []),
  ]));
  try {
    reports = JSON.parse(await fs.readFile(
      path.join(ROOT, 'docs/verification/discovered-suit-imports.json'),
      'utf8',
    )).filter((report) => !replacedIds.has(report.id));
  } catch {
    reports = [];
  }
}
await fs.mkdir(path.join(ROOT, 'public/assets/suits'), { recursive: true });
await fs.mkdir(path.join(ROOT, 'public/assets/animations'), { recursive: true });
for (const candidate of selectedCandidates) {
  const index = candidates.indexOf(candidate);
  console.log(`Importing ${candidate.id} from ${path.basename(candidate.source)}`);
  if (candidate.rejected) {
    reports.push({ ...candidate, accepted: false, reason: candidate.rejected });
    console.error(`${candidate.id}: ${candidate.rejected}`);
    continue;
  }
  try {
    const sourceBytes = await fs.readFile(candidate.source);
    const repaired = rewriteGlb(sourceBytes, candidate.profile);
    const targetGltf = await parse(repaired.bytes);
    const target = targetGltf.scene;
    const retarget = candidate.profile === 'mixamo' ? retargetWorldSpace : retargetWithRestFrames;
    const traversal = traversalSource.map((clip) =>
      candidate.profile !== 'mixamo' && /crawl/i.test(clip.name)
        ? retargetWorldSpace(clip, sourceRig, target, 30)
        : retarget(clip, sourceRig, target, 30),
    );
    const danceSource = danceLibraries[index % danceLibraries.length];
    const dance = retarget(danceSource.clip, danceSource.scene, target, 30);
    dance.name = `lobby:dance:${candidate.id}`;
    const incomplete = traversal.filter((clip) => clip.tracks.length < requiredRoles.length);
    if (incomplete.length || dance.tracks.length < requiredRoles.length) throw new Error(`Incomplete retarget: ${incomplete.length} traversal clips, ${dance.tracks.length} dance tracks`);

    await fs.writeFile(path.join(ROOT, 'public/assets/suits', `${candidate.id}.glb`), repaired.bytes);
    const meshes = [];
    target.traverse((object) => { if (object.isMesh) meshes.push(object); });
    meshes.forEach((mesh) => mesh.removeFromParent());
    const animationGlb = await new GLTFExporter().parseAsync(target, {
      binary: true,
      animations: [...traversal, dance],
      onlyVisible: false,
    });
    await fs.writeFile(path.join(ROOT, 'public/assets/animations', `mixamo-${candidate.id}.glb`), Buffer.from(animationGlb));
    reports.push({
      ...candidate,
      source: candidate.source,
      sourceBytes: sourceBytes.length,
      roles: repaired.roles,
      traversalClips: traversal.length,
      dance: dance.name,
      danceSource: danceSource.source,
      danceTracks: dance.tracks.length,
      accepted: true,
    });
  } catch (error) {
    reports.push({
      ...candidate,
      source: candidate.source,
      accepted: false,
      reason: error instanceof Error ? error.message : String(error),
    });
    console.error(`${candidate.id}: ${reports.at(-1).reason}`);
  }
}
await fs.writeFile(
  path.join(ROOT, 'docs/verification/discovered-suit-imports.json'),
  `${JSON.stringify(reports, null, 2)}\n`,
);
console.log(`Accepted ${reports.filter((report) => report.accepted).length}/${reports.length} cataloged candidates.`);
