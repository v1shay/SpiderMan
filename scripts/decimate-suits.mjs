import fs from 'node:fs/promises';
import path from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';

const ROOT = process.cwd();
const TARGETS = {
  'symbiote-ps5': 190_000,
  'homecoming-tech': 85_000,
};
const PROTECTED_VERTICES = 2_500;
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

function parseGlb(bytes) {
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binHeader = 20 + jsonLength;
  if (bytes.readUInt32LE(binHeader + 4) !== 0x004e4942) throw new Error('GLB has no BIN chunk');
  const binLength = bytes.readUInt32LE(binHeader);
  return { json, bin: bytes.subarray(binHeader + 8, binHeader + 8 + binLength) };
}

function encodeGlb(json, bin) {
  json.buffers = [{ byteLength: bin.length }];
  let jsonBytes = Buffer.from(JSON.stringify(json));
  jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc((4 - jsonBytes.length % 4) % 4, 0x20)]);
  const binBytes = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + binBytes.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBytes.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binBytes.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonBytes, binHeader, binBytes]);
}

function accessorLayout(json, index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const components = TYPE_COMPONENTS[accessor.type];
  const componentBytes = COMPONENT_BYTES[accessor.componentType];
  const elementBytes = components * componentBytes;
  return {
    accessor, view, components, componentBytes, elementBytes,
    start: (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0),
    stride: view.byteStride ?? elementBytes,
  };
}

function readIndices(json, bin, index) {
  const { accessor, start, stride, componentBytes } = accessorLayout(json, index);
  const result = new Uint32Array(accessor.count);
  for (let i = 0; i < result.length; i++) {
    const offset = start + i * stride;
    result[i] = componentBytes === 1 ? bin.readUInt8(offset)
      : componentBytes === 2 ? bin.readUInt16LE(offset)
        : bin.readUInt32LE(offset);
  }
  return result;
}

function readPositions(json, bin, index) {
  const { accessor, start, stride } = accessorLayout(json, index);
  if (accessor.componentType !== 5126 || accessor.type !== 'VEC3')
    throw new Error('Simplifier requires float VEC3 positions');
  const result = new Float32Array(accessor.count * 3);
  for (let i = 0; i < accessor.count; i++)
    for (let c = 0; c < 3; c++) result[i * 3 + c] = bin.readFloatLE(start + i * stride + c * 4);
  return result;
}

function compactAccessor(json, bin, sourceIndex, remap, count, addData) {
  const layout = accessorLayout(json, sourceIndex);
  const data = Buffer.alloc(count * layout.elementBytes);
  for (let old = 0; old < remap.length; old++) {
    const next = remap[old];
    if (next === 0xffffffff) continue;
    bin.copy(data, next * layout.elementBytes, layout.start + old * layout.stride,
      layout.start + old * layout.stride + layout.elementBytes);
  }
  const bufferView = addData(data, layout.view.target);
  const accessor = { ...layout.accessor, bufferView, byteOffset: 0, count };
  delete accessor.sparse;
  return json.accessors.push(accessor) - 1;
}

function minMaxPosition(json, bin, accessorIndex) {
  const values = readPositions(json, bin, accessorIndex);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < values.length; i += 3)
    for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], values[i + c]); max[c] = Math.max(max[c], values[i + c]); }
  return { min, max };
}

function simplifyGlb(bytes, targetVertices) {
  const { json, bin } = parseGlb(bytes);
  const newViewData = new Map();
  const addData = (data, target) => {
    const view = { buffer: 0, byteOffset: 0, byteLength: data.length };
    if (target) view.target = target;
    const index = json.bufferViews.push(view) - 1;
    newViewData.set(index, data);
    return index;
  };
  const primitives = (json.meshes ?? []).flatMap((mesh) => mesh.primitives ?? []);
  const beforeVertices = primitives.reduce((sum, primitive) => sum + json.accessors[primitive.attributes.POSITION].count, 0);
  const protectedVertices = primitives.reduce((sum, primitive) => {
    const count = json.accessors[primitive.attributes.POSITION].count;
    return sum + (count <= PROTECTED_VERTICES ? count : 0);
  }, 0);
  const reducibleVertices = Math.max(1, beforeVertices - protectedVertices);
  const ratio = Math.max(.22, Math.min(1, (targetVertices - protectedVertices) / reducibleVertices));
  const details = [];

  for (const primitive of primitives) {
    if ((primitive.mode ?? 4) !== 4 || primitive.indices == null) continue;
    const positionIndex = primitive.attributes.POSITION;
    const vertexCount = json.accessors[positionIndex].count;
    if (vertexCount <= PROTECTED_VERTICES || ratio >= .995) continue;
    const positions = readPositions(json, bin, positionIndex);
    const indices = readIndices(json, bin, primitive.indices);
    const targetIndexCount = Math.max(3, Math.floor(indices.length * ratio / 3) * 3);
    const [simplified, error] = MeshoptSimplifier.simplify(
      indices, positions, 3, targetIndexCount, .018, ['Regularize'],
    );
    const [remap, unique] = MeshoptSimplifier.compactMesh(simplified);

    const rewritten = {};
    for (const [semantic, accessorIndex] of Object.entries(primitive.attributes))
      rewritten[semantic] = compactAccessor(json, bin, accessorIndex, remap, unique, addData);
    primitive.attributes = rewritten;
    for (const target of primitive.targets ?? [])
      for (const [semantic, accessorIndex] of Object.entries(target))
        target[semantic] = compactAccessor(json, bin, accessorIndex, remap, unique, addData);

    const positionAccessor = json.accessors[primitive.attributes.POSITION];
    const positionView = newViewData.get(positionAccessor.bufferView);
    const mm = minMaxPosition(json, positionView, primitive.attributes.POSITION);
    positionAccessor.min = mm.min;
    positionAccessor.max = mm.max;

    const indexComponent = unique <= 65535 ? 5123 : 5125;
    const indexBytes = Buffer.alloc(simplified.length * COMPONENT_BYTES[indexComponent]);
    for (let i = 0; i < simplified.length; i++) {
      if (indexComponent === 5123)
        indexBytes.writeUInt16LE(simplified[i], i * 2);
      else indexBytes.writeUInt32LE(simplified[i], i * 4);
    }
    const indexView = addData(indexBytes, 34963);
    primitive.indices = json.accessors.push({
      bufferView: indexView, byteOffset: 0, componentType: indexComponent,
      count: simplified.length, type: 'SCALAR', min: [0], max: [unique - 1],
    }) - 1;
    details.push({ beforeVertices: vertexCount, afterVertices: unique,
      beforeTriangles: indices.length / 3, afterTriangles: simplified.length / 3,
      error });
  }

  // Remove dead accessors and buffer views, including the original high-poly
  // vertex streams, then tightly repack the GLB binary chunk.
  const usedAccessors = new Set();
  for (const primitive of primitives) {
    if (primitive.indices != null) usedAccessors.add(primitive.indices);
    Object.values(primitive.attributes ?? {}).forEach((index) => usedAccessors.add(index));
    for (const target of primitive.targets ?? []) Object.values(target).forEach((index) => usedAccessors.add(index));
  }
  for (const skin of json.skins ?? []) if (skin.inverseBindMatrices != null) usedAccessors.add(skin.inverseBindMatrices);
  for (const animation of json.animations ?? [])
    for (const sampler of animation.samplers ?? []) { usedAccessors.add(sampler.input); usedAccessors.add(sampler.output); }

  // Source exporters commonly interleave every vertex stream in one enormous
  // buffer view. Detach even the unchanged accessors so dead high-poly bytes do
  // not survive merely because a small mesh shared that original view.
  for (const accessorIndex of usedAccessors) {
    const accessor = json.accessors[accessorIndex];
    if (accessor.bufferView == null || newViewData.has(accessor.bufferView)) continue;
    const layout = accessorLayout(json, accessorIndex);
    const data = Buffer.alloc(accessor.count * layout.elementBytes);
    for (let i = 0; i < accessor.count; i++)
      bin.copy(data, i * layout.elementBytes, layout.start + i * layout.stride,
        layout.start + i * layout.stride + layout.elementBytes);
    accessor.bufferView = addData(data, layout.view.target);
    accessor.byteOffset = 0;
  }
  const accessorRemap = new Map();
  json.accessors = json.accessors.filter((_, index) => {
    if (!usedAccessors.has(index)) return false;
    accessorRemap.set(index, accessorRemap.size);
    return true;
  });
  for (const primitive of primitives) {
    if (primitive.indices != null) primitive.indices = accessorRemap.get(primitive.indices);
    for (const semantic of Object.keys(primitive.attributes ?? {})) primitive.attributes[semantic] = accessorRemap.get(primitive.attributes[semantic]);
    for (const target of primitive.targets ?? []) for (const semantic of Object.keys(target)) target[semantic] = accessorRemap.get(target[semantic]);
  }
  for (const skin of json.skins ?? []) if (skin.inverseBindMatrices != null) skin.inverseBindMatrices = accessorRemap.get(skin.inverseBindMatrices);
  for (const animation of json.animations ?? [])
    for (const sampler of animation.samplers ?? []) { sampler.input = accessorRemap.get(sampler.input); sampler.output = accessorRemap.get(sampler.output); }

  const usedViews = new Set(json.accessors.map((accessor) => accessor.bufferView).filter((index) => index != null));
  for (const image of json.images ?? []) if (image.bufferView != null) usedViews.add(image.bufferView);
  const viewRemap = new Map(), chunks = [];
  let offset = 0;
  const oldViews = json.bufferViews;
  json.bufferViews = oldViews.filter((_, index) => {
    if (!usedViews.has(index)) return false;
    viewRemap.set(index, viewRemap.size);
    return true;
  });
  for (const [oldIndex, newIndex] of viewRemap) {
    const oldView = oldViews[oldIndex];
    const data = newViewData.get(oldIndex)
      ?? bin.subarray(oldView.byteOffset ?? 0, (oldView.byteOffset ?? 0) + oldView.byteLength);
    const padding = (4 - offset % 4) % 4;
    if (padding) { chunks.push(Buffer.alloc(padding)); offset += padding; }
    json.bufferViews[newIndex].byteOffset = offset;
    json.bufferViews[newIndex].byteLength = data.length;
    chunks.push(data);
    offset += data.length;
  }
  for (const accessor of json.accessors) if (accessor.bufferView != null) accessor.bufferView = viewRemap.get(accessor.bufferView);
  for (const image of json.images ?? []) if (image.bufferView != null) image.bufferView = viewRemap.get(image.bufferView);
  const packedBin = Buffer.concat(chunks);
  const afterVertices = primitives.reduce((sum, primitive) => sum + json.accessors[primitive.attributes.POSITION].count, 0);
  return { bytes: encodeGlb(json, packedBin), beforeVertices, afterVertices, details };
}

await MeshoptSimplifier.ready;
const reports = [];
for (const [id, target] of Object.entries(TARGETS)) {
  const file = path.join(ROOT, 'public/assets/suits', `${id}.glb`);
  const original = await fs.readFile(file);
  const result = simplifyGlb(original, target);
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, result.bytes);
  await fs.rename(temporary, file);
  const report = {
    id, target, beforeVertices: result.beforeVertices, afterVertices: result.afterVertices,
    reductionPercent: +(100 * (1 - result.afterVertices / result.beforeVertices)).toFixed(1),
    beforeBytes: original.length, afterBytes: result.bytes.length, primitives: result.details,
  };
  reports.push(report);
  console.log(report);
}
await fs.writeFile(path.join(ROOT, 'docs/verification/decimated-suits.json'), `${JSON.stringify(reports, null, 2)}\n`);
