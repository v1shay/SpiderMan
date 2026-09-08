import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MeshoptSimplifier } from 'three/examples/jsm/libs/meshopt_simplifier.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DISTRICTS } from '../lib/game-config.ts';
await MeshoptSimplifier.ready;
globalThis.FileReader = class {
  readAsArrayBuffer(b) {
    b.arrayBuffer().then((r) => {
      this.result = r;
      this.onloadend?.();
    });
  }
};
const loader = new GLTFLoader();
loader.register((p) => {
  p.loadTextureImage = () => Promise.resolve(new THREE.Texture());
  return { name: 'OfflineTextures' };
});
const reports = [];
for (const config of DISTRICTS) {
  const b = await fs.readFile(`public${config.model}`),
    g = await loader.parseAsync(
      b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      '',
    );
  g.scene.updateMatrixWorld(true);
  const output = new THREE.Group(),
    groups = new Map();
  let original = 0,
    reduced = 0;
  g.scene.traverse((mesh) => {
    if (!mesh.isMesh || mesh.isSkinnedMesh) return;
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld),
      p = geometry.attributes.position;
    const indices = geometry.index
      ? Uint32Array.from(geometry.index.array)
      : Uint32Array.from({ length: p.count }, (_, i) => i);
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const group of geometry.groups.length
      ? geometry.groups
      : [{ start: 0, count: indices.length, materialIndex: 0 }]) {
      const input = indices.slice(group.start, group.start + group.count);
      if (input.length < 3) continue;
      original += input.length / 3;
      const target = Math.min(
        input.length,
        Math.max(36, Math.floor((input.length * 0.035) / 3) * 3),
      );
    const [simplified] = MeshoptSimplifier.simplifySloppy(
      input,
      Float32Array.from(p.array),
        3,
        null,
        target,
        0.015,
      );
      const used = [...new Set(simplified)],
        remap = new Map(used.map((id, i) => [id, i]));
      const slim = new THREE.BufferGeometry();
      for (const [name, size] of [
        ['position', 3],
        ['normal', 3],
        ['uv', 2],
      ]) {
        const attr = geometry.getAttribute(name);
        const values = new Float32Array(used.length * size);
        for (let i = 0; i < used.length; i++)
          for (let k = 0; k < size; k++)
            values[i * size + k] = attr ? attr.getComponent(used[i], k) : 0;
        slim.setAttribute(name, new THREE.BufferAttribute(values, size));
      }
      slim.setIndex(Array.from(simplified, (i) => remap.get(i)));
      reduced += simplified.length / 3;
      const material = materials[group.materialIndex ?? 0],
        key = material.name || material.uuid;
      if (!groups.has(key)) groups.set(key, { material, geometries: [] });
      groups.get(key).geometries.push(slim);
    }
  });
  for (const [name, { material, geometries }] of groups) {
    const merged = mergeGeometries(geometries);
    const m = new THREE.MeshBasicMaterial({
      color: material.color ?? 0xffffff,
      side: material.side,
    });
    m.name = name;
    const mesh = new THREE.Mesh(merged, m);
    mesh.name = name;
    output.add(mesh);
  }
  const glb = await new GLTFExporter().parseAsync(output, { binary: true });
  await fs.writeFile(`public${config.horizonModel}`, Buffer.from(glb));
  const report = {
    city: config.id,
    sourceTriangles: original,
    horizonTriangles: reduced,
    drawGroups: groups.size,
    bytes: glb.byteLength,
  };
  reports.push(report);
  console.log(report);
}
await fs.writeFile(
  'public/assets/districts/horizon-manifest.json',
  JSON.stringify(reports, null, 2) + '\n',
);
