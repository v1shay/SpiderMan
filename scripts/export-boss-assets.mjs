import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const specs = [
  { id: 'hulk', source: '/Users/vishayagarwal/Downloads/hulk__marvel_rivals.glb', clips: [
    'Idle_C','Walk_Fwd_C','Walk_Bwd_C','Run_Fwd_C','Turn_R90_C','Turn_L90_C','Fight_Start','Giddiness','SmashLieDown','SmashRecover','Smashing',
    '101211_Punch_01','101211_Punch_02','101211_Punch_03','101211_Punch_04','101211_Punch_Turn_R','101211_Punch_Turn_L',
    '101291_Jump_Attack_Start','101291_Jump_Attack_Float','101291_Jump_Attack_Land','101291_Jump_Attack_Recovery',
    '101199_Throw_Start','101199_Throw_Loop','101199_Throw_End','Repulse_Start','Repulse_Loop','Repulse_End','Dead_B',
  ] },
  { id: 'venom', source: '/Users/vishayagarwal/Downloads/venom__marvel_rivals.glb', clips: [
    'Idle_C','Walk_Fwd_C','Walk_Bwd_C','Run_Fwd_C','Giddiness','SmashLieDown','SmashRecover','103581_Symbiote',
    '103511_Attack01','103511_Attack02','103511_Attack03','103521_Tentacles_01','103521_Tentacles_02','103541_Shackle',
    '103531_Descent_Start','103531_Descent_Loop','103531_Descent_End','103551_Ground_Flight_Start_C','103551_Ground_Flight_Loop_C','103551_Ground_Flight_End_C',
    '103551_Dash_R','103551_Dash_R_End','103551_Dash_L','103551_Dash_L_End','103501_Wallrun_F','Onwall_To_Jump','Onwall_Idle','Dead_B',
  ] },
  { id: 'ironman', source: 'public/assets/suits/ironman-mua.glb', clips: [
    'idle','menu_action','menu_idle','fly_idle','fly_slow','fly_fast','pain_blocking','victim1','blocking',
    'attack_heavy1','attack_knockback1','attack_knockback2','attack_light1','attack_light2','attack_light3','attack_stun2','attack_trip1',
    'power_1','power_1_loop','power_1_end','power_2','power_3','power_4','power_5','power_6','power_7','power_8','power_9','power_12','power_13','power_14',
  ] },
];
const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
await fs.mkdir('public/assets/bosses', { recursive: true });
const manifest = [];
for (const spec of specs) {
  const bytes = await fs.readFile(spec.source), jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const bin = bytes.subarray(28 + jsonLength);
  const originalClips = json.animations.length;
  json.animations = json.animations.filter(a => spec.clips.includes(a.name));
  if (json.animations.length !== spec.clips.length) throw new Error(`${spec.id}: missing required animation`);
  const used = new Set();
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
    Object.values(primitive.attributes).forEach(a => used.add(a));
    if (primitive.indices !== undefined) used.add(primitive.indices);
    for (const target of primitive.targets ?? []) Object.values(target).forEach(a => used.add(a));
  }
  for (const skin of json.skins ?? []) if (skin.inverseBindMatrices !== undefined) used.add(skin.inverseBindMatrices);
  for (const animation of json.animations) for (const sampler of animation.samplers) { used.add(sampler.input); used.add(sampler.output); }
  const accessors = [], views = [], chunks = [], accessorMap = new Map(), dedupe = new Map(); let offset = 0;
  function addView(data, target) {
    const hash = `${target ?? ''}:${crypto.createHash('sha256').update(data).digest('hex')}`;
    if (dedupe.has(hash)) return dedupe.get(hash);
    const padding = (4 - offset % 4) % 4;
    if (padding) { chunks.push(Buffer.alloc(padding)); offset += padding; }
    const index = views.length;
    views.push({ buffer: 0, byteOffset: offset, byteLength: data.length, ...(target ? { target } : {}) });
    chunks.push(data); offset += data.length; dedupe.set(hash, index); return index;
  }
  for (const old of used) {
    const a = json.accessors[old];
    if (a.sparse) throw new Error('Sparse source must be expanded before exporting');
    const v = json.bufferViews[a.bufferView], element = components[a.type] * sizes[a.componentType];
    const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = v.byteStride ?? element;
    const data = Buffer.alloc(a.count * element);
    for (let i = 0; i < a.count; i++) bin.copy(data, i * element, start + i * stride, start + i * stride + element);
    accessorMap.set(old, accessors.length);
    accessors.push({ ...a, bufferView: addView(data, v.target), byteOffset: 0 });
  }
  const imageReport = [];
  for (const image of json.images ?? []) {
    const view = json.bufferViews[image.bufferView];
    const original = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const info = await sharp(original).metadata();
    const pipeline = sharp(original).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true });
    const output = info.hasAlpha ? await pipeline.png({ compressionLevel: 9 }).toBuffer() : await pipeline.jpeg({ quality: 86, chromaSubsampling: '4:4:4' }).toBuffer();
    image.bufferView = addView(output); image.mimeType = info.hasAlpha ? 'image/png' : 'image/jpeg';
    imageReport.push({ sourceWidth: info.width, sourceHeight: info.height, originalBytes: original.length, outputBytes: output.length });
  }
  for (const mesh of json.meshes) for (const p of mesh.primitives) {
    for (const key of Object.keys(p.attributes)) p.attributes[key] = accessorMap.get(p.attributes[key]);
    if (p.indices !== undefined) p.indices = accessorMap.get(p.indices);
    for (const target of p.targets ?? []) for (const key of Object.keys(target)) target[key] = accessorMap.get(target[key]);
  }
  for (const skin of json.skins ?? []) if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = accessorMap.get(skin.inverseBindMatrices);
  for (const animation of json.animations) for (const sampler of animation.samplers) {
    sampler.input = accessorMap.get(sampler.input); sampler.output = accessorMap.get(sampler.output);
  }
  json.accessors = accessors; json.bufferViews = views;
  json.asset.extras = { ...json.asset.extras, localBossExport: 'Selected native gameplay clips; identical key values; textures limited to 1024px. Supplied local asset.' };
  let outputBin = Buffer.concat(chunks); outputBin = Buffer.concat([outputBin, Buffer.alloc((4 - outputBin.length % 4) % 4)]);
  json.buffers = [{ byteLength: outputBin.length }];
  let outputJson = Buffer.from(JSON.stringify(json)); outputJson = Buffer.concat([outputJson, Buffer.alloc((4 - outputJson.length % 4) % 4, 32)]);
  const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2,4);
  header.writeUInt32LE(28 + outputJson.length + outputBin.length, 8); header.writeUInt32LE(outputJson.length,12); header.writeUInt32LE(0x4e4f534a,16);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(outputBin.length); binHeader.writeUInt32LE(0x004e4942,4);
  const result = Buffer.concat([header, outputJson, binHeader, outputBin]);
  await fs.writeFile(path.join('public/assets/bosses', `${spec.id}.glb`), result);
  manifest.push({ id: spec.id, source: path.basename(spec.source), sourceBytes: bytes.length, outputBytes: result.length, originalClips,
    clips: spec.clips, sourceMetadata: json.asset.extras, images: imageReport });
  console.log(`${spec.id}: ${(bytes.length/1e6).toFixed(2)}MB -> ${(result.length/1e6).toFixed(2)}MB; ${originalClips} -> ${spec.clips.length} clips`);
}
await fs.writeFile('public/assets/bosses/manifest.json', JSON.stringify(manifest,null,2)+'\n');
