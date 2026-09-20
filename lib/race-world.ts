import * as THREE from 'three';
import type {
  RaceCourse,
  RacePoint,
  RaceGateType,
  RaceGeometrySampler,
} from './race-session';
import type { RepeatingMeshWorld } from './repeating-mesh-world';
import type { TraversalState, Vector3Like } from './traversal-physics';

export type WindLane = {
  start: THREE.Vector3;
  end: THREE.Vector3;
  radius: number;
};

/** One-time course authoring queries use the same tiled collision world as play. */
export function createRaceGeometrySampler(
  world: RepeatingMeshWorld,
): RaceGeometrySampler {
  const down = new THREE.Vector3(0, -1, 0),
    top = Math.max(600, world.query.bounds.max.y + 80),
    bottom = Math.min(-100, world.query.bounds.min.y - 20);
  const directions = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1),
  ];
  return (desired, type, radius) => {
    const candidates: {
      position: RacePoint;
      type: RaceGateType;
      radius: number;
      cost: number;
    }[] = [];
    for (const [dx, dz] of [
      [0, 0],
      [-24, 0],
      [24, 0],
      [0, -24],
      [0, 24],
      [-48, 0],
      [48, 0],
      [0, -48],
      [0, 48],
    ]) {
      const x = desired[0] + dx,
        z = desired[2] + dz;
      const support = world.raycast(
        new THREE.Vector3(x, top, z),
        down,
        top - bottom,
        0.65,
      );
      if (!support) continue;
      const surface = support.point.y;
      if (type === 'wall-run') {
        const origin = new THREE.Vector3(
          x,
          Math.max(
            world.query.bounds.min.y + 10,
            Math.min(desired[1], surface + 14),
          ),
          z,
        );
        for (const direction of directions) {
          const wall = world.raycast(origin, direction, 35);
          if (!wall || Math.abs(wall.normal.y) > 0.35) continue;
          const position = wall.point
            .clone()
            .addScaledVector(wall.normal, 1.15);
          if (world.isCapsuleClear(position, 0.5, 2.1))
            candidates.push({
              position: position.toArray() as RacePoint,
              type,
              radius: 8,
              cost: Math.hypot(dx, dz) + wall.distance,
            });
        }
        continue;
      }
      if (type === 'rooftop-vault') {
        for (const direction of directions) {
          const edge = new THREE.Vector3(
            x + direction.x * 8,
            top,
            z + direction.z * 8,
          );
          const neighbor = world.raycast(edge, down, top - bottom, 0.65);
          if (!neighbor || surface - neighbor.point.y < 4) continue;
          const position = new THREE.Vector3(x, surface + 0.6, z);
          if (world.isCapsuleClear(position, 0.5, 2.1))
            candidates.push({
              position: position.toArray() as RacePoint,
              type,
              radius: 9,
              cost: Math.hypot(dx, dz) + Math.abs(surface - desired[1]) * 0.3,
            });
        }
        continue;
      }
      const clearance =
        type === 'low-swing'
          ? 10
          : type === 'point-launch'
            ? 4
            : type === 'dive'
              ? 18
              : type === 'wind'
                ? 20
                : Math.max(radius + 3, 8);
      const y =
        type === 'low-swing' || type === 'point-launch'
          ? surface + clearance
          : Math.max(surface + clearance, desired[1]);
      const position = new THREE.Vector3(x, y, z);
      const ringRadius = type === 'point-launch' ? 9 : radius;
      if (!world.isCapsuleClear(position, 0.6, 2.1)) continue;
      // Keep the main ring volume clear so a checkpoint never requires wall penetration.
      if (
        type !== 'point-launch' &&
        directions.some(
          (dir) =>
            !world.isCapsuleClear(
              position.clone().addScaledVector(dir, ringRadius * 0.7),
              0.5,
              2.1,
            ),
        )
      )
        continue;
      const cost =
        Math.hypot(dx, dz) +
        (type === 'low-swing' ? surface * 2 : Math.abs(y - desired[1]) * 0.6);
      candidates.push({
        position: position.toArray() as RacePoint,
        type,
        radius: ringRadius,
        cost,
      });
    }
    candidates.sort((a, b) => a.cost - b.cost);
    const best = candidates[0];
    return best
      ? { position: best.position, type: best.type, radius: best.radius }
      : null;
  };
}

/** Wind corridors are authored through measured gate volumes, above real roofs. */
export function windLanes(
  course: RaceCourse,
  world: RepeatingMeshWorld,
): WindLane[] {
  const start = new THREE.Vector3().fromArray(course.start),
    end = new THREE.Vector3().fromArray(course.finish),
    direction = end.clone().sub(start).setY(0).normalize();
  const centers =
    course.gates
      ?.filter((g) => g.type === 'wind')
      .map((g) => new THREE.Vector3().fromArray(g.position)) ?? [];
  if (!centers.length)
    for (const fraction of [0.28, 0.64])
      centers.push(start.clone().lerp(end, fraction));
  const lanes: WindLane[] = [];
  for (const center of centers) {
    const a = center.clone().addScaledVector(direction, -55),
      b = center.clone().addScaledVector(direction, 55);
    let height = Math.max(20, center.y);
    const ceiling = Math.max(600, world.query.bounds.max.y + 80);
    for (let i = 0; i <= 8; i++) {
      const p = a.clone().lerp(b, i / 8);
      const hit = world.raycast(
        new THREE.Vector3(p.x, ceiling, p.z),
        new THREE.Vector3(0, -1, 0),
        ceiling + 100,
      );
      if (hit) height = Math.max(height, hit.point.y + 12);
    }
    a.y = height;
    b.y = height + 3;
    lanes.push({ start: a, end: b, radius: 12 });
  }
  return lanes;
}

/** Pure authored acceleration: solver spends it through the shared assist budget.
 * Attached players receive tangent-only wind, so a lane cannot reel or stretch rope. */
export function sampleWindAssist(
  state: TraversalState,
  lanes: readonly WindLane[],
  _delta: number,
): { active: boolean; acceleration: Vector3Like | null } {
  if (
    state.grounded ||
    state.wallCrawlActive ||
    state.wallRunActive ||
    state.zip ||
    state.mantle
  )
    return { active: false, acceleration: null };
  const point = new THREE.Vector3().copy(state.position),
    total = new THREE.Vector3();
  let active = false;
  for (const lane of lanes) {
    const axis = lane.end.clone().sub(lane.start),
      length = axis.length();
    if (length < 0.001 || lane.radius <= 0) continue;
    const dir = axis.divideScalar(length),
      along = point.clone().sub(lane.start).dot(dir);
    if (along < 0 || along > length) continue;
    const nearest = lane.start.clone().addScaledVector(dir, along),
      distance = point.distanceTo(nearest);
    if (distance > lane.radius) continue;
    const weight = THREE.MathUtils.smoothstep(
      1 - distance / lane.radius,
      0,
      0.7,
    );
    total.x += (dir.x * 38 - state.velocity.x) * 0.32 * weight;
    total.z += (dir.z * 38 - state.velocity.z) * 0.32 * weight;
    total.y +=
      (8 +
        THREE.MathUtils.clamp((nearest.y - point.y) * 0.65, -4, 5) -
        state.velocity.y * 0.3) *
      weight;
    active = true;
  }
  if (!active) return { active: false, acceleration: null };
  if (state.swing) {
    const radial = point.clone().sub(state.swing.anchor).normalize();
    total.addScaledVector(radial, -total.dot(radial));
  }
  if (total.length() > 12) total.setLength(12);
  return { active: true, acceleration: { x: total.x, y: total.y, z: total.z } };
}

/** Compatibility query only. Apply sampleWindAssist.acceleration in stepTraversal. */
export function applyWind(
  state: TraversalState,
  lanes: readonly WindLane[],
  delta: number,
): boolean {
  return sampleWindAssist(state, lanes, delta).active;
}

export function raceRoutePoints(
  course: RaceCourse,
  activeIds: readonly string[] = [],
): RacePoint[] {
  if (!course.gates?.length) return [course.finish];
  const route: RacePoint[] = [];
  let id = activeIds[0] ?? course.gates[0].id;
  for (let i = 0; i < course.gates.length; i++) {
    const gate = course.gates.find((g) => g.id === id);
    if (!gate) break;
    route.push(gate.position);
    if (!gate.next.length) break;
    id = gate.next[0];
  }
  return route;
}

function disposeObject(root: THREE.Object3D) {
  root.removeFromParent();
  root.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
        m.dispose(),
      );
    }
  });
}
export class RaceWorldVisuals {
  readonly root = new THREE.Group();
  private goal = new THREE.Group();
  private route: THREE.Line;
  private windMeshes: THREE.Group[] = [];
  private gateMeshes = new Map<string, THREE.Mesh>();
  private course: RaceCourse | null = null;
  private activeIds: string[] = [];
  private particleDensity = 1;
  lanes: WindLane[] = [];
  constructor(scene: THREE.Scene) {
    this.root.add(this.goal);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(8, 0.18, 8, 48),
      new THREE.MeshBasicMaterial({
        color: '#74fff1',
        transparent: true,
        opacity: 0.9,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    this.goal.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 2, 75, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: '#54e6ff',
        transparent: true,
        opacity: 0.13,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    beam.position.y = 35;
    this.goal.add(beam);
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(9, 0.25, 6, 48),
      new THREE.MeshBasicMaterial({
        color: '#a4ffff',
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    halo.position.y = 10;
    this.goal.add(halo);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(33 * 3), 3),
    );
    geometry.setDrawRange(0, 2);
    this.route = new THREE.Line(
      geometry,
      new THREE.LineDashedMaterial({
        color: '#8fefff',
        transparent: true,
        opacity: 0.35,
        dashSize: 3,
        gapSize: 3,
      }),
    );
    this.root.add(this.route);
    scene.add(this.root);
    this.root.visible = false;
  }
  setCourse(course: RaceCourse, world: RepeatingMeshWorld) {
    this.course = course;
    this.root.visible = true;
    this.goal.visible = true;
    this.route.visible = true;
    this.goal.position.fromArray(course.finish);
    this.lanes = windLanes(course, world);
    for (const group of this.windMeshes) disposeObject(group);
    this.windMeshes = [];
    for (const mesh of this.gateMeshes.values()) disposeObject(mesh);
    this.gateMeshes.clear();
    for (const [index, gate] of (course.gates ?? []).entries()) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(gate.radius, 0.16, 6, 40),
        new THREE.MeshBasicMaterial({
          color: gate.type === 'precision' ? '#ffe87c' : '#73eaff',
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
        }),
      );
      ring.position.fromArray(gate.position);
      const previous = index ? course.gates![index - 1].position : course.start;
      ring.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        ring.position
          .clone()
          .sub(new THREE.Vector3().fromArray(previous))
          .normalize(),
      );
      this.root.add(ring);
      this.gateMeshes.set(gate.id, ring);
    }
    for (const lane of this.lanes) {
      const group = new THREE.Group();
      group.position.copy(lane.start);
      group.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        lane.end.clone().sub(lane.start).normalize(),
      );
      const length = lane.start.distanceTo(lane.end);
      for (let i = 0; i <= 8; i++) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(lane.radius, 0.035, 4, 36),
          new THREE.MeshBasicMaterial({
            color: '#81efff',
            transparent: true,
            opacity: 0.2,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        ring.position.z = (i * length) / 8;
        group.add(ring);
      }
      this.root.add(group);
      this.windMeshes.push(group);
    }
    this.setProgress(
      course.gates?.length ? [course.gates[0].id] : [],
      new Set(),
    );
    this.setParticleDensity(this.particleDensity);
  }
  setParticleDensity(fraction: number) {
    this.particleDensity = THREE.MathUtils.clamp(fraction, 0.15, 1);
    for (const group of this.windMeshes)
      group.children.forEach((ring, i) => {
        ring.visible = i % Math.ceil(1 / this.particleDensity) === 0;
      });
  }
  setProgress(activeIds: readonly string[], completed: ReadonlySet<string>) {
    this.activeIds = [...activeIds];
    const gates = this.course?.gates ?? [],
      active = gates.filter((g) => activeIds.includes(g.id));
    const finished = activeIds.length === 0 && completed.size > 0;
    this.route.visible = !finished;
    for (const gate of gates) {
      const mesh = this.gateMeshes.get(gate.id);
      if (!mesh) continue;
      const current = activeIds.includes(gate.id);
      mesh.visible = !finished && !completed.has(gate.id);
      (mesh.material as THREE.MeshBasicMaterial).opacity = current
        ? 0.95
        : 0.14;
    }
    if (active[0]) this.goal.position.fromArray(active[0].position);
    else if (this.course) this.goal.position.fromArray(this.course.finish);
  }
  update(position: RacePoint, elapsed: number) {
    if (!this.course) return;
    this.goal.children[2].rotation.y = elapsed * 0.35;
    this.goal.children[2].position.y = 10 + Math.sin(elapsed * 2) * 1.5;
    const points = raceRoutePoints(this.course, this.activeIds),
      vertices = this.route.geometry.getAttribute('position');
    vertices.setXYZ(0, position[0], position[1] + 1, position[2]);
    points.slice(0, 32).forEach((point, i) => vertices.setXYZ(i + 1, ...point));
    vertices.needsUpdate = true;
    this.route.geometry.setDrawRange(0, Math.min(32, points.length) + 1);
    this.route.computeLineDistances();
    this.route.geometry.computeBoundingSphere();
    for (const g of this.windMeshes)
      g.children.forEach((o, i) => {
        const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial;
        m.opacity = 0.1 + 0.18 * (0.5 + 0.5 * Math.sin(elapsed * 3 - i * 0.6));
      });
  }
  clear() {
    this.root.visible = false;
    this.lanes = [];
  }
  dispose() {
    disposeObject(this.root);
  }
}
