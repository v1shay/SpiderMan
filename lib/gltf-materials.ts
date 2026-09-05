import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** The supplied 2099 GLB uses the retired specular/glossiness extension.
 * Translate its authored colors at load time instead of rendering white. */
export function supportLegacyMaterials(loader: GLTFLoader) {
  loader.register(parser => ({
    name: 'KHR_materials_pbrSpecularGlossiness',
    beforeRoot() {
      for (const material of parser.json.materials ?? []) {
        const legacy = material.extensions?.KHR_materials_pbrSpecularGlossiness;
        if (!legacy || material.pbrMetallicRoughness) continue;
        material.pbrMetallicRoughness = {
          baseColorFactor: legacy.diffuseFactor ?? [1, 1, 1, 1],
          baseColorTexture: legacy.diffuseTexture,
          metallicFactor: 0,
          roughnessFactor: Math.max(.3, 1 - (legacy.glossinessFactor ?? .5)),
        };
      }
      return null;
    },
  }));
  return loader;
}

export function calibrate2099Materials(root: THREE.Object3D) {
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.emissiveIntensity = Math.min(material.emissiveIntensity, .65);
        material.roughness = .52;
      }
    }
  });
}
