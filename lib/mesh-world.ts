import * as THREE from 'three';

export type MeshPoint = { x: number; y: number; z: number };
export type MeshSurfaceHit = {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  triangleIndex: number;
};
export type MeshSweepResult = {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  grounded: boolean;
  wallNormal: THREE.Vector3 | null;
  feetTouching: boolean;
  blocked: boolean;
  contacts: number;
};
type BuildOptions = { onProgress?: (progress: number) => void };
type SupportOptions = { maxDrop?: number; maxRise?: number; minNormalY?: number };
type RayOptions = { minNormalY?: number };
type GeometrySource = { mesh: THREE.Mesh; matrix: THREE.Matrix4; start: number; end: number; volume: number };
type BuildNode = { min: number[]; max: number[]; start: number; count: number; left: number; right: number };

const SKIN = .002;
const WALKABLE_NORMAL = .6;
const DOWN = new THREE.Vector3(0, -1, 0);
const yieldBuild = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** An upright capsule's bottom sits above a sloped plane's center-ray height. */
export const capsuleSupportHeight = (support: MeshSurfaceHit, radius = .46) =>
  support.point.y + SKIN + radius * (1 / Math.max(WALKABLE_NORMAL, support.normal.y) - 1);

/**
 * Static rendered-triangle BVH. A single baked template is reused for every
 * translated streamed tile. No Triangle/Vector objects are retained per face,
 * and triangles are never duplicated into overlapping octree cells.
 *
 * Build and query coordinates are world coordinates at the time of the build.
 * For a repeated tile, subtract its translation before querying and add that
 * translation to the returned point/position. Normals and velocity are unchanged.
 */
export class WorldMeshQuery {
  readonly bounds = new THREE.Box3();
  readonly triangleCount: number;
  readonly byteLength: number;
  private readonly positions: Float32Array;
  private readonly order: Uint32Array;
  private readonly volumes: Uint32Array;
  private readonly nodeBounds: Float32Array;
  private readonly nodeMeta: Int32Array;
  private readonly triangle = new THREE.Triangle();
  private readonly ray = new THREE.Ray();
  private readonly hitPoint = new THREE.Vector3();
  private readonly faceNormal = new THREE.Vector3();
  private readonly segmentStart = new THREE.Vector3();
  private readonly segmentEnd = new THREE.Vector3();
  private readonly segmentPoint = new THREE.Vector3();
  private readonly trianglePoint = new THREE.Vector3();
  private readonly bestSegmentPoint = new THREE.Vector3();
  private readonly bestTrianglePoint = new THREE.Vector3();
  private readonly edgeSegmentPoint = new THREE.Vector3();
  private readonly edgeTrianglePoint = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly contactNormal = new THREE.Vector3();
  private readonly stack: number[] = [];
  private readonly candidates: number[] = [];

  private constructor(positions: Float32Array, order: Uint32Array, volumes: Uint32Array, nodes: BuildNode[]) {
    this.positions = positions;
    this.order = order;
    this.volumes = volumes;
    this.triangleCount = order.length;
    this.nodeBounds = new Float32Array(nodes.length * 6);
    this.nodeMeta = new Int32Array(nodes.length * 4);
    nodes.forEach((node, index) => {
      this.nodeBounds.set([...node.min, ...node.max], index * 6);
      this.nodeMeta.set([node.left, node.right, node.start, node.count], index * 4);
    });
    if (nodes.length) {
      this.bounds.min.fromArray(this.nodeBounds, 0);
      this.bounds.max.fromArray(this.nodeBounds, 3);
    }
    this.byteLength = positions.byteLength + order.byteLength + volumes.byteLength + this.nodeBounds.byteLength + this.nodeMeta.byteLength;
  }

  static async fromObject(root: THREE.Object3D, options: BuildOptions = {}): Promise<WorldMeshQuery> {
    root.updateWorldMatrix(true, true);
    const sources: GeometrySource[] = [];
    let faceCapacity = 0;
    let volumeCount = 0;
    const instanceMatrix = new THREE.Matrix4();
    root.traverseVisible((object) => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh) return;
      const geometry = object.geometry;
      const attribute = geometry.getAttribute('position');
      if (!attribute || attribute.itemSize < 3) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const rendered = (index: number) => {
        const material = materials[index];
        return material && material.visible && material.colorWrite && (!material.transparent || material.opacity > .01);
      };
      const count = geometry.index?.count ?? attribute.count;
      const drawStart = Math.max(0, geometry.drawRange.start);
      const drawEnd = Math.min(count, drawStart + geometry.drawRange.count);
      const groups = Array.isArray(object.material) && geometry.groups.length
        ? geometry.groups
        : [{ start: 0, count, materialIndex: 0 }];
      const instances = object instanceof THREE.InstancedMesh ? object.count : 1;
      for (let instance = 0; instance < instances; instance++) {
        const volume = volumeCount++;
        const matrix = object.matrixWorld.clone();
        if (object instanceof THREE.InstancedMesh) {
          object.getMatrixAt(instance, instanceMatrix);
          matrix.multiply(instanceMatrix);
        }
        for (const group of groups) {
          if (!rendered(group.materialIndex ?? 0)) continue;
          const start = Math.max(drawStart, group.start);
          const end = Math.min(drawEnd, group.start + group.count);
          if (end - start < 3) continue;
          sources.push({ mesh: object, matrix, start, end, volume });
          faceCapacity += Math.floor((end - start) / 3);
        }
      }
    });
    // Current largest city has 310k faces (~15 MB final query data). This
    // capacity guard fails visibly instead of sampling away collision walls.
    if (faceCapacity > 2_000_000) throw new Error(`City collision mesh too large (${faceCapacity} triangles); split or simplify its collision geometry.`);
    const data = new Float32Array(faceCapacity * 9);
    const volumeData = new Uint32Array(faceCapacity);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    let count = 0;
    let visited = 0;
    for (const source of sources) {
      const geometry = source.mesh.geometry;
      const position = geometry.getAttribute('position');
      for (let index = source.start; index + 2 < source.end; index += 3) {
        a.fromBufferAttribute(position, geometry.index?.getX(index) ?? index).applyMatrix4(source.matrix);
        b.fromBufferAttribute(position, geometry.index?.getX(index + 1) ?? index + 1).applyMatrix4(source.matrix);
        c.fromBufferAttribute(position, geometry.index?.getX(index + 2) ?? index + 2).applyMatrix4(source.matrix);
        const finite = Number.isFinite(a.x + a.y + a.z + b.x + b.y + b.z + c.x + c.y + c.z);
        if (finite && ab.subVectors(b, a).cross(ac.subVectors(c, a)).lengthSq() > 1e-14) {
          a.toArray(data, count * 9);
          b.toArray(data, count * 9 + 3);
          c.toArray(data, count * 9 + 6);
          volumeData[count] = source.volume;
          count++;
        }
        if (++visited % 12_000 === 0) {
          options.onProgress?.(.5 * visited / Math.max(1, faceCapacity));
          await yieldBuild();
        }
      }
    }
    const positions = count === faceCapacity ? data : data.slice(0, count * 9);
    const volumes = count === faceCapacity ? volumeData : volumeData.slice(0, count);
    const order = Uint32Array.from({ length: count }, (_, index) => index);
    const nodes: BuildNode[] = [];
    const pending: { start: number; count: number; parent: number; right: boolean }[] = count
      ? [{ start: 0, count, parent: -1, right: false }]
      : [];
    let processedLeaves = 0;
    while (pending.length) {
      const task = pending.pop()!;
      const node: BuildNode = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], start: task.start, count: task.count, left: -1, right: -1 };
      const nodeIndex = nodes.length;
      nodes.push(node);
      if (task.parent >= 0) nodes[task.parent][task.right ? 'right' : 'left'] = nodeIndex;
      for (let offset = task.start; offset < task.start + task.count; offset++) {
        const base = order[offset] * 9;
        for (let axis = 0; axis < 3; axis++) {
          node.min[axis] = Math.min(node.min[axis], positions[base + axis], positions[base + 3 + axis], positions[base + 6 + axis]);
          node.max[axis] = Math.max(node.max[axis], positions[base + axis], positions[base + 3 + axis], positions[base + 6 + axis]);
        }
      }
      if (task.count <= 16) processedLeaves += task.count;
      else {
        let axis = 0;
        if (node.max[1] - node.min[1] > node.max[axis] - node.min[axis]) axis = 1;
        if (node.max[2] - node.min[2] > node.max[axis] - node.min[axis]) axis = 2;
        const midpoint = (node.min[axis] + node.max[axis]) * .5;
        let left = task.start;
        let right = task.start + task.count - 1;
        while (left <= right) {
          const base = order[left] * 9 + axis;
          const centroid = (positions[base] + positions[base + 3] + positions[base + 6]) / 3;
          if (centroid < midpoint) left++;
          else {
            const swap = order[left];
            order[left] = order[right];
            order[right--] = swap;
          }
        }
        // Equal partition is the safe fallback for coincident/crossing faces.
        const split = left > task.start && left < task.start + task.count
          ? left : task.start + Math.floor(task.count / 2);
        node.count = 0;
        pending.push({ start: split, count: task.start + task.count - split, parent: nodeIndex, right: true });
        pending.push({ start: task.start, count: split - task.start, parent: nodeIndex, right: false });
      }
      if (nodes.length % 500 === 0) {
        options.onProgress?.(.5 + .5 * processedLeaves / Math.max(1, count));
        await yieldBuild();
      }
    }
    options.onProgress?.(1);
    return new WorldMeshQuery(positions, order, volumes, nodes);
  }

  private readTriangle(index: number): THREE.Triangle {
    this.triangle.a.fromArray(this.positions, index * 9);
    this.triangle.b.fromArray(this.positions, index * 9 + 3);
    this.triangle.c.fromArray(this.positions, index * 9 + 6);
    return this.triangle;
  }

  private rayHitsNode(node: number, origin: MeshPoint, direction: MeshPoint, maximum: number): boolean {
    let near = 0;
    let far = maximum;
    for (let axis = 0; axis < 3; axis++) {
      const key = axis === 0 ? 'x' : axis === 1 ? 'y' : 'z';
      const start = origin[key];
      const delta = direction[key];
      const minimum = this.nodeBounds[node * 6 + axis];
      const maximum = this.nodeBounds[node * 6 + axis + 3];
      if (Math.abs(delta) < 1e-12) {
        if (start < minimum || start > maximum) return false;
        continue;
      }
      const first = (minimum - start) / delta;
      const second = (maximum - start) / delta;
      near = Math.max(near, Math.min(first, second));
      far = Math.min(far, Math.max(first, second));
      if (near > far) return false;
    }
    return far >= 0;
  }

  raycast(origin: MeshPoint, direction: MeshPoint, maxDistance = Infinity, options: RayOptions = {}): MeshSurfaceHit | null {
    if (!this.triangleCount || maxDistance < 0) return null;
    this.ray.origin.copy(origin);
    this.ray.direction.copy(direction).normalize();
    if (this.ray.direction.lengthSq() < .5) return null;
    this.stack.length = 0;
    this.stack.push(0);
    let nearest = maxDistance;
    let found: MeshSurfaceHit | null = null;
    while (this.stack.length) {
      const node = this.stack.pop()!;
      if (!this.rayHitsNode(node, this.ray.origin, this.ray.direction, nearest)) continue;
      const meta = node * 4;
      const count = this.nodeMeta[meta + 3];
      if (!count) {
        this.stack.push(this.nodeMeta[meta], this.nodeMeta[meta + 1]);
        continue;
      }
      const start = this.nodeMeta[meta + 2];
      for (let index = start; index < start + count; index++) {
        const triangleIndex = this.order[index];
        const triangle = this.readTriangle(triangleIndex);
        if (!this.ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, this.hitPoint)) continue;
        const distance = this.hitPoint.distanceTo(this.ray.origin);
        if (distance > nearest) continue;
        triangle.getNormal(this.faceNormal);
        if (this.faceNormal.dot(this.ray.direction) > 0) this.faceNormal.negate();
        if (options.minNormalY !== undefined && this.faceNormal.y < options.minNormalY) continue;
        nearest = distance;
        found = { point: this.hitPoint.clone(), normal: this.faceNormal.clone(), distance, triangleIndex };
      }
    }
    return found;
  }

  supportAt(position: MeshPoint, options: SupportOptions = {}): MeshSurfaceHit | null {
    const rise = Math.max(0, options.maxRise ?? .12);
    const drop = Math.max(0, options.maxDrop ?? .25);
    return this.raycast({ x: position.x, y: position.y + rise, z: position.z }, DOWN, rise + drop,
      { minNormalY: options.minNormalY ?? WALKABLE_NORMAL });
  }

  /** True only for a triangle-backed surface, never a proxy/bounds assumption. */
  hasSurface(position: MeshPoint, tolerance = .06): boolean {
    return Boolean(this.supportAt(position, { maxRise: tolerance, maxDrop: tolerance }));
  }

  private collectCapsuleTriangles(position: MeshPoint, radius: number, height: number): number[] {
    const list = this.candidates;
    list.length = 0;
    if (!this.triangleCount) return list;
    this.stack.length = 0;
    this.stack.push(0);
    const minX = position.x - radius - SKIN;
    const maxX = position.x + radius + SKIN;
    const minY = position.y - SKIN;
    const maxY = position.y + height + SKIN;
    const minZ = position.z - radius - SKIN;
    const maxZ = position.z + radius + SKIN;
    while (this.stack.length) {
      const node = this.stack.pop()!;
      const bounds = node * 6;
      if (maxX < this.nodeBounds[bounds] || minX > this.nodeBounds[bounds + 3]
        || maxY < this.nodeBounds[bounds + 1] || minY > this.nodeBounds[bounds + 4]
        || maxZ < this.nodeBounds[bounds + 2] || minZ > this.nodeBounds[bounds + 5]) continue;
      const meta = node * 4;
      const count = this.nodeMeta[meta + 3];
      if (!count) this.stack.push(this.nodeMeta[meta], this.nodeMeta[meta + 1]);
      else {
        const start = this.nodeMeta[meta + 2];
        for (let index = start; index < start + count; index++) list.push(this.order[index]);
      }
    }
    return list;
  }

  /** Closest points between two finite line segments (including parallel edges). */
  private closestSegments(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) {
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = d.x - c.x, vy = d.y - c.y, vz = d.z - c.z;
    const wx = a.x - c.x, wy = a.y - c.y, wz = a.z - c.z;
    const aa = ux * ux + uy * uy + uz * uz;
    const bb = ux * vx + uy * vy + uz * vz;
    const cc = vx * vx + vy * vy + vz * vz;
    const dd = ux * wx + uy * wy + uz * wz;
    const ee = vx * wx + vy * wy + vz * wz;
    const denominator = aa * cc - bb * bb;
    let s = denominator > 1e-12 ? THREE.MathUtils.clamp((bb * ee - cc * dd) / denominator, 0, 1) : 0;
    let t = cc > 1e-12 ? (bb * s + ee) / cc : 0;
    if (t < 0) { t = 0; s = aa > 1e-12 ? THREE.MathUtils.clamp(-dd / aa, 0, 1) : 0; }
    else if (t > 1) { t = 1; s = aa > 1e-12 ? THREE.MathUtils.clamp((bb - dd) / aa, 0, 1) : 0; }
    this.edgeSegmentPoint.set(a.x + ux * s, a.y + uy * s, a.z + uz * s);
    this.edgeTrianglePoint.set(c.x + vx * t, c.y + vy * t, c.z + vz * t);
  }

  private distanceToTriangle(triangle: THREE.Triangle): number {
    this.direction.subVectors(this.segmentEnd, this.segmentStart);
    const length = this.direction.length();
    this.ray.set(this.segmentStart, this.direction.normalize());
    if (this.ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, this.hitPoint)
      && this.hitPoint.distanceTo(this.segmentStart) <= length) {
      this.bestSegmentPoint.copy(this.hitPoint);
      this.bestTrianglePoint.copy(this.hitPoint);
      return 0;
    }
    triangle.closestPointToPoint(this.segmentStart, this.trianglePoint);
    let best = this.segmentStart.distanceToSquared(this.trianglePoint);
    this.bestSegmentPoint.copy(this.segmentStart);
    this.bestTrianglePoint.copy(this.trianglePoint);
    triangle.closestPointToPoint(this.segmentEnd, this.trianglePoint);
    const endDistance = this.segmentEnd.distanceToSquared(this.trianglePoint);
    if (endDistance < best) {
      best = endDistance;
      this.bestSegmentPoint.copy(this.segmentEnd);
      this.bestTrianglePoint.copy(this.trianglePoint);
    }
    for (let edge = 0; edge < 3; edge++) {
      const a = edge === 0 ? triangle.a : edge === 1 ? triangle.b : triangle.c;
      const b = edge === 0 ? triangle.b : edge === 1 ? triangle.c : triangle.a;
      this.closestSegments(this.segmentStart, this.segmentEnd, a, b);
      const distance = this.edgeSegmentPoint.distanceToSquared(this.edgeTrianglePoint);
      if (distance < best) {
        best = distance;
        this.bestSegmentPoint.copy(this.edgeSegmentPoint);
        this.bestTrianglePoint.copy(this.edgeTrianglePoint);
      }
    }
    return Math.sqrt(best);
  }

  /**
   * Check clearance without moving. Spawn/recovery keeps the interior test;
   * continuous swept-motion validation may disable it and check local faces only.
   */
  isCapsuleClear(position: MeshPoint, radius = .46, height = 2.05, checkInterior = true): boolean {
    this.segmentStart.set(position.x, position.y + radius, position.z);
    this.segmentEnd.set(position.x, position.y + Math.max(radius, height - radius), position.z);
    for (const index of this.collectCapsuleTriangles(position, radius, height)) {
      if (this.distanceToTriangle(this.readTriangle(index)) < radius - .006) return false;
    }
    // Surface distance is zero-risk for ordinary sweeps, but an invalid teleport
    // may put the whole capsule deep inside a closed building with no near face.
    // Require odd parity in *all* opposing horizontal directions before calling
    // that an interior. Single/open facade sheets are not treated as volumes.
    return !checkInterior || !this.isInsideClosedVolume({ x: position.x, y: position.y + height * .5, z: position.z });
  }

  private isInsideClosedVolume(position: MeshPoint): boolean {
    if (!this.triangleCount || !this.bounds.containsPoint(this.segmentPoint.copy(position))) return false;
    let possibleVolumes: Set<number> | null = null;
    for (const direction of [[1, .00013, .00031], [-1, -.00013, -.00031], [.00017, .00011, 1], [-.00017, -.00011, -1]]) {
      this.ray.origin.copy(position);
      this.ray.direction.set(...direction as [number, number, number]).normalize();
      this.stack.length = 0;
      this.stack.push(0);
      const volumeDistances = new Map<number, number[]>();
      while (this.stack.length) {
        const node = this.stack.pop()!;
        if (!this.rayHitsNode(node, this.ray.origin, this.ray.direction, Infinity)) continue;
        const meta = node * 4;
        const count = this.nodeMeta[meta + 3];
        if (!count) { this.stack.push(this.nodeMeta[meta], this.nodeMeta[meta + 1]); continue; }
        const start = this.nodeMeta[meta + 2];
        for (let index = start; index < start + count; index++) {
          const triangleIndex = this.order[index];
          const volume = this.volumes[triangleIndex];
          if (possibleVolumes && !possibleVolumes.has(volume)) continue;
          const triangle = this.readTriangle(triangleIndex);
          if (!this.ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, this.hitPoint)) continue;
          const distance = this.hitPoint.distanceTo(this.ray.origin);
          if (distance > SKIN) {
            const distances = volumeDistances.get(volume) ?? [];
            distances.push(distance);
            volumeDistances.set(volume, distances);
          }
        }
      }
      const interiors = new Set<number>();
      for (const [volume, distances] of volumeDistances) {
        distances.sort((a, b) => a - b);
        let crossings = 0;
        let previous = -Infinity;
        for (const distance of distances) {
          // Shared edges/seams/duplicated coplanar faces are one crossing.
          if (distance - previous > .005) crossings++;
          previous = distance;
        }
        if (crossings % 2 === 1) interiors.add(volume);
      }
      if (!interiors.size) return false;
      possibleVolumes = interiors;
    }
    return true;
  }

  /**
   * Small *spatial* steps keep a zero-thickness facade from being crossed even
   * during a long frame/web zip. Each step resolves exact capsule/triangle
   * distances; incoming normal velocity is removed while tangent speed survives.
   * It intentionally does not snap a falling character upward onto a roof.
   */
  sweepCapsule(from: MeshPoint, to: MeshPoint, velocity: MeshPoint, radius = .46, height = 2.05): MeshSweepResult {
    const position = new THREE.Vector3().copy(from);
    const correctedVelocity = new THREE.Vector3().copy(velocity);
    const remaining = new THREE.Vector3().copy(to).sub(position);
    const totalDistance = remaining.length();
    const spatialStep = Math.max(.035, Math.min(.18, radius * .4));
    const requestedSteps = Math.max(1, Math.ceil(totalDistance / spatialStep));
    // Invalid/network teleports must never silently skip collision. Stop after
    // the tested distance, and report blocked so the caller can recover safely.
    const steps = Math.min(2048, requestedSteps);
    const step = remaining.multiplyScalar(1 / requestedSteps);
    const initialSurface = velocity.y <= .1 ? this.supportAt(from, { maxRise: .025, maxDrop: radius + .045 }) : null;
    const initialSupport = initialSurface && Math.abs(from.y - capsuleSupportHeight(initialSurface, radius)) <= .045
      ? initialSurface : null;
    const previous = position.clone();
    let grounded = false;
    let wallNormal: THREE.Vector3 | null = null;
    let feetTouching = false;
    let contacts = 0;
    for (let iteration = 0; iteration < steps; iteration++) {
      previous.copy(position);
      position.add(step);
      // Re-query after displacement; resolving one face can approach a second.
      for (let pass = 0; pass < 5; pass++) {
        let moved = false;
        const candidates = this.collectCapsuleTriangles(position, radius, height);
        for (const index of candidates) {
          this.segmentStart.set(position.x, position.y + radius, position.z);
          this.segmentEnd.set(position.x, position.y + Math.max(radius, height - radius), position.z);
          const triangle = this.readTriangle(index);
          const distance = this.distanceToTriangle(triangle);
          if (distance >= radius + SKIN) continue;
          if (distance > 1e-7) this.contactNormal.subVectors(this.bestSegmentPoint, this.bestTrianglePoint).divideScalar(distance);
          else {
            triangle.getNormal(this.contactNormal);
            this.segmentPoint.set(previous.x, previous.y + height * .5, previous.z).sub(triangle.a);
            if (this.contactNormal.dot(this.segmentPoint) < 0) this.contactNormal.negate();
          }
          const depth = radius + SKIN - distance;
          const smallGroundStep = initialSupport && this.contactNormal.y > .45
            && this.bestTrianglePoint.y <= initialSupport.point.y + .28;
          if (depth > .00001) {
            if (smallGroundStep) position.y += depth / this.contactNormal.y;
            else position.addScaledVector(this.contactNormal, depth);
            moved = true;
          }
          if (smallGroundStep) {
            // Rounded capsule feet climb shallow curbs by positional contact.
            // Do not turn a curb normal into an upward launch impulse or keep
            // projecting the rest of a long sweep uphill after the curb ends.
            correctedVelocity.y = Math.min(0, correctedVelocity.y);
          } else {
            const incoming = correctedVelocity.dot(this.contactNormal);
            if (incoming < 0) correctedVelocity.addScaledVector(this.contactNormal, -incoming);
            const stepIncoming = step.dot(this.contactNormal);
            if (stepIncoming < 0) step.addScaledVector(this.contactNormal, -stepIncoming);
          }
          if (this.contactNormal.y > WALKABLE_NORMAL && velocity.y <= .1) grounded = true;
          else if (Math.abs(this.contactNormal.y) < .45) {
            wallNormal = this.contactNormal.clone();
            feetTouching ||= this.bestTrianglePoint.y <= position.y + .55;
          }
          contacts++;
        }
        if (!moved) break;
      }
      // Acute imported corners can alternate between two contact corrections.
      // Keep the last clear substep when the bounded solve has not converged;
      // never return a residual overlap to the next render/animation frame.
      if (!this.isCapsuleClear(position, radius, height, false)) {
        position.copy(previous);
        correctedVelocity.set(0, 0, 0);
        contacts++;
        break;
      }
    }
    // Contact from an earlier sweep step is not persistent ground after leaving
    // an edge. A final short support probe owns the actual grounded state.
    const support = velocity.y <= .1 ? this.supportAt(position, { maxRise: .015, maxDrop: radius + .035 }) : null;
    grounded = Boolean(support && Math.abs(position.y - capsuleSupportHeight(support, radius)) <= .035 && correctedVelocity.y <= .1);
    if (grounded && support) {
      const oldY = position.y;
      position.y = capsuleSupportHeight(support, radius);
      if (this.isCapsuleClear(position, radius, height, false)) correctedVelocity.y = Math.max(0, correctedVelocity.y);
      else { position.y = oldY; grounded = false; }
    }
    return { position, velocity: correctedVelocity, grounded, wallNormal, feetTouching,
      blocked: contacts > 0 || steps < requestedSteps, contacts };
  }

  /**
   * Look for a broad, unobstructed roof before permitting a smaller roof. Import
   * collider bounds often describe a facade cornice rather than the usable top:
   * merely fitting two feet on that cornice is not a satisfactory rooftop spawn.
   * Boxes supply search priorities only; all heights/support come from triangles.
   */
  findRoofSpawn(candidateBoxes: readonly THREE.Box3[], radius = .46, height = 2.05): THREE.Vector3 | null {
    for (const footprint of [Math.max(2, radius * 3), Math.max(.75, radius * 1.5), radius]) {
      let best: THREE.Vector3 | null = null;
      let bestOpenDirections = -1;
      const checked = new Set<string>();
      for (const box of candidateBoxes) {
        // Caller orders central buildings by height before peripheral buildings.
        // Once a broad real top is above the remaining priority band's bounds,
        // don't abandon the central spawn for a distant peripheral tower.
        if (best && box.max.y + .1 < best.y) break;
        const center = box.getCenter(new THREE.Vector3());
        const width = box.max.x - box.min.x;
        const depth = box.max.z - box.min.z;
        if (width < radius * 2.1 || depth < radius * 2.1) continue;
        const offsets: [number, number][] = [];
        for (const wider of [false, true]) {
          const searchWidth = wider ? Math.max(12, width) : width;
          const searchDepth = wider ? Math.max(12, depth) : depth;
          for (const x of [0, -.18, .18, -.36, .36]) for (const z of [0, -.18, .18, -.36, .36]) offsets.push([searchWidth * x, searchDepth * z]);
        }
        for (const [offsetX, offsetZ] of offsets) {
          const origin = new THREE.Vector3(center.x + offsetX, Math.max(this.bounds.max.y, box.max.y) + 2, center.z + offsetZ);
          const key = `${Math.round(origin.x * 4)}:${Math.round(origin.z * 4)}`;
          if (checked.has(key)) continue;
          checked.add(key);
          const support = this.raycast(origin, DOWN, Math.max(2, origin.y - box.min.y), { minNormalY: .85 });
          if (!support || support.point.y < box.min.y + Math.min(2, (box.max.y - box.min.y) * .5)) continue;
          if (best && support.point.y < best.y - .025) continue;
          const point = support.point.clone();
          let stable = true;
          // Cardinal and diagonal probes ensure a broad platform, not a long,
          // foot-width ledge next to a tall opaque facade.
          for (let direction = 0; direction < 8; direction++) {
            const angle = direction * Math.PI / 4;
            const foot = this.supportAt({ x: point.x + Math.cos(angle) * footprint, y: point.y, z: point.z + Math.sin(angle) * footprint }, { maxDrop: .12, maxRise: .12, minNormalY: .85 });
            if (!foot || Math.abs(foot.point.y - point.y) > .1) { stable = false; break; }
          }
          if (!stable) continue;
          point.y += SKIN;
          if (!this.isCapsuleClear(point, radius, height)) continue;
          let openDirections = 0;
          const eye = point.clone().add(new THREE.Vector3(0, height * .8, 0));
          for (let direction = 0; direction < 8; direction++) {
            const angle = direction * Math.PI / 4;
            const obstruction = this.raycast(eye, { x: Math.cos(angle), y: 0, z: Math.sin(angle) }, 7);
            if (!obstruction) openDirections++;
            else if (obstruction.distance < footprint + (footprint > radius ? .4 : .05)) { stable = false; break; }
          }
          const minimumOpenDirections = footprint >= 2 ? 5 : footprint > radius ? 4 : 2;
          if (!stable || openDirections < minimumOpenDirections) continue;
          if (!best || point.y > best.y + .025 || openDirections > bestOpenDirections) {
            best = point;
            bestOpenDirections = openDirections;
          }
        }
      }
      if (best) return best;
    }
    return null;
  }
}
