import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { boneRole } from '../lib/three-assets.ts';
import { SUITS } from '../lib/game-config.ts';

const ROOT = process.cwd();
const DOWNLOADS = '/Users/vishayagarwal/Downloads';
const HISTORICAL = '/Users/vishayagarwal/Documents/Codex/2026-08-28/i-wa/work';
const REQUIRED_ROLES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'leftShoulder', 'leftArm', 'leftForeArm', 'leftHand',
  'rightShoulder', 'rightArm', 'rightForeArm', 'rightHand',
  'leftUpLeg', 'leftLeg', 'leftFoot',
  'rightUpLeg', 'rightLeg', 'rightFoot',
];

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
loader.register((parser) => {
  parser.loadTextureImage = () => Promise.resolve(new THREE.Texture());
  return { name: 'CPU texture placeholder' };
});

const parse = async (bytes) => loader.parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  '',
);

async function existingFiles(directory, predicate) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => path.join(directory, entry.name));
}

const downloaded = await existingFiles(
  DOWNLOADS,
  (name) => /(?:spider|venom)/i.test(name) && /\.gl(?:b|tf)$/i.test(name),
);
const historical = [
  path.join(HISTORICAL, 'ps4-clean.glb'),
  path.join(HISTORICAL, 'removed-webbed-suit/original.glb'),
].filter(async (file) => fs.stat(file).then(() => true, () => false));
const publicFiles = await existingFiles(
  path.join(ROOT, 'public/assets/suits'),
  (name) => /\.glb$/i.test(name),
);

const activeByHash = new Map();
for (const suit of SUITS) {
  const file = path.join(ROOT, 'public', suit.model);
  const bytes = await fs.readFile(file);
  activeByHash.set(sha256(bytes), { id: suit.id, name: suit.name });
}
const publicByHash = new Map();
for (const file of publicFiles) {
  const bytes = await fs.readFile(file);
  publicByHash.set(sha256(bytes), path.basename(file));
}

const records = [];
for (const file of [...downloaded, ...historical]) {
  const bytes = await fs.readFile(file).catch(() => null);
  if (!bytes) continue;
  const hash = sha256(bytes);
  const record = {
    file,
    fileName: path.basename(file),
    bytes: bytes.length,
    sha256: hash,
    activeMatch: activeByHash.get(hash) ?? null,
    publicArchiveMatch: publicByHash.get(hash) ?? null,
  };
  try {
    const gltf = await parse(bytes);
    const boneNames = [];
    const roles = new Map();
    let meshes = 0;
    let skinnedMeshes = 0;
    let vertices = 0;
    let skinnedVertices = 0;
    gltf.scene.traverse((object) => {
      if (object.isBone) {
        boneNames.push(object.name);
        const role = boneRole(object.name);
        if (role && !roles.has(role)) roles.set(role, object.name);
      }
      if (!object.isMesh) return;
      meshes++;
      const count = object.geometry?.attributes?.position?.count ?? 0;
      vertices += count;
      if (object.isSkinnedMesh) {
        skinnedMeshes++;
        skinnedVertices += count;
      }
    });
    const missingRoles = REQUIRED_ROLES.filter((role) => !roles.has(role));
    const compatible = skinnedMeshes > 0 && boneNames.length > 0 && missingRoles.length === 0;
    Object.assign(record, {
      parseError: null,
      scenes: gltf.scenes.length,
      meshes,
      skinnedMeshes,
      vertices,
      skinnedVertices,
      bones: boneNames.length,
      boneNames,
      mappedRoles: Object.fromEntries(roles),
      missingRoles,
      embeddedAnimations: gltf.animations.map((clip) => ({
        name: clip.name,
        duration: clip.duration,
        tracks: clip.tracks.length,
      })),
      rigCompatible: compatible,
      compatibilityReason: compatible
        ? 'Skinned humanoid with every required traversal bone role.'
        : skinnedMeshes === 0
          ? 'No skinned mesh.'
          : boneNames.length === 0
            ? 'No skeleton bones.'
            : `Missing required humanoid roles: ${missingRoles.join(', ')}.`,
    });
  } catch (error) {
    Object.assign(record, {
      parseError: error instanceof Error ? error.message : String(error),
      rigCompatible: false,
      compatibilityReason: 'The GLB could not be parsed by the game loader.',
    });
  }
  records.push(record);
  console.log(JSON.stringify({
    file: record.fileName,
    active: record.activeMatch?.id ?? null,
    archive: record.publicArchiveMatch,
    skinnedMeshes: record.skinnedMeshes,
    bones: record.bones,
    missingRoles: record.missingRoles,
    compatible: record.rigCompatible,
    error: record.parseError,
  }));
}

const duplicateGroups = Object.values(Object.groupBy(records, (record) => record.sha256))
  .filter((group) => group.length > 1)
  .map((group) => group.map((record) => record.file));
const unique = [...new Map(records.map((record) => [record.sha256, record])).values()];
const report = {
  generatedAt: new Date().toISOString(),
  roots: [DOWNLOADS, HISTORICAL],
  activeSuitCount: SUITS.length,
  scannedFiles: records.length,
  uniqueFiles: unique.length,
  duplicateGroups,
  records,
};
await fs.mkdir(path.join(ROOT, 'docs/verification'), { recursive: true });
await fs.writeFile(
  path.join(ROOT, 'docs/verification/downloaded-spider-rigs.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(`Wrote ${unique.length} unique candidates from ${records.length} files.`);
