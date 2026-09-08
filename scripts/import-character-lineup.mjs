import fs from 'node:fs/promises';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { retargetWorldSpace } from './retarget-world-space.mjs';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }
};
const imported = [
  ['amazing', 'amazing_spider_man_2_rigged.glb', 'X Bot@Hip Hop Dancing.fbx'],
  [
    'miles-new',
    'miles_morales_spiderman_rigged (1).glb',
    'X Bot@Belly Dance.fbx',
  ],
  [
    'no-way-home',
    'spiderman_no_way_home_rigged (2).glb',
    'X Bot@Booty Hip Hop Dance.fbx',
  ],
  [
    'tobey',
    'tobey_maguire_spider-_man_suit_rigged__animated (1).glb',
    'X Bot@Wave Hip Hop Dance.fbx',
  ],
  [
    'symbiote-tobey',
    'symbiote_spiderman_-_tobey_maguire.glb',
    'X Bot@House Dancing.fbx',
    'symbiote',
  ],
  [
    'miles-animated',
    'spiderman_-_miles_morales.glb',
    'X Bot@Snake Hip Hop Dance.fbx',
  ],
  [
    'mocap-spider',
    'spiderman_motion_capture__perception_neuron.glb',
    'X Bot@Step Hip Hop Dance.fbx',
  ],
  ['classic-spider', 'spiderman.glb', 'X Bot@Hip Hop Dancing.fbx'],
];
const loader = new GLTFLoader();
loader.register((parser) => {
  parser.loadTextureImage = () => Promise.resolve(new THREE.Texture());
  return { name: 'CPU textures' };
});
const parse = (bytes) =>
  loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
const source = (
  await parse(await fs.readFile('public/assets/suits/miguel-2099.glb'))
).scene;
const sourcePack = await parse(
  await fs.readFile('public/assets/animations/mixamo-2099.glb'),
);

const symbioteNames = new Map([
  ['GLTF_created_0_rootJoint_7', 'mixamorigHips'],
  ['Left_leg', 'mixamorigLeftUpLeg'],
  ['Left_knee', 'mixamorigLeftLeg'],
  ['Left_ankle', 'mixamorigLeftFoot'],
  ['Left_toe', 'mixamorigLeftToeBase'],
  ['Right_leg', 'mixamorigRightUpLeg'],
  ['Right_knee', 'mixamorigRightLeg'],
  ['Right_ankle', 'mixamorigRightFoot'],
  ['Right_toe', 'mixamorigRightToeBase'],
  ['Spine', 'mixamorigSpine'],
  ['Chest', 'mixamorigSpine1'],
  ['Upper_Chest', 'mixamorigSpine2'],
  ['Left_shoulder', 'mixamorigLeftShoulder'],
  ['Left_arm', 'mixamorigLeftArm'],
  ['Left_elbow', 'mixamorigLeftForeArm'],
  ['Left_wrist', 'mixamorigLeftHand'],
  ['Neck', 'mixamorigNeck'],
  ['Head', 'mixamorigHead'],
  ['Right_shoulder', 'mixamorigRightShoulder'],
  ['Right_arm', 'mixamorigRightArm'],
  ['Right_elbow', 'mixamorigRightForeArm'],
  ['Right_wrist', 'mixamorigRightHand'],
]);

function canonicalNodeName(name, profile) {
  if (!name) return name;
  if (profile === 'symbiote') {
    const base = name.replace(/_\d+_\d+$/, '').replace(/\s+/g, '_');
    const mapped = symbioteNames.get(base);
    if (mapped) return mapped;
  }
  if (/^mixamorig[:_]?/i.test(name))
    return name.replace(/^mixamorig[:_]?/i, 'mixamorig').replace(/_\d+.*$/, '');
  return name;
}

function rewriteMixamoNames(bytes, stripRigid = false, profile) {
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  for (const node of json.nodes ?? [])
    node.name = canonicalNodeName(node.name, profile);
  if (stripRigid)
    for (const node of json.nodes ?? [])
      if (node.mesh !== undefined && node.skin === undefined) delete node.mesh;
  json.animations = [];
  let encoded = Buffer.from(JSON.stringify(json));
  encoded = Buffer.concat([
    encoded,
    Buffer.alloc((4 - (encoded.length % 4)) % 4, 32),
  ]);
  const tail = bytes.subarray(20 + jsonLength);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + encoded.length + tail.length, 8);
  header.writeUInt32LE(encoded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, encoded, tail]);
}

async function loadDance(file) {
  const bytes = await fs.readFile(`/Users/vishayagarwal/Downloads/${file}`);
  let sourceBytes = bytes;
  if (bytes.toString('utf8', 0, 5) === '; FBX') {
    const text =
      ';' +
      '.'.repeat(256) +
      '\n' +
      bytes
        .toString('utf8')
        .replace(/^( +)/gm, (match) => '\t'.repeat(match.length / 4))
        .replace(/AnimCurveNode::([TRS])_[^"]+/g, 'AnimCurveNode::$1');
    sourceBytes = Buffer.from(text);
  }
  return new FBXLoader().parse(
    sourceBytes.buffer.slice(
      sourceBytes.byteOffset,
      sourceBytes.byteOffset + sourceBytes.byteLength,
    ),
    '',
  );
}

const reports = [];
for (const [id, modelFile, danceFile, profile] of imported) {
  const repaired = rewriteMixamoNames(
    await fs.readFile(`/Users/vishayagarwal/Downloads/${modelFile}`),
    id === 'miles-new',
    profile,
  );
  await fs.writeFile(`public/assets/suits/${id}.glb`, repaired);
  const target = (await parse(repaired)).scene;
  const traversal = sourcePack.animations
    .filter((clip) => !clip.name.startsWith('lobby:dance:'))
    .map((clip) => retargetWorldSpace(clip, source, target, 30));
  const danceSource = await loadDance(danceFile);
  const dance = retargetWorldSpace(
    danceSource.animations[0],
    danceSource,
    target,
    30,
  );
  dance.name = `lobby:dance:${id}`;
  const tracked = new Set(dance.tracks.map((track) => track.name));
  target.traverse((object) => {
    if (object.isBone && !tracked.has(`${object.name}.quaternion`))
      dance.tracks.push(
        new THREE.QuaternionKeyframeTrack(
          `${object.name}.quaternion`,
          [0, dance.duration],
          [...object.quaternion, ...object.quaternion],
        ),
      );
  });
  const required = [
    'hips',
    'spine',
    'spine1',
    'spine2',
    'head',
    'leftarm',
    'leftforearm',
    'lefthand',
    'rightarm',
    'rightforearm',
    'righthand',
    'leftupleg',
    'leftleg',
    'leftfoot',
    'rightupleg',
    'rightleg',
    'rightfoot',
  ];
  const mapped = new Set();
  target.traverse((object) => {
    if (!object.isBone) return;
    mapped.add(
      object.name
        .toLowerCase()
        .replace(/^mixamorig/, '')
        .replace(/_\d+.*$/, '')
        .replace(/[^a-z0-9]/g, ''),
    );
  });
  if (
    required.some((name) => !mapped.has(name)) ||
    traversal.some((clip) => clip.tracks.length < required.length) ||
    dance.tracks.length < required.length
  )
    throw new Error(`${id}: incomplete Mixamo mapping`);
  const meshes = [];
  target.traverse((object) => {
    if (object.isMesh) meshes.push(object);
  });
  meshes.forEach((mesh) => mesh.removeFromParent());
  const glb = await new GLTFExporter().parseAsync(target, {
    binary: true,
    animations: [...traversal, dance],
    onlyVisible: false,
  });
  await fs.writeFile(
    `public/assets/animations/mixamo-${id}.glb`,
    Buffer.from(glb),
  );
  reports.push({
    id,
    modelFile,
    danceFile,
    traversalClips: traversal.length,
    dance: dance.name,
    tracks: dance.tracks.length,
  });
  console.log(reports.at(-1));
}

const miguel = (
  await parse(await fs.readFile('public/assets/suits/miguel-2099.glb'))
).scene;
const step = await loadDance('X Bot@Step Hip Hop Dance.fbx');
const dance = retargetWorldSpace(step.animations[0], step, miguel, 30);
dance.name = 'lobby:dance:miguel';
const miguelMeshes = [];
miguel.traverse((object) => {
  if (object.isMesh) miguelMeshes.push(object);
});
miguelMeshes.forEach((mesh) => mesh.removeFromParent());
const prior = sourcePack.animations.filter(
  (clip) => !clip.name.startsWith('lobby:dance:'),
);
const miguelGlb = await new GLTFExporter().parseAsync(miguel, {
  binary: true,
  animations: [...prior, dance],
  onlyVisible: false,
});
await fs.writeFile(
  'public/assets/animations/mixamo-2099.glb',
  Buffer.from(miguelGlb),
);
reports.unshift({
  id: 'miguel',
  modelFile: 'miguel-2099.glb',
  danceFile: 'X Bot@Step Hip Hop Dance.fbx',
  traversalClips: prior.length,
  dance: dance.name,
  tracks: dance.tracks.length,
});
reports.push({
  id: 'miles-static-hd',
  modelFile: 'spiderman_miles_morales.glb',
  rejected:
    'No skeleton, skin weights, or animation bindings are present in the supplied GLB.',
});
await fs.writeFile(
  'docs/verification/character-rig-imports.json',
  JSON.stringify(reports, null, 2) + '\n',
);
