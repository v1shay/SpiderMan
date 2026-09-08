import * as THREE from 'three';

/** Shared source geometry, repeated to the fog horizon; collision remains in RepeatingMeshWorld. */
export class CityHorizon {
  readonly root = new THREE.Group();
  private readonly texturedMeshes: THREE.InstancedMesh[] = [];
  private readonly silhouetteMeshes: THREE.InstancedMesh[] = [];
  private readonly bounds: THREE.Box3;
  private readonly frustum = new THREE.Frustum();
  private readonly matrix = new THREE.Matrix4();
  private readonly box = new THREE.Box3();
  readonly width: number;
  readonly depth: number;
  constructor(
    source: THREE.Object3D,
    transform: THREE.Matrix4,
    full: THREE.Object3D,
    width: number,
    depth: number,
  ) {
    this.width = width;
    this.depth = depth;
    const materials = new Map<string, THREE.Material>();
    full.traverse((o) => {
      if (o instanceof THREE.Mesh)
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          materials.set(m.name, m);
    });
    const capacity =
      (2 * Math.ceil(3000 / width) + 5) * (2 * Math.ceil(3000 / depth) + 5);
    source.updateMatrixWorld(true);
    source.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const geometry = o.geometry
        .clone()
        .applyMatrix4(
          new THREE.Matrix4().multiplyMatrices(transform, o.matrixWorld),
        );
      const sourceMaterial = Array.isArray(o.material)
        ? o.material[0]
        : o.material;
      const detailedMaterial =
        materials.get(sourceMaterial.name) ?? sourceMaterial;
      const silhouetteMaterial = detailedMaterial.clone();
      if ('map' in silhouetteMaterial) silhouetteMaterial.map = null;
      silhouetteMaterial.name = `${detailedMaterial.name}:distant-silhouette`;
      for (const [collection, material] of [
        [this.texturedMeshes, detailedMaterial],
        [this.silhouetteMeshes, silhouetteMaterial],
      ] as const) {
        const mesh = new THREE.InstancedMesh(geometry, material, capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.count = 0;
        collection.push(mesh);
        this.root.add(mesh);
      }
    });
    const floor = full.children.find((o) => o.userData.walkableStreetSurface);
    if (floor instanceof THREE.Mesh) {
      const geometry = floor.geometry.clone().applyMatrix4(floor.matrixWorld);
      const mesh = new THREE.InstancedMesh(geometry, floor.material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.texturedMeshes.push(mesh);
      this.root.add(mesh);
    }
    this.bounds = new THREE.Box3().makeEmpty();
    for (const m of this.texturedMeshes) {
      m.geometry.computeBoundingBox();
      this.bounds.union(m.geometry.boundingBox!);
    }
  }
  update(
    camera: THREE.PerspectiveCamera,
    position: THREE.Vector3,
    fullTiles: ReadonlyMap<string, unknown>,
  ) {
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(
      this.matrix.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      ),
    );
    const cx = Math.round(position.x / this.width),
      cz = Math.round(position.z / this.depth);
    const rx = Math.ceil(camera.far / this.width) + 1,
      rz = Math.ceil(camera.far / this.depth) + 1;
    let texturedCount = 0;
    let silhouetteCount = 0;
    for (let x = cx - rx; x <= cx + rx; x++)
      for (let z = cz - rz; z <= cz + rz; z++) {
        if (fullTiles.has(`${x}:${z}`)) continue;
        this.box
          .copy(this.bounds)
          .translate(new THREE.Vector3(x * this.width, 0, z * this.depth));
        if (
          this.box.distanceToPoint(position) > camera.far ||
          !this.frustum.intersectsBox(this.box)
        )
          continue;
        this.matrix.makeTranslation(x * this.width, 0, z * this.depth);
        const distance = this.box.distanceToPoint(position);
        const textured =
          distance < Math.min(950, Math.max(this.width, this.depth) * 2.6);
        const collection = textured
          ? this.texturedMeshes
          : this.silhouetteMeshes;
        const index = textured ? texturedCount++ : silhouetteCount++;
        for (const mesh of collection) mesh.setMatrixAt(index, this.matrix);
      }
    for (const mesh of this.texturedMeshes) {
      mesh.count = texturedCount;
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const mesh of this.silhouetteMeshes) {
      mesh.count = silhouetteCount;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.root.userData.tileCount = texturedCount + silhouetteCount;
    this.root.userData.texturedTileCount = texturedCount;
  }
  dispose() {
    this.root.removeFromParent();
    for (const m of [...this.texturedMeshes, ...this.silhouetteMeshes]) {
      m.geometry.dispose();
      if (this.silhouetteMeshes.includes(m)) {
        for (const material of Array.isArray(m.material)
          ? m.material
          : [m.material])
          material.dispose();
      }
      m.dispose();
    }
  }
}
