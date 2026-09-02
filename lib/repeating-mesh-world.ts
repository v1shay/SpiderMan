import * as THREE from 'three';
import { WorldMeshQuery, capsuleSupportHeight, type MeshPoint, type MeshSurfaceHit, type MeshSweepResult } from './mesh-world.ts';

/** Collision tiles are spatial queries, not the list of currently rendered clones. */
export class RepeatingMeshWorld {
  readonly query: WorldMeshQuery;
  readonly width: number;
  readonly depth: number;
  constructor(query: WorldMeshQuery, width: number, depth: number) {
    this.query = query; this.width = width; this.depth = depth;
  }

  offsets(from: MeshPoint, to: MeshPoint = from, padding = 0) {
    const bounds = this.query.bounds;
    const minX = Math.ceil((Math.min(from.x, to.x) - padding - bounds.max.x) / this.width);
    const maxX = Math.floor((Math.max(from.x, to.x) + padding - bounds.min.x) / this.width);
    const minZ = Math.ceil((Math.min(from.z, to.z) - padding - bounds.max.z) / this.depth);
    const maxZ = Math.floor((Math.max(from.z, to.z) + padding - bounds.min.z) / this.depth);
    const offsets: THREE.Vector3[] = [];
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) offsets.push(new THREE.Vector3(x * this.width, 0, z * this.depth));
    return offsets;
  }

  raycast(origin: MeshPoint, direction: MeshPoint, maximum: number, minNormalY?: number): MeshSurfaceHit | null {
    if (!Number.isFinite(maximum) || maximum <= 0) return null;
    const start = new THREE.Vector3().copy(origin), ray = new THREE.Ray(start, new THREE.Vector3().copy(direction).normalize());
    const end = ray.at(maximum, new THREE.Vector3());
    const translated = new THREE.Box3(), local = new THREE.Vector3();
    let closest: MeshSurfaceHit | null = null;
    for (const offset of this.offsets(start, end)) {
      translated.copy(this.query.bounds).translate(offset);
      if (!ray.intersectsBox(translated)) continue;
      const hit = this.query.raycast(local.copy(start).sub(offset), ray.direction, closest?.distance ?? maximum, { minNormalY });
      if (hit) { hit.point.add(offset); closest = hit; }
    }
    return closest;
  }

  supportAt(position: MeshPoint, rise = .12, drop = .25) {
    return this.raycast({ x: position.x, y: position.y + rise, z: position.z }, { x: 0, y: -1, z: 0 }, rise + drop, .65);
  }

  isCapsuleClear(position: MeshPoint, radius = .46, height = 2.05, checkInterior = true) {
    const local = new THREE.Vector3();
    return this.offsets(position, position, radius + .01).every(offset => this.query.isCapsuleClear(local.copy(position).sub(offset), radius, height, checkInterior));
  }

  /**
   * Resolve overlapping/coplanar street shells across the union of repeated
   * tiles. This is a positional collision skin only: velocity is untouched, so
   * ground-level swinging skids instead of acquiring a synthetic bunny hop.
   */
  private applySupportClearance(position: THREE.Vector3, radius: number, height: number) {
    if (this.isCapsuleClear(position, radius, height, false)) return true;
    const support = this.supportAt(position, .08, radius + .08);
    if (!support) return false;
    const originalY = position.y;
    const supportedY = capsuleSupportHeight(support, radius);
    if (Math.abs(originalY - supportedY) > .085) return false;
    for (let lift = 0; lift <= .06 + 1e-7; lift += .006) {
      position.y = Math.max(originalY, supportedY) + lift;
      if (this.isCapsuleClear(position, radius, height, false)) return true;
    }
    position.y = originalY;
    return false;
  }

  sweepCapsule(from: MeshPoint, to: MeshPoint, velocity: MeshPoint, radius = .46, height = 2.05): MeshSweepResult {
    const position = new THREE.Vector3().copy(from), correctedVelocity = new THREE.Vector3().copy(velocity);
    const movement = new THREE.Vector3().copy(to).sub(position);
    const offsets = this.offsets(from, to, radius + .32);
    // Most frames touch one template. Keep the original BVH fast path.
    if (offsets.length === 1) {
      const offset = offsets[0];
      const hit = this.query.sweepCapsule(position.clone().sub(offset), new THREE.Vector3().copy(to).sub(offset), velocity, radius, height);
      hit.position.add(offset);
      this.applySupportClearance(hit.position, radius, height);
      return hit;
    }
    const requested = Math.max(1, Math.ceil(movement.length() / .16));
    const steps = Math.min(requested, 2048), step = movement.multiplyScalar(1 / requested);
    let wallNormal: THREE.Vector3 | null = null, feetTouching = false, grounded = false, contacts = 0, blocked = steps < requested;
    const before = new THREE.Vector3(), desired = new THREE.Vector3(), localFrom = new THREE.Vector3(), localTo = new THREE.Vector3();
    for (let i = 0; i < steps; i++) {
      before.copy(position); desired.copy(position).add(step);
      grounded = false;
      // Intersections belong to the union: every tile rechecks corrections made
      // by its neighbors before we accept a short, capsule-sized movement.
      for (let pass = 0; pass < 4; pass++) {
        let moved = false;
        for (const offset of offsets) {
          const hit = this.query.sweepCapsule(localFrom.copy(before).sub(offset), localTo.copy(desired).sub(offset), correctedVelocity, radius, height);
          hit.position.add(offset);
          moved ||= hit.position.distanceToSquared(desired) > 1e-8;
          desired.copy(hit.position); correctedVelocity.copy(hit.velocity);
          grounded ||= hit.grounded; contacts += hit.contacts; blocked ||= hit.blocked;
          if (hit.wallNormal) { wallNormal = hit.wallNormal; feetTouching ||= hit.feetTouching; }
        }
        if (!moved) break;
      }
      if (blocked && !this.isCapsuleClear(desired, radius, height, false)) {
        // A narrow seam cannot trade one building penetration for another.
        // Stay at the previous valid step; never repair by crossing a facade.
        correctedVelocity.set(0, 0, 0); blocked = true; break;
      }
      position.copy(desired);
      this.applySupportClearance(position, radius, height);
      if (wallNormal) {
        const incoming = step.dot(wallNormal);
        if (incoming < 0) step.addScaledVector(wallNormal, -incoming);
      }
    }
    const support = correctedVelocity.y <= .1 ? this.supportAt(position, .015, radius + .035) : null;
    grounded = Boolean(support && Math.abs(position.y - capsuleSupportHeight(support, radius)) <= .035);
    if (grounded && support) {
      const unsnappedY = position.y, supportedY = capsuleSupportHeight(support, radius);
      position.y = supportedY;
      if (!this.isCapsuleClear(position, radius, height, false)) {
        let foundClearSkin = false;
        for (let lift = .006; lift <= .06 + 1e-7; lift += .006) {
          position.y = supportedY + lift;
          if (this.isCapsuleClear(position, radius, height, false)) { foundClearSkin = true; break; }
        }
        if (!foundClearSkin) {
          position.y = Math.max(unsnappedY, supportedY);
          grounded = this.isCapsuleClear(position, radius, height, false);
        }
      }
      correctedVelocity.y = Math.max(0, correctedVelocity.y);
    }
    return { position, velocity: correctedVelocity, grounded, wallNormal, feetTouching, blocked, contacts };
  }
}
