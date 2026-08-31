import * as THREE from 'three';

export const WEB_STRAND_MODEL = '/assets/effects/spiderman-web.glb';
export const WEB_STRAND_DIAMETER = .02;
export const WEB_STRAND_MAX_SEGMENTS = 12;
const SEGMENT_LENGTH = 8;
const JOINT_OVERLAP = .012;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * The downloaded web is two textured silk tubes, not a flat web decal. Bake
 * their authored transforms once and instance complete source segments so long
 * ropes repeat the existing normal detail instead of stretching a single UV.
 *
 * Pass the loaded GLTF scene, then add `.group` to the game scene. `update`
 * accepts WORLD endpoints, even when the group's parent is transformed.
 */
export class WebStrand {
  readonly group = new THREE.Group();
  readonly meshes: THREE.InstancedMesh[] = [];
  readonly sourceBounds = new THREE.Box3();
  readonly sourceTriangleCount: number;
  readonly maximumTriangles: number;
  segmentCount = 0;
  length = 0;
  private readonly materials = new Set<THREE.Material>();
  private readonly worldToLocal = new THREE.Matrix4();
  private readonly matrix = new THREE.Matrix4();
  private readonly start = new THREE.Vector3();
  private readonly end = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private disposed = false;

  constructor(sourceScene: THREE.Object3D) {
    this.group.name = 'downloaded-spiderman-web';
    this.group.visible = false;
    sourceScene.updateWorldMatrix(true, true);
    const sourceMeshes: THREE.Mesh[] = [];
    sourceScene.traverseVisible(object => {
      if (object instanceof THREE.Mesh && !(object instanceof THREE.SkinnedMesh)
        && object.geometry.getAttribute('position')) sourceMeshes.push(object);
    });
    if (!sourceMeshes.length) throw new Error('Spider-Man web asset contains no renderable tube meshes');
    for (const mesh of sourceMeshes) this.sourceBounds.union(new THREE.Box3().setFromObject(mesh));
    const dimensions = this.sourceBounds.getSize(new THREE.Vector3());
    const axes = [dimensions.x, dimensions.y, dimensions.z];
    const longAxis = axes.indexOf(Math.max(...axes));
    const transverse = axes.filter((_, axis) => axis !== longAxis);
    if (axes[longAxis] < Math.max(...transverse) * 10) throw new Error('Web model is not a longitudinal strand');
    const sourceAxis = new THREE.Vector3().setComponent(longAxis, 1);
    const orientation = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(sourceAxis, Y_AXIS));
    const baked = sourceMeshes.map(mesh => {
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(orientation, mesh.matrixWorld));
      geometry.computeBoundingBox();
      return { mesh, geometry };
    });
    const bounds = new THREE.Box3();
    for (const { geometry } of baked) bounds.union(geometry.boundingBox!);
    const sourceLength = bounds.max.y - bounds.min.y;
    // The continuous core is the longest mesh. Its endpoint centroids remove
    // the export's slight diagonal lean, allowing repeated ends to meet.
    const core = baked.reduce((longest, item) => {
      const span = item.geometry.boundingBox!.max.y - item.geometry.boundingBox!.min.y;
      const longestSpan = longest.geometry.boundingBox!.max.y - longest.geometry.boundingBox!.min.y;
      return span > longestSpan ? item : longest;
    });
    const positions = core.geometry.getAttribute('position');
    const low = new THREE.Vector3();
    const high = new THREE.Vector3();
    let lowCount = 0, highCount = 0;
    const sample = new THREE.Vector3();
    for (let index = 0; index < positions.count; index++) {
      sample.fromBufferAttribute(positions, index);
      if (sample.y <= bounds.min.y + sourceLength * .02) { low.add(sample); lowCount++; }
      if (sample.y >= bounds.max.y - sourceLength * .02) { high.add(sample); highCount++; }
    }
    low.divideScalar(Math.max(1, lowCount));
    high.divideScalar(Math.max(1, highCount));
    const span = Math.max(1e-6, high.y - low.y);
    const slopeX = (high.x - low.x) / span;
    const slopeZ = (high.z - low.z) / span;
    const straighten = new THREE.Matrix4().set(
      1, -slopeX, 0, -(low.x - slopeX * low.y),
      0, 1, 0, -bounds.min.y,
      0, -slopeZ, 1, -(low.z - slopeZ * low.y),
      0, 0, 0, 1,
    );
    const straightBounds = new THREE.Box3();
    for (const { geometry } of baked) {
      geometry.applyMatrix4(straighten);
      geometry.computeBoundingBox();
      straightBounds.union(geometry.boundingBox!);
    }
    const crossScale = WEB_STRAND_DIAMETER / Math.max(straightBounds.max.x - straightBounds.min.x,
      straightBounds.max.z - straightBounds.min.z, 1e-6);
    const normalize = new THREE.Matrix4().makeScale(crossScale, 1 / sourceLength, crossScale);
    const materialCopies = new Map<THREE.Material, THREE.Material>();
    const ownMaterial = (material: THREE.Material) => {
      let copy = materialCopies.get(material);
      if (!copy) {
        copy = material.clone();
        materialCopies.set(material, copy);
        this.materials.add(copy);
      }
      return copy;
    };
    let triangles = 0;
    for (const { mesh, geometry } of baked) {
      geometry.applyMatrix4(normalize);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
      const material = Array.isArray(mesh.material) ? mesh.material.map(ownMaterial) : ownMaterial(mesh.material);
      const strand = new THREE.InstancedMesh(geometry, material, WEB_STRAND_MAX_SEGMENTS);
      strand.name = `source-web:${mesh.name}`;
      strand.count = 0;
      strand.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Bounds change with both endpoints; skip expensive instance bound
      // rebuilding and never let stale bounds make the web disappear.
      strand.frustumCulled = false;
      strand.castShadow = false;
      strand.receiveShadow = false;
      this.meshes.push(strand);
      this.group.add(strand);
    }
    this.sourceTriangleCount = triangles;
    this.maximumTriangles = triangles * WEB_STRAND_MAX_SEGMENTS;
  }

  update(start: THREE.Vector3, end: THREE.Vector3, visible: boolean, tension = 1) {
    if (this.disposed) return;
    const finite = Number.isFinite(start.x + start.y + start.z + end.x + end.y + end.z);
    this.length = finite ? start.distanceTo(end) : 0;
    if (!visible || !finite || this.length < .001) {
      this.group.visible = false;
      this.segmentCount = 0;
      for (const mesh of this.meshes) mesh.count = 0;
      return;
    }
    this.group.visible = true;
    this.group.updateWorldMatrix(true, false);
    this.worldToLocal.copy(this.group.matrixWorld).invert();
    this.segmentCount = Math.min(WEB_STRAND_MAX_SEGMENTS, Math.max(1, Math.ceil(this.length / SEGMENT_LENGTH)));
    const tightness = THREE.MathUtils.clamp(Number.isFinite(tension) ? tension : 1, 0, 1);
    const sag = Math.min(1.2, this.length * .012) * (1 - tightness);
    for (let index = 0; index < this.segmentCount; index++) {
      const a = index / this.segmentCount;
      const b = (index + 1) / this.segmentCount;
      this.start.lerpVectors(start, end, a);
      this.end.lerpVectors(start, end, b);
      this.start.y -= sag * 4 * a * (1 - a);
      this.end.y -= sag * 4 * b * (1 - b);
      this.direction.subVectors(this.end, this.start);
      let spanLength = this.direction.length();
      this.direction.multiplyScalar(1 / Math.max(spanLength, 1e-6));
      if (index > 0) { this.start.addScaledVector(this.direction, -JOINT_OVERLAP * .5); spanLength += JOINT_OVERLAP * .5; }
      if (index < this.segmentCount - 1) spanLength += JOINT_OVERLAP * .5;
      this.rotation.setFromUnitVectors(Y_AXIS, this.direction);
      this.scale.set(1, spanLength, 1);
      this.matrix.compose(this.start, this.rotation, this.scale).premultiply(this.worldToLocal);
      for (const mesh of this.meshes) mesh.setMatrixAt(index, this.matrix);
    }
    for (const mesh of this.meshes) { mesh.count = this.segmentCount; mesh.instanceMatrix.needsUpdate = true; }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.visible = false;
    this.group.removeFromParent();
    for (const mesh of this.meshes) { mesh.dispose(); mesh.geometry.dispose(); }
    for (const material of this.materials) material.dispose();
    // Shared GLTF textures and original scene geometry/materials belong to the
    // asset cache. Never dispose those from an individual player's web.
    this.group.clear();
  }
}
