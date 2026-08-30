'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { getDistrict, getSuit, type DistrictConfig, type DistrictId, type SuitId } from '@/lib/game-config';
import { SpiderMultiplayer, type MultiplayerStatus, type NetworkPlayerState } from '@/lib/multiplayer';
import {
  createTraversalState,
  runTraversalPhysicsSelfTests,
  setTraversalKinematics,
  stepTraversalInPlace,
  type TraversalContext,
  type WebAnchorCandidate,
} from '@/lib/traversal-physics';
import { animateRigBones, collectRigBones, normalizeSuit, poseOnlyClips, prepareMaterials, retargetMixamoClips, type ProceduralPose, type RigBone } from '@/lib/three-assets';

export type GameHud = { speed: number; altitude: number; fps: number; swinging: boolean };
export type SpiderGameHandle = { travelTo: (id: DistrictId) => void };

type Props = {
  suitId: SuitId;
  districtId: DistrictId;
  onReady: () => void;
  onStatus: (message: string, progress: number) => void;
  onHud: (hud: GameHud) => void;
  onLoadedDistricts: (districts: Set<DistrictId>) => void;
  onDistrictChange: (district: DistrictId) => void;
  onOnlineCount: (count: number, status: MultiplayerStatus) => void;
};

type AvatarRig = {
  root: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  actions: Map<string, THREE.AnimationAction>;
  activeAction: string;
  bones: RigBone[];
  repulsors: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[];
};

type CollisionMetadata = {
  sourceWidth: number;
  sourceGroundY?: number;
  sourceBounds?: [number, number, number, number, number, number];
  colliders: [number, number, number, number, number, number][];
};

type IronFlightMode = 'grounded' | 'freefall' | 'hover' | 'cruise';

type RemoteAvatar = {
  root: THREE.Group;
  bones: RigBone[];
  targetPosition: THREE.Vector3;
  targetYaw: number;
  mode: string;
  suitId: SuitId;
  lastSequence: number;
  lastUpdate: number;
};

type StreamedTile = {
  root: THREE.Group;
  anchorProxy: THREE.Object3D | null;
  walkables: THREE.Object3D[];
  x: number;
  z: number;
};

type DistrictStream = {
  template: THREE.Group;
  anchorTemplate: THREE.Object3D | null;
  baseColliders: THREE.Box3[];
  tileWidth: number;
  tileDepth: number;
  tiles: Map<string, StreamedTile>;
  centerX: number;
  centerZ: number;
};

const networkPose = (mode: string): ProceduralPose => mode === 'swing' ? 'swing'
  : mode === 'webZip' || mode === 'pointLaunch' ? 'zip'
    : mode === 'wallRun' ? 'wall'
      : mode === 'wallCrawl' ? 'crawl'
        : mode === 'dive' ? 'dive'
          : mode === 'run' ? 'run'
            : mode === 'idle' || mode === 'land' || mode === 'perch' ? 'idle' : 'jump';

const GROUND_Y = .12;
const COLLIDER_CELL_SIZE = 48;
const districtSpawn = (district: DistrictConfig) => {
  const local = new THREE.Vector3(district.spawn?.[0] ?? 0, 0, district.spawn?.[1] ?? 0)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), district.rotation ?? 0);
  return new THREE.Vector3(district.position[0] + local.x, GROUND_Y, district.position[2] + local.z);
};
const cameraCollisionBox = new THREE.Box3();
const cameraCollisionHit = new THREE.Vector3();
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const damp = (from: number, to: number, lambda: number, delta: number) => THREE.MathUtils.lerp(from, to, 1 - Math.exp(-lambda * delta));
const colliderCellKey = (x: number, z: number) => `${x}:${z}`;

function addSpatialCollider(index: Map<string, THREE.Box3[]>, collider: THREE.Box3) {
  const minX = Math.floor(collider.min.x / COLLIDER_CELL_SIZE);
  const maxX = Math.floor(collider.max.x / COLLIDER_CELL_SIZE);
  const minZ = Math.floor(collider.min.z / COLLIDER_CELL_SIZE);
  const maxZ = Math.floor(collider.max.z / COLLIDER_CELL_SIZE);
  for (let x = minX; x <= maxX; x += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      const key = colliderCellKey(x, z);
      const cell = index.get(key) ?? [];
      cell.push(collider);
      index.set(key, cell);
    }
  }
}

function transformSourceCollider(source: readonly number[], scale: number, modelOffset: THREE.Vector3, config: DistrictConfig) {
  const rotation = config.rotation ?? 0;
  const result = new THREE.Box3().makeEmpty();
  for (const x of [source[0], source[3]]) {
    for (const y of [source[1], source[4]]) {
      for (const z of [source[2], source[5]]) {
        const point = new THREE.Vector3(x * scale, y * scale, z * scale)
          .add(modelOffset)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation)
          .add(new THREE.Vector3(...config.position));
        result.expandByPoint(point);
      }
    }
  }
  return result;
}

function seeded(index: number) {
  const value = Math.sin(index * 9187.231 + 41.77) * 43758.5453;
  return value - Math.floor(value);
}

function addSky(scene: THREE.Scene) {
  const skyUniforms = {
    topColor: { value: new THREE.Color('#168de2') },
    horizonColor: { value: new THREE.Color('#bfe9ff') },
    sunColor: { value: new THREE.Color('#fff4cf') },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(9000, 32, 18),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: skyUniforms,
      vertexShader: 'varying vec3 vWorld; void main(){ vec4 world = modelMatrix * vec4(position, 1.0); vWorld = world.xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 sunColor;
        varying vec3 vWorld;
        void main(){
          vec3 direction = normalize(vWorld);
          float height = smoothstep(-0.08, 0.58, direction.y);
          float sun = pow(max(0.0, dot(direction, normalize(vec3(-0.35, 0.42, -0.84)))), 180.0);
          vec3 color = mix(horizonColor, topColor, height);
          gl_FragColor = vec4(mix(color, sunColor, sun * 0.82), 1.0);
        }
      `,
    }),
  );
  sky.name = 'NYC daylight sky';
  scene.add(sky);

  const cloudUniforms = { time: { value: 0 } };
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(8600, 32, 18),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      uniforms: cloudUniforms,
      vertexShader: 'varying vec3 vDirection; void main(){ vDirection = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform float time;
        varying vec3 vDirection;
        float cloudNoise(vec2 point) {
          float first = sin(point.x * 7.0 + sin(point.y * 5.0));
          float second = sin(point.y * 11.0 - point.x * 3.0);
          float third = sin((point.x + point.y) * 17.0) * 0.45;
          return first * 0.46 + second * 0.34 + third * 0.2;
        }
        void main(){
          vec2 drift = vec2(time * 0.007, time * 0.0025);
          vec2 point = vec2(atan(vDirection.z, vDirection.x) / 6.28318, vDirection.y) + drift;
          float broad = cloudNoise(point * vec2(2.6, 1.8));
          float detail = cloudNoise(point * vec2(7.2, 4.4) + 1.7) * 0.32;
          float cloud = smoothstep(0.18, 0.58, broad + detail);
          float altitude = smoothstep(0.12, 0.3, vDirection.y) * (1.0 - smoothstep(0.78, 0.96, vDirection.y));
          gl_FragColor = vec4(vec3(1.0, 0.985, 0.95), cloud * altitude * 0.54);
        }
      `,
    }),
  );
  clouds.name = 'Animated NYC cloud field';
  scene.add(clouds);
  return {
    update: (elapsed: number) => { cloudUniforms.time.value = elapsed; },
  };
}

function createAsphaltTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#30363d';
    context.fillRect(0, 0, 512, 512);
    for (let index = 0; index < 9000; index += 1) {
      const shade = 38 + Math.floor(seeded(index + 900) * 32);
      context.fillStyle = `rgba(${shade},${shade + 2},${shade + 4},${.08 + seeded(index + 77) * .18})`;
      const size = 1 + Math.floor(seeded(index + 101) * 3);
      context.fillRect(seeded(index + 33) * 512, seeded(index + 61) * 512, size, size);
    }
    context.strokeStyle = 'rgba(12,16,20,.14)';
    context.lineWidth = 1;
    for (let crack = 0; crack < 4; crack += 1) {
      context.beginPath();
      context.moveTo(seeded(crack + 400) * 512, seeded(crack + 500) * 512);
      for (let segment = 0; segment < 3; segment += 1) {
        context.lineTo(seeded(crack * 17 + segment + 600) * 512, seeded(crack * 23 + segment + 700) * 512);
      }
      context.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(42, 42);
  texture.anisotropy = 4;
  return texture;
}

type SwingDistrictBuilding = {
  collider: THREE.Box3;
  facadeMatrix: THREE.Matrix4;
  roofMatrix: THREE.Matrix4;
  variant: number;
};

type SwingDistrictResult = {
  colliders: THREE.Box3[];
  extent: number;
  buildingCount: number;
};

function createFacadeTexture(variant: number) {
  const palettes = [
    { wall: '#172a3d', mortar: '#29445b', dark: '#07111d', light: '#a9e5ff' },
    { wall: '#403431', mortar: '#685149', dark: '#130e0d', light: '#ffd08e' },
    { wall: '#202b33', mortar: '#53636c', dark: '#091014', light: '#d8f4ff' },
    { wall: '#26314b', mortar: '#3d4f75', dark: '#080d1d', light: '#88cfff' },
  ][variant % 4];
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = palettes.wall;
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let floor = 0; floor < 18; floor += 1) {
      for (let column = 0; column < 7; column += 1) {
        const x = 10 + column * 35;
        const y = 8 + floor * 28;
        const lit = seeded(variant * 1000 + floor * 19 + column * 7) > .68;
        context.fillStyle = lit ? palettes.light : palettes.dark;
        context.fillRect(x, y, 20, 16);
        context.fillStyle = lit ? 'rgba(255,255,255,.24)' : 'rgba(95,170,205,.09)';
        context.fillRect(x + 2, y + 2, 3, 12);
      }
    }
    context.strokeStyle = palettes.mortar;
    context.lineWidth = 3;
    for (let floor = 0; floor <= 18; floor += 1) {
      const y = floor * 28;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(256, y);
      context.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

const landmarkSlots: readonly [number, number][] = [
  [-196, -224], [-84, -224], [84, -224], [196, -224],
  [-252, -96], [-140, -96], [140, -96], [252, -96],
  [-196, 32], [-84, 32], [84, 32], [196, 32],
  [-252, 160], [-140, 160], [0, 160], [140, 160], [252, 160],
  [-196, 224], [-84, 224], [84, 224], [196, 224],
] as const;

function distributeLandmarks(model: THREE.Group, root: THREE.Group) {
  const landmarks = model.children.filter((object) => {
    let containsMesh = false;
    object.traverse((child) => { if (child instanceof THREE.Mesh) containsMesh = true; });
    return containsMesh;
  });
  model.updateWorldMatrix(true, true);
  const ranked = landmarks
    .map((object) => ({ object, height: new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3()).y }))
    .sort((a, b) => a.height - b.height);
  const rank = new Map(ranked.map((entry, index) => [entry.object, index / Math.max(1, ranked.length - 1)]));
  const boxes: THREE.Box3[] = [];

  landmarks.forEach((object, index) => {
    let box = new THREE.Box3().setFromObject(object);
    let size = box.getSize(new THREE.Vector3());
    const stature = rank.get(object) ?? 0;
    const targetHeight = 62 + stature * 96 + seeded(index + 1300) * 12;
    const targetFootprint = 20 + seeded(index + 1500) * 12;
    const footprintScale = clamp(targetFootprint / Math.max(size.x, size.z, .1), .62, 2.15);
    object.scale.x *= footprintScale;
    object.scale.z *= footprintScale;
    object.scale.y *= targetHeight / Math.max(size.y, .1);
    object.updateWorldMatrix(true, true);

    box = new THREE.Box3().setFromObject(object);
    size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const slot = landmarkSlots[index % landmarkSlots.length];
    const desired = root.localToWorld(new THREE.Vector3(slot[0], 0, slot[1]));
    const deltaWorld = new THREE.Vector3(desired.x - center.x, desired.y - box.min.y, desired.z - center.z);
    const inverseModel = model.matrixWorld.clone().invert();
    const localOrigin = new THREE.Vector3().applyMatrix4(inverseModel);
    const localDelta = deltaWorld.clone().applyMatrix4(inverseModel).sub(localOrigin);
    object.position.add(localDelta);
    object.updateWorldMatrix(true, true);
    box = new THREE.Box3().setFromObject(object);
    boxes.push(box);
  });
  model.updateWorldMatrix(true, true);
  return boxes;
}

/**
 * Builds a Manhattan-style traversal district around the imported landmark.
 * The visuals, rooftop targets, and physics all share the same AABBs so there
 * is no decorative facade that Spider-Man can pass through.
 */
function addProceduralSwingDistrict(
  root: THREE.Group,
  config: DistrictConfig,
  landmarkBounds: readonly THREE.Box3[],
): SwingDistrictResult {
  const extent = 560;
  const half = extent / 2;
  const cellX = 56;
  const cellZ = 64;
  const roadX = 28;
  const roadZ = 26;
  const quaternion = new THREE.Quaternion();
  const buildings: SwingDistrictBuilding[] = [];
  const landmarkClearance = landmarkBounds.map((bounds) => bounds.clone().expandByScalar(12));

  let index = 0;
  for (let gridX = -5; gridX < 5; gridX += 1) {
    for (let gridZ = -4; gridZ < 4; gridZ += 1) {
      const x = (gridX + .5) * cellX;
      const z = (gridZ + .5) * cellZ;
      const width = cellX - roadX - 2 - seeded(index + 20) * 5;
      const depth = cellZ - roadZ - 2 - seeded(index + 40) * 6;
      const skylineBand = 1 - Math.min(1, Math.hypot(x, z) / half);
      const height = 34 + seeded(index + 60) * 50 + skylineBand * 34;
      const worldCenter = new THREE.Vector3(x, height / 2, z)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), config.rotation ?? 0)
        .add(new THREE.Vector3(...config.position));
      const collider = new THREE.Box3(
        new THREE.Vector3(worldCenter.x - width / 2, 0, worldCenter.z - depth / 2),
        new THREE.Vector3(worldCenter.x + width / 2, height + .4, worldCenter.z + depth / 2),
      );
      index += 1;
      if (landmarkClearance.some((bounds) => collider.intersectsBox(bounds))) continue;

      const facadeMatrix = new THREE.Matrix4().compose(
        new THREE.Vector3(x, height / 2, z),
        quaternion,
        new THREE.Vector3(width, height, depth),
      );
      const roofMatrix = new THREE.Matrix4().compose(
        new THREE.Vector3(x, height + .2, z),
        quaternion,
        new THREE.Vector3(width + .35, .4, depth + .35),
      );
      buildings.push({ collider, facadeMatrix, roofMatrix, variant: Math.floor(seeded(index + 800) * 4) });
    }
  }

  const district = new THREE.Group();
  district.name = 'Collision-safe Manhattan swing grid';
  const facadeGeometry = new THREE.BoxGeometry(1, 1, 1);
  const roofGeometry = new THREE.BoxGeometry(1, 1, 1);
  for (let variant = 0; variant < 4; variant += 1) {
    const variantBuildings = buildings.filter((building) => building.variant === variant);
    if (!variantBuildings.length) continue;
    const facade = new THREE.InstancedMesh(
      facadeGeometry,
      new THREE.MeshStandardMaterial({
        map: createFacadeTexture(variant),
        color: '#ffffff',
        roughness: .78,
        metalness: .05,
      }),
      variantBuildings.length,
    );
    const roof = new THREE.InstancedMesh(
      roofGeometry,
      new THREE.MeshStandardMaterial({
        color: ['#243542', '#4b403b', '#38444a', '#303c58'][variant],
        roughness: .9,
        metalness: .03,
      }),
      variantBuildings.length,
    );
    variantBuildings.forEach((building, instance) => {
      facade.setMatrixAt(instance, building.facadeMatrix);
      roof.setMatrixAt(instance, building.roofMatrix);
    });
    facade.instanceMatrix.needsUpdate = true;
    roof.instanceMatrix.needsUpdate = true;
    facade.name = `Swing tower facades ${variant + 1}`;
    roof.name = `Clickable rooftop caps ${variant + 1}`;
    facade.receiveShadow = true;
    roof.receiveShadow = true;
    district.add(facade, roof);
  }

  const avenue = new THREE.Mesh(
    new THREE.BoxGeometry(roadX + 8, .035, extent),
    new THREE.MeshBasicMaterial({ color: '#202b34' }),
  );
  avenue.position.y = .012;
  avenue.name = 'Central swing avenue';
  district.add(avenue);
  root.add(district);
  return { colliders: buildings.map((building) => building.collider), extent, buildingCount: buildings.length };
}

function createColliderAnchorProxy(colliders: readonly THREE.Box3[], name: string) {
  const proxyMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  proxyMaterial.colorWrite = false;
  const proxy = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), proxyMaterial, colliders.length);
  proxy.name = name;
  const matrix = new THREE.Matrix4();
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  colliders.forEach((collider, index) => {
    collider.getCenter(center);
    collider.getSize(size);
    matrix.compose(center, new THREE.Quaternion(), size);
    proxy.setMatrixAt(index, matrix);
  });
  proxy.instanceMatrix.needsUpdate = true;
  proxy.frustumCulled = false;
  return proxy;
}

function addAuthoredMapFloor(root: THREE.Group, width: number, depth: number, name: string) {
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(width + 12, .28, depth + 12),
    new THREE.MeshBasicMaterial({ map: createAsphaltTexture(), color: '#d7dce0' }),
  );
  floor.position.y = -.16;
  floor.receiveShadow = true;
  floor.name = `${name} solid gameplay floor`;
  floor.userData.walkableStreetSurface = true;
  root.add(floor);
  return floor;
}

function addLandmarkColliders(
  scene: THREE.Scene,
  colliders: THREE.Box3[],
  anchors: Set<THREE.Object3D>,
  config: DistrictConfig,
  width: number,
  depth: number,
  height: number,
) {
  const shortSide = Math.max(4, Math.min(width, depth));
  const road = clamp(shortSide * .18, Math.min(2, shortSide * .2), shortSide * .45);
  const blockWidth = Math.max(2, (width - road) / 2);
  const blockDepth = Math.max(2, (depth - road) / 2);
  const proxyMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  proxyMaterial.colorWrite = false;
  for (const xSign of [-1, 1]) {
    for (const zSign of [-1, 1]) {
      const x = config.position[0] + xSign * (road / 2 + blockWidth / 2);
      const z = config.position[2] + zSign * (road / 2 + blockDepth / 2);
      const box = new THREE.Box3(
        new THREE.Vector3(x - blockWidth / 2, 0, z - blockDepth / 2),
        new THREE.Vector3(x + blockWidth / 2, Math.max(12, height), z + blockDepth / 2),
      );
      colliders.push(box);
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(blockWidth, Math.max(12, height), blockDepth), proxyMaterial);
      proxy.position.set(x, Math.max(12, height) / 2, z);
      proxy.name = `${config.name} building collision`;
      scene.add(proxy);
      anchors.add(proxy);
    }
  }
}

function cameraAgainstWorld(target: THREE.Vector3, desired: THREE.Vector3, colliders: readonly THREE.Box3[]) {
  const direction = desired.clone().sub(target);
  const distance = direction.length();
  if (distance < .001) return desired;
  const ray = new THREE.Ray(target, direction.normalize());
  let nearest = distance;
  for (const collider of colliders) {
    cameraCollisionBox.copy(collider).expandByScalar(.3);
    const point = ray.intersectBox(cameraCollisionBox, cameraCollisionHit);
    if (point) nearest = Math.min(nearest, point.distanceTo(target) - .3);
  }
  if (nearest < distance) desired.copy(target).addScaledVector(direction, Math.max(1.4, nearest));
  desired.y = Math.max(1.15, desired.y);
  return desired;
}

function enforceBuildingSolidity(
  position: { x: number; y: number; z: number },
  velocity: { x: number; y: number; z: number },
  colliders: readonly THREE.Box3[],
) {
  const radius = .46;
  let corrected = false;
  for (const collider of colliders) {
    if (position.y > collider.max.y + 1.7 || position.y + 1.8 < collider.min.y) continue;
    // The traversal solver deliberately lands on collider tops. Do not run the
    // horizontal penetration fallback against a player standing on a rooftop.
    if (position.y >= collider.max.y - .08) continue;
    const minX = collider.min.x - radius;
    const maxX = collider.max.x + radius;
    const minZ = collider.min.z - radius;
    const maxZ = collider.max.z + radius;
    if (position.x <= minX || position.x >= maxX || position.z <= minZ || position.z >= maxZ) continue;
    const exits = [
      { distance: position.x - minX, axis: 'x' as const, value: minX, normal: -1 },
      { distance: maxX - position.x, axis: 'x' as const, value: maxX, normal: 1 },
      { distance: position.z - minZ, axis: 'z' as const, value: minZ, normal: -1 },
      { distance: maxZ - position.z, axis: 'z' as const, value: maxZ, normal: 1 },
    ].sort((a, b) => a.distance - b.distance);
    const exit = exits[0];
    position[exit.axis] = exit.value;
    if (velocity[exit.axis] * exit.normal < 0) velocity[exit.axis] = 0;
    corrected = true;
  }
  return corrected;
}

function chooseRooftopSpawn(config: DistrictConfig, colliders: readonly THREE.Box3[], bounds: THREE.Box3) {
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const viable = colliders.filter((collider) => {
    const footprint = collider.getSize(new THREE.Vector3());
    return collider.max.y > GROUND_Y + 4 && footprint.x > 1.2 && footprint.z > 1.2;
  });
  const central = viable.filter((collider) => {
    const colliderCenter = collider.getCenter(new THREE.Vector3());
    return Math.abs(colliderCenter.x - center.x) < Math.max(8, size.x * .34)
      && Math.abs(colliderCenter.z - center.z) < Math.max(8, size.z * .34);
  });
  const candidates = central.length ? central : viable;
  const rooftop = candidates.sort((a, b) => b.max.y - a.max.y)[0];
  if (!rooftop) return districtSpawn(config);
  const rooftopCenter = rooftop.getCenter(new THREE.Vector3());
  return new THREE.Vector3(rooftopCenter.x, rooftop.max.y + .025, rooftopCenter.z);
}

export const SpiderGame = forwardRef<SpiderGameHandle, Props>(function SpiderGame(props, ref) {
  const mountRef = useRef<HTMLDivElement>(null);
  const travelRef = useRef<(id: DistrictId) => void>(() => undefined);
  const callbacksRef = useRef(props);
  useEffect(() => { callbacksRef.current = props; }, [props]);
  useImperativeHandle(ref, () => ({ travelTo: (id) => travelRef.current(id) }), []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;
    let frameId = 0;
    let ready = false;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2('#9acbe3', .0002);
    const atmosphere = addSky(scene);
    const camera = new THREE.PerspectiveCamera(66, 1, .08, 12000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = 'game-canvas';
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute('aria-label', 'Playable 3D SpiderMan city');
    if (process.env.NODE_ENV !== 'production') {
      renderer.domElement.dataset.collisionSelfTest = String(runTraversalPhysicsSelfTests().passed);
    }
    mount.appendChild(renderer.domElement);
    scene.add(new THREE.AmbientLight('#9bc9e8', .42));
    scene.add(new THREE.HemisphereLight('#a3d4ff', '#2b1516', 1.35));
    const sun = new THREE.DirectionalLight('#ffd4bc', 1.85);
    sun.position.set(-180, 360, 170);
    sun.castShadow = false;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -150;
    sun.shadow.camera.right = 150;
    sun.shadow.camera.top = 150;
    sun.shadow.camera.bottom = -150;
    scene.add(sun);

    const worldColliders: THREE.Box3[] = [];
    const spatialColliders = new Map<string, THREE.Box3[]>();
    const districtBounds = new Map<DistrictId, THREE.Box3>();
    const districtRooftopSpawns = new Map<DistrictId, THREE.Vector3>();
    const walkableSurfaces = new Set<THREE.Object3D>();
    let walkableSurfaceList: THREE.Object3D[] = [];
    const districtStreams = new Map<DistrictId, DistrictStream>();
    const groundHeightCache = new Map<string, number>();
    const groundRaycaster = new THREE.Raycaster();
    const groundRayOrigin = new THREE.Vector3();
    const groundRayDirection = new THREE.Vector3(0, -1, 0);
    const groundYAt = (position: { x: number; y: number; z: number }) => {
      if (!walkableSurfaceList.length) return GROUND_Y;
      const cacheKey = `${Math.round(position.x * 2)}:${Math.round(position.z * 2)}`;
      const cached = groundHeightCache.get(cacheKey);
      if (cached !== undefined) return cached;
      groundRayOrigin.set(position.x, GROUND_Y + 4, position.z);
      groundRaycaster.set(groundRayOrigin, groundRayDirection);
      groundRaycaster.far = 8;
      const surface = groundRaycaster.intersectObjects(walkableSurfaceList, false)[0];
      const groundY = surface ? Math.max(GROUND_Y, surface.point.y + GROUND_Y) : GROUND_Y;
      if (groundHeightCache.size > 8000) groundHeightCache.clear();
      groundHeightCache.set(cacheKey, groundY);
      return groundY;
    };
    let indexedColliderCount = 0;
    const nearbyColliders = (position: { x: number; y: number; z: number }, radius = 42) => {
      const result = new Set<THREE.Box3>(worldColliders);
      const minX = Math.floor((position.x - radius) / COLLIDER_CELL_SIZE);
      const maxX = Math.floor((position.x + radius) / COLLIDER_CELL_SIZE);
      const minZ = Math.floor((position.z - radius) / COLLIDER_CELL_SIZE);
      const maxZ = Math.floor((position.z + radius) / COLLIDER_CELL_SIZE);
      for (let x = minX; x <= maxX; x += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          for (const collider of spatialColliders.get(colliderCellKey(x, z)) ?? []) result.add(collider);
        }
      }
      return [...result];
    };
    const safeSpawn = (district: DistrictConfig) => {
      const rooftop = districtRooftopSpawns.get(district.id);
      if (rooftop) return rooftop.clone();
      const desired = districtSpawn(district);
      const requiredClearance = district.spawnClearance ?? 2.5;
      const clearance = (point: THREE.Vector3) => {
        let nearest = 42;
        for (const collider of nearbyColliders(point, 42)) {
          if (collider.max.y <= GROUND_Y) continue;
          const dx = Math.max(collider.min.x - point.x, 0, point.x - collider.max.x);
          const dz = Math.max(collider.min.z - point.z, 0, point.z - collider.max.z);
          if (dx === 0 && dz === 0) return -1;
          nearest = Math.min(nearest, Math.hypot(dx, dz));
        }
        return nearest;
      };
      let best = desired;
      let bestScore = clearance(desired);
      // Authored spawns are chosen for a useful street-level view. Keep them
      // when they already have player-width clearance; only search outward
      // when an imported building actually overlaps the spawn.
      if (bestScore >= requiredClearance) {
        best.y = groundYAt(best);
        return best;
      }
      const bounds = districtBounds.get(district.id);
      const maximumRadius = Math.min(120, district.targetWidth * .28);
      const radiusStep = Math.max(.75, Math.min(8, maximumRadius / 4));
      const boundsInset = Math.min(4, district.targetWidth * .04);
      for (let radius = radiusStep; radius <= maximumRadius; radius += radiusStep) {
        for (let step = 0; step < 32; step += 1) {
          const angle = step / 32 * Math.PI * 2;
          const candidate = desired.clone().add(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
          if (bounds && (
            candidate.x < bounds.min.x + boundsInset || candidate.x > bounds.max.x - boundsInset
            || candidate.z < bounds.min.z + boundsInset || candidate.z > bounds.max.z - boundsInset
          )) continue;
          const candidateClearance = clearance(candidate);
          if (candidateClearance >= requiredClearance) {
            candidate.y = groundYAt(candidate);
            return candidate;
          }
          const score = candidateClearance - radius * .006;
          if (candidateClearance >= 0 && score > bestScore) {
            best = candidate;
            bestScore = score;
          }
        }
      }
      best.y = groundYAt(best);
      return best;
    };
    const anchorTargets = new Set<THREE.Object3D>();
    let anchorTargetList: THREE.Object3D[] = [];
    const loadedDistricts = new Set<DistrictId>();
    const districtPromises = new Map<DistrictId, Promise<THREE.Group>>();
    const districtModelPromises = new Map<string, Promise<THREE.Group>>();
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const keys = new Set<string>();
    const initialDistrict = getDistrict(props.districtId);
    const initialSpawn = districtSpawn(initialDistrict);
    const player = { position: initialSpawn.clone(), velocity: new THREE.Vector3(), facing: 0, grounded: true };
    const traversal = createTraversalState(player.position, player.velocity);
    traversal.grounded = true;
    traversal.mode = 'idle';
    let cameraYaw = initialDistrict.spawnYaw ?? 0;
    let cameraPitch = initialDistrict.spawnPitch ?? .08;
    let wallCameraBlend = 0;
    const wallCameraNormal = new THREE.Vector3(0, 0, 1);
    let avatar: AvatarRig | null = null;
    let multiplayer: SpiderMultiplayer | null = null;
    let multiplayerStatus: MultiplayerStatus = 'connecting';
    let onlinePeerCount = 0;
    let networkSequence = 0;
    let lastNetworkBroadcast = -1;
    const remoteAvatars = new Map<string, RemoteAvatar>();
    const remoteStates = new Map<string, NetworkPlayerState>();
    const remoteLoads = new Map<string, Promise<void>>();
    let currentDistrict: DistrictId = props.districtId;
    let hudAccumulator = 0;
    let fpsAccumulator = 0;
    let fpsFrames = 0;
    let measuredFps = 60;
    let buildingCorrectionCount = 0;
    let performanceScaled = false;
    let lastFrameTime = performance.now();
    let elapsedTime = 0;
    let jumpPressed = false;
    let zipPressed = false;
    let zipReleased = false;
    let pointerHeld = false;
    let pointerPressed = false;
    let pointerReleased = false;
    let pointerDownAt = -10_000;
    let pointerZipActive = false;
    let grappleLineUntil = -1;
    let pointerPressure = .55;
    let hoverTogglePressed = false;
    let cruiseTogglePressed = false;
    let ironFlightMode: IronFlightMode = 'grounded';
    let spacePressedAt = -10;
    const pointerNdc = new THREE.Vector2(0, 0);
    const raycaster = new THREE.Raycaster();
    raycaster.far = 360;
    const webPositions = new Float32Array(6);
    const webGeometry = new THREE.BufferGeometry();
    webGeometry.setAttribute('position', new THREE.BufferAttribute(webPositions, 3));
    const webLine = new THREE.Line(webGeometry, new THREE.LineBasicMaterial({ color: '#e6fbff', transparent: true, opacity: .94 }));
    webLine.visible = false;
    webLine.frustumCulled = false;
    scene.add(webLine);

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    const notifyLoaded = () => callbacksRef.current.onLoadedDistricts(new Set(loadedDistricts));

    const loadModel = <T,>(url: string, label: string, start: number, end: number, report = true) => new Promise<T>((resolve, reject) => {
      loader.load(url, (gltf) => resolve(gltf as T), (event) => {
        const ratio = event.total > 0 ? event.loaded / event.total : Math.min(.92, event.loaded / 20_000_000);
        if (report) callbacksRef.current.onStatus(`Streaming ${label}`, start + (end - start) * clamp(ratio, 0, 1));
      }, reject);
    });

    const removeRemoteAvatar = (playerId: string) => {
      const remote = remoteAvatars.get(playerId);
      if (!remote) return;
      scene.remove(remote.root);
      remote.root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
      remoteAvatars.delete(playerId);
    };

    const clearRemoteAvatars = () => {
      for (const playerId of remoteAvatars.keys()) removeRemoteAvatar(playerId);
      remoteStates.clear();
    };

    const ensureRemoteAvatar = (state: NetworkPlayerState) => {
      const existingState = remoteStates.get(state.playerId);
      if (existingState && state.sequence <= existingState.sequence) return;
      remoteStates.set(state.playerId, state);
      const existing = remoteAvatars.get(state.playerId);
      if (existing && existing.suitId === state.suitId) {
        existing.targetPosition.fromArray(state.position);
        existing.targetYaw = state.yaw;
        existing.mode = state.mode;
        existing.lastSequence = state.sequence;
        existing.lastUpdate = performance.now();
        return;
      }
      if (existing) removeRemoteAvatar(state.playerId);
      if (remoteLoads.has(state.playerId)) return;

      const promise = (async () => {
        const suit = getSuit(state.suitId);
        const gltf = await loadModel<{ scene: THREE.Group }>(suit.model, `${suit.name} network avatar`, 0, 0, false);
        if (disposed) return;
        const latest = remoteStates.get(state.playerId);
        if (!latest || latest.suitId !== suit.id || latest.districtId !== currentDistrict) return;
        prepareMaterials(gltf.scene, renderer, 'character');
        normalizeSuit(gltf.scene, suit, 2.05);
        const root = new THREE.Group();
        root.name = `Network player: ${state.playerId}`;
        root.add(gltf.scene);
        root.position.fromArray(latest.position);
        root.rotation.y = latest.yaw;

        const marker = new THREE.Mesh(
          new THREE.RingGeometry(.72, .82, 32),
          new THREE.MeshBasicMaterial({ color: '#44e5ff', transparent: true, opacity: .72, side: THREE.DoubleSide }),
        );
        marker.rotation.x = -Math.PI / 2;
        marker.position.y = .025;
        marker.name = 'Network player marker';
        root.add(marker);
        scene.add(root);
        remoteAvatars.set(state.playerId, {
          root,
          bones: collectRigBones(gltf.scene),
          targetPosition: new THREE.Vector3().fromArray(latest.position),
          targetYaw: latest.yaw,
          mode: latest.mode,
          suitId: latest.suitId,
          lastSequence: latest.sequence,
          lastUpdate: performance.now(),
        });
      })().catch((error) => console.info('[multiplayer] remote avatar unavailable', error)).finally(() => {
        remoteLoads.delete(state.playerId);
      });
      remoteLoads.set(state.playerId, promise);
    };

    const updateRemoteAvatars = (delta: number) => {
      const now = performance.now();
      for (const [playerId, remote] of remoteAvatars) {
        if (now - remote.lastUpdate > 5_000) {
          removeRemoteAvatar(playerId);
          continue;
        }
        remote.root.position.lerp(remote.targetPosition, 1 - Math.exp(-12 * delta));
        remote.root.rotation.y = damp(remote.root.rotation.y, remote.targetYaw, 12, delta);
        animateRigBones(remote.bones, networkPose(remote.mode), elapsedTime, delta, getSuit(remote.suitId).rigPreset);
      }
    };

    const reportMultiplayer = () => {
      callbacksRef.current.onOnlineCount(multiplayerStatus === 'online' ? onlinePeerCount + 1 : 1, multiplayerStatus);
      renderer.domElement.dataset.multiplayerStatus = multiplayerStatus;
      renderer.domElement.dataset.onlinePlayers = String(multiplayerStatus === 'online' ? onlinePeerCount + 1 : 1);
    };

    const connectMultiplayer = () => {
      multiplayer = SpiderMultiplayer.create(props.suitId, currentDistrict, {
        onPlayerState: ensureRemoteAvatar,
        onPeers: (peerIds) => {
          onlinePeerCount = peerIds.size;
          for (const playerId of remoteAvatars.keys()) {
            if (!peerIds.has(playerId)) removeRemoteAvatar(playerId);
          }
          reportMultiplayer();
        },
        onStatus: (status) => {
          multiplayerStatus = status;
          reportMultiplayer();
        },
      });
      reportMultiplayer();
      if (multiplayer) void multiplayer.join(currentDistrict, props.suitId);
    };

    const tileKey = (x: number, z: number) => `${x}:${z}`;
    const tileWalkables = (root: THREE.Object3D) => {
      const result: THREE.Object3D[] = [];
      root.traverse((object) => {
        if (object.userData.walkableStreetSurface) result.push(object);
      });
      return result;
    };

    const rebuildStreamedCollision = (stream: DistrictStream) => {
      spatialColliders.clear();
      worldColliders.length = 0;
      indexedColliderCount = 0;
      const offset = new THREE.Vector3();
      for (const tile of stream.tiles.values()) {
        offset.set(tile.x * stream.tileWidth, 0, tile.z * stream.tileDepth);
        for (const base of stream.baseColliders) {
          const collider = base.clone().translate(offset);
          addSpatialCollider(spatialColliders, collider);
          indexedColliderCount += 1;
        }
      }
      groundHeightCache.clear();
    };

    const mountStreamedTile = (stream: DistrictStream, x: number, z: number) => {
      const key = tileKey(x, z);
      if (stream.tiles.has(key)) return;
      const isOrigin = x === 0 && z === 0;
      const root = isOrigin ? stream.template : stream.template.clone(true);
      root.position.set(
        stream.template.position.x + x * stream.tileWidth,
        stream.template.position.y,
        stream.template.position.z + z * stream.tileDepth,
      );
      scene.add(root);

      const anchorProxy = stream.anchorTemplate
        ? (isOrigin ? stream.anchorTemplate : stream.anchorTemplate.clone())
        : null;
      if (anchorProxy) {
        anchorProxy.position.set(x * stream.tileWidth, 0, z * stream.tileDepth);
        scene.add(anchorProxy);
        anchorTargets.add(anchorProxy);
        anchorTargetList = [...anchorTargets];
      }

      const walkables = tileWalkables(root);
      for (const surface of walkables) walkableSurfaces.add(surface);
      walkableSurfaceList = [...walkableSurfaces];
      stream.tiles.set(key, { root, anchorProxy, walkables, x, z });
    };

    const unmountStreamedTile = (stream: DistrictStream, tile: StreamedTile) => {
      scene.remove(tile.root);
      for (const surface of tile.walkables) walkableSurfaces.delete(surface);
      if (tile.anchorProxy) {
        scene.remove(tile.anchorProxy);
        anchorTargets.delete(tile.anchorProxy);
        anchorTargetList = [...anchorTargets];
      }
      stream.tiles.delete(tileKey(tile.x, tile.z));
      walkableSurfaceList = [...walkableSurfaces];
    };

    const updateWorldStreaming = (district: DistrictId, position: THREE.Vector3) => {
      const stream = districtStreams.get(district);
      if (!stream) return;
      const config = getDistrict(district);
      const centerX = Math.round((position.x - config.position[0]) / stream.tileWidth);
      const centerZ = Math.round((position.z - config.position[2]) / stream.tileDepth);
      const desired = new Set<string>([tileKey(centerX, centerZ)]);
      const localX = position.x - config.position[0] - centerX * stream.tileWidth;
      const localZ = position.z - config.position[2] - centerZ * stream.tileDepth;
      const edgeX = Math.abs(localX) > stream.tileWidth * .3 ? Math.sign(localX) : 0;
      const edgeZ = Math.abs(localZ) > stream.tileDepth * .3 ? Math.sign(localZ) : 0;
      if (edgeX) desired.add(tileKey(centerX + edgeX, centerZ));
      if (edgeZ) desired.add(tileKey(centerX, centerZ + edgeZ));
      if (edgeX && edgeZ) desired.add(tileKey(centerX + edgeX, centerZ + edgeZ));

      let changed = false;
      for (const tile of Array.from(stream.tiles.values())) {
        if (desired.has(tileKey(tile.x, tile.z))) continue;
        unmountStreamedTile(stream, tile);
        changed = true;
      }

      // Add only two shared-geometry tiles per frame. At the center of a map
      // only one tile exists; neighbors are prefetched just before an edge and
      // distant tiles are removed. This keeps the 96 MB city scan playable.
      let mounted = 0;
      for (const key of desired) {
        if (stream.tiles.has(key) || mounted >= 2) continue;
        const [x, z] = key.split(':').map(Number);
        mountStreamedTile(stream, x, z);
        mounted += 1;
        changed = true;
      }
      if (changed) rebuildStreamedCollision(stream);
      stream.centerX = centerX;
      stream.centerZ = centerZ;
      renderer.domElement.dataset.streamCenter = `${centerX}:${centerZ}`;
      renderer.domElement.dataset.streamedTileCount = String(stream.tiles.size);
    };

    const loadDistrict = (config: DistrictConfig, report = true) => {
      const existing = districtPromises.get(config.id);
      if (existing) return existing;
      let modelPromise = districtModelPromises.get(config.model);
      if (!modelPromise) modelPromise = (async () => {
        if (report) callbacksRef.current.onStatus(`Opening route to ${config.name}`, loadedDistricts.size ? 84 : 28);
        const gltf = await loadModel<{ scene: THREE.Group }>(config.model, config.name, loadedDistricts.size ? 84 : 28, loadedDistricts.size ? 98 : 78, report);
        if (disposed) throw new Error('Game disposed');
        const model = gltf.scene;
        // The City Night environment ships with a sample rigged Spider-Man.
        // It is scenery, not the selected playable avatar, so remove it before
        // bounds, collision, and material preparation are calculated.
        if (config.id === 'city-night') {
          const embeddedCharacters: THREE.SkinnedMesh[] = [];
          model.traverse((object) => {
            if (object instanceof THREE.SkinnedMesh) embeddedCharacters.push(object);
          });
          for (const character of embeddedCharacters) character.parent?.remove(character);
        }
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          const materialNames = materials.map((material) => material.name).join(' ');
          const sourceBox = new THREE.Box3().setFromObject(object);
          object.userData.walkableStreetSurface = config.id === 'new-york-city'
            && sourceBox.max.y < (config.sourceGroundY ?? 0) + 1.5
            && /citygen_streets|side_walks|citygen_curb|citygen_grass/i.test(materialNames);
        });
        prepareMaterials(model, renderer, 'baked');
        model.updateWorldMatrix(true, true);
        let box = new THREE.Box3().setFromObject(model);
        const sourceSize = box.getSize(new THREE.Vector3());
        const horizontal = Math.max(sourceSize.x, sourceSize.z, .001);
        const modelScale = config.targetWidth / horizontal;
        model.scale.setScalar(modelScale);
        model.updateWorldMatrix(true, true);
        box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        // Align each asset's authored road plane. Bounding-box minima often belong
        // to basements/scan debris and were the source of the underground starts.
        model.position.set(-center.x, -config.sourceGroundY * modelScale, -center.z);
        const root = new THREE.Group();
        root.name = `District: ${config.name}`;
        root.position.set(...config.position);
        root.rotation.y = config.rotation ?? 0;
        root.add(model);
        scene.add(root);
        root.updateWorldMatrix(true, true);
        const landmarkBoxes = config.id === 'new-york-buildings'
          ? distributeLandmarks(model, root)
          : [new THREE.Box3().setFromObject(model)];
        const landmarkBounds = landmarkBoxes.reduce(
          (combined, bounds) => combined.union(bounds),
          new THREE.Box3().makeEmpty(),
        );
        districtBounds.set(config.id, landmarkBounds.clone());
        model.traverse((object) => {
          if (object.userData.walkableStreetSurface) walkableSurfaces.add(object);
        });
        const authoredFloorExtent = config.id === 'new-york-buildings' ? 560 : 0;
        walkableSurfaces.add(addAuthoredMapFloor(
          root,
          Math.max(size.x, authoredFloorExtent),
          Math.max(size.z, authoredFloorExtent),
          config.name,
        ));
        walkableSurfaceList = [...walkableSurfaces];
        const baseColliders: THREE.Box3[] = [];
        let anchorTemplate: THREE.Object3D | null = null;
        let detailedColliderCount = 0;
        const usesCollisionMetadata = Boolean(config.collisionData && config.id !== 'new-york-buildings');
        if (config.collisionData && usesCollisionMetadata) {
          const response = await fetch(config.collisionData);
          if (!response.ok) throw new Error(`Collision data unavailable: ${response.status}`);
          const metadata = await response.json() as CollisionMetadata;
          const collisionScale = config.targetWidth / metadata.sourceWidth;
          const proxyGeometry = new THREE.BoxGeometry(1, 1, 1);
          const proxyMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
          proxyMaterial.colorWrite = false;
          const proxy = new THREE.InstancedMesh(proxyGeometry, proxyMaterial, metadata.colliders.length);
          proxy.name = `${config.name} collision and web anchors`;
          const matrix = new THREE.Matrix4();
          const center = new THREE.Vector3();
          const colliderSize = new THREE.Vector3();
          let proxyIndex = 0;
          for (const sourceCollider of metadata.colliders) {
            const collider = transformSourceCollider(sourceCollider, collisionScale, model.position, config);
            // Ground slabs and shallow curbs belong to the walkable plane, not
            // the building solver. Treating them as walls traps the avatar and
            // causes the repeated correction/sticking failure seen on imports.
            if (collider.max.y <= GROUND_Y + .75) continue;
            addSpatialCollider(spatialColliders, collider);
            baseColliders.push(collider);
            collider.getCenter(center);
            collider.getSize(colliderSize);
            matrix.compose(center, new THREE.Quaternion(), colliderSize);
            proxy.setMatrixAt(proxyIndex, matrix);
            proxyIndex += 1;
            indexedColliderCount += 1;
            detailedColliderCount += 1;
          }
          proxy.count = proxyIndex;
          proxy.instanceMatrix.needsUpdate = true;
          proxy.frustumCulled = false;
          scene.add(proxy);
          anchorTargets.add(proxy);
          anchorTargetList = [...anchorTargets];
          anchorTemplate = proxy;
        }
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const positionCount = object.geometry.getAttribute('position')?.count ?? 0;
          if (!usesCollisionMetadata && positionCount > 0 && positionCount < 180_000) anchorTargets.add(object);
          if (usesCollisionMetadata) return;
          if (positionCount <= 0 || positionCount >= 180_000) return;
          const meshBox = new THREE.Box3().setFromObject(object);
          const meshSize = meshBox.getSize(new THREE.Vector3());
          const isSolidBuildingPart = meshSize.y > 2.4
            && meshSize.x > 1
            && meshSize.z > 1
            && meshSize.x < config.targetWidth * .72
            && meshSize.z < config.targetWidth * .72;
          if (!isSolidBuildingPart) return;
          worldColliders.push(meshBox);
          baseColliders.push(meshBox);
          detailedColliderCount += 1;
        });
        const landmarkColliderCount = detailedColliderCount;
        let proceduralExtent = 0;
        if (config.id === 'new-york-buildings') {
          const procedural = addProceduralSwingDistrict(root, config, landmarkBoxes);
          proceduralExtent = procedural.extent;
          for (const collider of procedural.colliders) {
            addSpatialCollider(spatialColliders, collider);
            baseColliders.push(collider);
            indexedColliderCount += 1;
            detailedColliderCount += 1;
          }

          const proceduralAnchors = createColliderAnchorProxy(
            baseColliders,
            `${config.name} landmark facades and clickable rooftops`,
          );
          if (anchorTemplate) {
            anchorTargets.delete(anchorTemplate);
            const combinedAnchors = new THREE.Group();
            combinedAnchors.name = `${config.name} complete web anchor field`;
            combinedAnchors.add(anchorTemplate, proceduralAnchors);
            scene.add(combinedAnchors);
            anchorTargets.add(combinedAnchors);
            anchorTemplate = combinedAnchors;
          } else {
            scene.add(proceduralAnchors);
            anchorTargets.add(proceduralAnchors);
            anchorTemplate = proceduralAnchors;
          }
          renderer.domElement.dataset.proceduralBuildingCount = String(procedural.buildingCount);
          renderer.domElement.dataset.clickableRooftopCount = String(procedural.buildingCount);
          renderer.domElement.dataset.landmarkColliderCount = String(landmarkColliderCount);
        }
        districtBounds.set(config.id, new THREE.Box3().setFromObject(root));
        const rotatedWidth = Math.max(
          proceduralExtent,
          Math.abs(Math.cos(root.rotation.y)) * size.x + Math.abs(Math.sin(root.rotation.y)) * size.z,
        );
        const rotatedDepth = Math.max(
          proceduralExtent,
          Math.abs(Math.sin(root.rotation.y)) * size.x + Math.abs(Math.cos(root.rotation.y)) * size.z,
        );
        const hasElevatedRooftop = baseColliders.some((collider) => {
          const footprint = collider.getSize(new THREE.Vector3());
          return collider.max.y > GROUND_Y + 4 && footprint.x > 1.2 && footprint.z > 1.2;
        });
        if (detailedColliderCount < 4 || !hasElevatedRooftop) {
          const beforeFallback = worldColliders.length;
          addLandmarkColliders(scene, worldColliders, anchorTargets, config, rotatedWidth, rotatedDepth, size.y);
          baseColliders.push(...worldColliders.slice(beforeFallback));
        }
        const finalDistrictBounds = districtBounds.get(config.id) ?? new THREE.Box3().setFromObject(root);
        const rooftopSpawn = chooseRooftopSpawn(config, baseColliders, finalDistrictBounds);
        districtRooftopSpawns.set(config.id, rooftopSpawn);
        if (config.id === currentDistrict) {
          renderer.domElement.dataset.spawnMode = 'central-rooftop';
          renderer.domElement.dataset.rooftopSpawn = rooftopSpawn.toArray().map((value) => value.toFixed(2)).join(',');
        }
        anchorTargetList = [...anchorTargets];
        const baseWalkables = tileWalkables(root);
        districtStreams.set(config.id, {
          template: root,
          anchorTemplate,
          baseColliders,
          // Leave a narrow street-width seam between repeated imports. Several
          // source scans have facade collision right on their bounds; abutting
          // those bounds exactly makes the expanded player capsule overlap two
          // tiles at once. The authored floor overhang bridges this seam.
          tileWidth: Math.max(8, rotatedWidth + 8),
          tileDepth: Math.max(8, rotatedDepth + 8),
          tiles: new Map([[tileKey(0, 0), { root, anchorProxy: anchorTemplate, walkables: baseWalkables, x: 0, z: 0 }]]),
          centerX: 0,
          centerZ: 0,
        });
        updateWorldStreaming(config.id, rooftopSpawn);
        return root;
      })();
      districtModelPromises.set(config.model, modelPromise);
      const promise = modelPromise.then((root) => {
        loadedDistricts.add(config.id);
        notifyLoaded();
        if (report && config.id === currentDistrict) callbacksRef.current.onStatus(`${config.name} online`, 100);
        return root;
      }).catch((error) => {
        districtPromises.delete(config.id);
        if (districtModelPromises.get(config.model) === modelPromise) districtModelPromises.delete(config.model);
        console.error(`[city] unable to stream ${config.name}`, error);
        if (report) callbacksRef.current.onStatus(`${config.name} unavailable — connected street grid remains active`, 100);
        throw error;
      });
      districtPromises.set(config.id, promise);
      return promise;
    };

    const loadAvatar = async () => {
      const suit = getSuit(props.suitId);
      callbacksRef.current.onStatus(`Syncing ${suit.name} rig`, 4);
      const gltf = await loadModel<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>(suit.model, `${suit.name} suit`, 4, 42);
      if (disposed) return;
      prepareMaterials(gltf.scene, renderer, 'character');
      normalizeSuit(gltf.scene, suit, 2.05);
      const root = new THREE.Group();
      root.name = `Player: ${suit.name}`;
      root.add(gltf.scene);
      root.position.copy(player.position);
      scene.add(root);

      let clips = poseOnlyClips(gltf.animations);
      if (suit.id === 'ps4') {
        callbacksRef.current.onStatus('Calibrating PS4 animation rig', 43);
        const library = await loadModel<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>(
          '/assets/suits/advanced.glb', 'PS4 animation library', 43, 58, false,
        );
        clips = retargetMixamoClips(library.animations, library.scene, gltf.scene);
      }
      const mixer = clips.length ? new THREE.AnimationMixer(gltf.scene) : null;
      const actions = new Map<string, THREE.AnimationAction>();
      if (mixer) {
        for (const clip of clips) {
          const key = clip.name.toLowerCase();
          if (!actions.has(key)) actions.set(key, mixer.clipAction(clip));
        }
      }
      const repulsors: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] = [];
      if (suit.traversal === 'ironman') {
        const repulsorGeometry = new THREE.SphereGeometry(.085, 10, 8);
        for (const [x, y, z] of [[-.52, 1.02, .02], [.52, 1.02, .02], [-.18, .08, .04], [.18, .08, .04]] as const) {
          const material = new THREE.MeshBasicMaterial({ color: '#bff8ff', transparent: true, opacity: .45 });
          const glow = new THREE.Mesh(repulsorGeometry, material);
          glow.position.set(x, y, z);
          glow.visible = false;
          root.add(glow);
          repulsors.push(glow);
        }
        const repulsorLight = new THREE.PointLight('#73e7ff', 0, 9, 2);
        repulsorLight.position.set(0, .7, .3);
        repulsorLight.name = 'Iron Man repulsor light';
        root.add(repulsorLight);
      }
      avatar = { root, model: gltf.scene, mixer, actions, activeAction: '', bones: collectRigBones(gltf.scene), repulsors };
      renderer.domElement.dataset.suit = suit.id;
      renderer.domElement.dataset.animationClips = [...actions.keys()].join('|');
      renderer.domElement.dataset.rigRoles = [...new Set(avatar.bones.map((entry) => entry.role))].join('|');
      console.info('[avatar] ready', { suit: suit.id, clips: [...actions.keys()], bones: avatar.bones.map((entry) => entry.role) });
    };

    const resolveAction = (state: ProceduralPose) => {
      if (!avatar?.mixer) return '';
      const candidates = state === 'idle' || state === 'hover'
        ? ['stand', 'idle', 'animation']
        : state === 'run' || state === 'wall' || state === 'crawl'
          ? ['run', 'bully walking', 'crouched walking', 'walk']
          : state === 'jump' || state === 'dive'
            ? ['jumpup', 'jump', 'brace drop', 'flying knee']
            : ['hanging', 'swingstart', 'swing to land', 'swing'];
      for (const candidate of candidates) {
        const key = [...avatar.actions.keys()].find((name) => name.includes(candidate));
        if (key) return key;
      }
      return '';
    };

    const setAnimation = (state: ProceduralPose) => {
      if (!avatar) return false;
      const key = resolveAction(state);
      if (!key) {
        avatar.actions.get(avatar.activeAction)?.fadeOut(.12);
        avatar.activeAction = '';
        return false;
      }
      if (key !== avatar.activeAction) {
        avatar.actions.get(avatar.activeAction)?.fadeOut(.16);
        avatar.actions.get(key)?.reset().fadeIn(.16).play();
        avatar.activeAction = key;
      }
      return true;
    };

    const readPointer = (event: PointerEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointerNdc.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      if (event.pressure > 0) pointerPressure = clamp(event.pressure, .15, 1);
    };

    const collectAnchorCandidates = (ndc: THREE.Vector2) => {
      const candidates: WebAnchorCandidate[] = [];
      const samples = [ndc, new THREE.Vector2(ndc.x - .11, ndc.y + .05), new THREE.Vector2(ndc.x + .11, ndc.y + .05)];
      const localFacades = nearbyColliders(traversal.position, 180);
      for (let index = 0; index < samples.length; index += 1) {
        raycaster.setFromCamera(samples[index], camera);
        // Preserve the actual pointed-at surface for web zips, including roofs
        // below a tallest-building spawn. Swing selection applies its own
        // height rule later, so this does not create downward swing anchors.
        const meshHit = raycaster.intersectObjects(anchorTargetList, true).find((item) => item.distance > 5 && item.distance < 170);
        let point = meshHit?.point;
        if (!point) {
          let nearestDistance = Infinity;
          for (const collider of localFacades) {
            const facadeBounds = new THREE.Box3(
              new THREE.Vector3(collider.min.x, collider.min.y, collider.min.z),
              new THREE.Vector3(collider.max.x, collider.max.y, collider.max.z),
            );
            const collisionPoint = raycaster.ray.intersectBox(facadeBounds, new THREE.Vector3());
            if (!collisionPoint) continue;
            const distance = collisionPoint.distanceTo(camera.position);
            if (distance > 5 && distance < 170 && distance < nearestDistance) {
              nearestDistance = distance;
              point = collisionPoint.clone();
            }
          }
        }
        if (!point) {
          let bestAlignment = .42;
          const playerPoint = new THREE.Vector3(traversal.position.x, traversal.position.y, traversal.position.z);
          for (const collider of localFacades) {
            if (collider.max.y <= traversal.position.y + 4) continue;
            const surfacePoint = collider.clampPoint(playerPoint, new THREE.Vector3());
            surfacePoint.y = clamp(
              traversal.position.y + Math.min(18, Math.max(6, (collider.max.y - traversal.position.y) * .58)),
              collider.min.y + .4,
              collider.max.y - .4,
            );
            const offset = surfacePoint.clone().sub(camera.position);
            const distance = offset.length();
            if (distance <= 5 || distance >= 170) continue;
            const alignment = raycaster.ray.direction.dot(offset.normalize()) - Math.abs(distance - 42) * .0015;
            if (alignment > bestAlignment) {
              bestAlignment = alignment;
              point = surfacePoint;
            }
          }
        }
        if (!point) continue;
        const hitIsRoof = Boolean(meshHit?.face && meshHit.face.normal.y > .65);
        candidates.push({
          id: meshHit ? `${meshHit.object.uuid}:${meshHit.instanceId ?? 'mesh'}` : `facade:${point.x.toFixed(1)}:${point.z.toFixed(1)}`,
          point: { x: point.x, y: point.y, z: point.z },
          kind: hitIsRoof ? 'roof' : point.y > traversal.position.y + 20 ? 'facade' : 'ledge',
          lineOfSight: true,
          weight: index === 0 ? 1.2 : .86,
        });
      }
      renderer.domElement.dataset.lastAnchorCandidateCount = String(candidates.length);
      renderer.domElement.dataset.lastAnchorCandidate = candidates[0]
        ? [candidates[0].point.x, candidates[0].point.y, candidates[0].point.z].map((value) => value.toFixed(2)).join(',')
        : '';
      return candidates;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      renderer.domElement.focus({ preventScroll: true });
      readPointer(event);
      if (getSuit(props.suitId).traversal === 'spider' && traversal.zip) {
        traversal.zip = null;
        pointerZipActive = false;
      }
      pointerHeld = true;
      pointerPressed = true;
      pointerReleased = false;
      pointerDownAt = performance.now();
    };
    const onPointerMove = (event: PointerEvent) => { if (pointerHeld) readPointer(event); };
    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return;
      readPointer(event);
      const quickClick = performance.now() - pointerDownAt < 240;
      pointerHeld = false;
      if (quickClick && getSuit(props.suitId).traversal === 'spider') {
        // A tap is a committed web grapple. Keep the exact pointer aim alive
        // after pointer-up and keep the zip held internally until arrival.
        pointerZipActive = true;
        zipPressed = true;
        zipReleased = false;
        pointerReleased = Boolean(traversal.swing);
      } else {
        pointerReleased = true;
      }
      pointerPressure = .55;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const firstPress = !keys.has(event.code);
      keys.add(event.code);
      if (['Space', 'KeyE', 'KeyF', 'ShiftLeft', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
      if (event.code === 'Space' && firstPress) { jumpPressed = true; spacePressedAt = elapsedTime; }
      if (event.code === 'KeyE' && firstPress) { zipPressed = true; zipReleased = false; }
      if (event.code === 'KeyF' && firstPress) hoverTogglePressed = true;
      if (event.code === 'KeyE' && firstPress) cruiseTogglePressed = true;
      if (process.env.NODE_ENV !== 'production' && event.code === 'KeyT' && firstPress) {
        const stream = districtStreams.get(currentDistrict);
        if (stream) {
          // Jump to the same verified street spawn in the neighboring tile.
          // This exercises a partition crossing without teleporting into an
          // arbitrary facade.
          const home = safeSpawn(getDistrict(currentDistrict));
          const nextTileX = Math.round((player.position.x - home.x) / stream.tileWidth) + 1;
          player.position.set(home.x + nextTileX * stream.tileWidth, home.y, home.z);
          player.velocity.set(0, 0, 0);
          setTraversalKinematics(traversal, player.position, player.velocity);
          renderer.domElement.dataset.streamDebugJump = 'completed';
        }
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.delete(event.code);
      if (event.code === 'KeyE') zipReleased = true;
    };
    const clearKeys = () => {
      keys.clear();
      pointerHeld = false;
      pointerReleased = true;
      pointerZipActive = false;
      zipReleased = true;
      hoverTogglePressed = false;
      cruiseTogglePressed = false;
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearKeys);

    travelRef.current = (id: DistrictId) => {
      const district = getDistrict(id);
      void loadDistrict(district).then(() => {
        if (disposed) return;
        currentDistrict = id;
        cameraYaw = district.spawnYaw ?? 0;
        cameraPitch = district.spawnPitch ?? .08;
        player.position.copy(safeSpawn(district));
        player.velocity.set(0, 0, 0);
        player.grounded = true;
        setTraversalKinematics(traversal, player.position, player.velocity);
        traversal.grounded = true;
        traversal.mode = 'idle';
        traversal.swing = null;
        traversal.zip = null;
        traversal.wall = null;
        wallCameraBlend = 0;
        camera.up.set(0, 1, 0);
        const travelOffset = new THREE.Vector3(Math.sin(cameraYaw) * 10, 4.4, Math.cos(cameraYaw) * 10);
        camera.position.copy(player.position).add(travelOffset);
        camera.lookAt(player.position.clone().add(new THREE.Vector3(0, 1.4, 0)));
        renderer.domElement.dataset.spawnMode = 'central-rooftop';
        renderer.domElement.dataset.rooftopSpawn = player.position.toArray().map((value) => value.toFixed(2)).join(',');
        clearRemoteAvatars();
        onlinePeerCount = 0;
        if (multiplayer) void multiplayer.join(id, props.suitId);
        callbacksRef.current.onDistrictChange(id);
        callbacksRef.current.onStatus(`${district.name} ready`, 100);
      }).catch(() => undefined);
    };

    const updateAvatar = (delta: number, elapsed: number, context: TraversalContext) => {
      if (!avatar) return;
      avatar.mixer?.update(delta);
      avatar.root.position.copy(player.position);
      avatar.root.rotation.y = damp(avatar.root.rotation.y, context.animation.bodyYaw, 13, delta);
      avatar.root.rotation.z = damp(avatar.root.rotation.z, context.animation.bodyRoll, 8, delta);
      const activeSuit = getSuit(props.suitId);
      const isIronMan = activeSuit.traversal === 'ironman';
      const ironPitch = ironFlightMode === 'cruise' ? -.72 : ironFlightMode === 'freefall' ? context.animation.bodyPitch : 0;
      avatar.root.rotation.x = damp(avatar.root.rotation.x, isIronMan ? ironPitch : context.animation.bodyPitch, 8, delta);
      const mode = context.animation.state;
      const pose: ProceduralPose = isIronMan
        ? ironFlightMode === 'cruise' ? 'fly'
          : ironFlightMode === 'hover' ? 'hover'
            : mode === 'run' ? 'run'
              : player.grounded ? 'idle' : 'jump'
        : mode === 'swing' ? 'swing'
          : mode === 'webZip' || mode === 'pointLaunch' ? 'zip'
            : mode === 'wallRun' ? 'wall'
              : mode === 'wallCrawl' ? 'crawl'
                : mode === 'dive' ? 'dive'
                  : mode === 'run' ? 'run'
                    : mode === 'idle' || mode === 'land' || mode === 'perch' ? 'idle' : 'jump';
      renderer.domElement.dataset.animationState = mode;
      if (!setAnimation(pose)) animateRigBones(avatar.bones, pose, elapsed, delta, activeSuit.rigPreset);
      const repulsorActive = isIronMan && (ironFlightMode === 'hover' || ironFlightMode === 'cruise');
      for (const glow of avatar.repulsors) {
        glow.visible = repulsorActive;
        glow.material.opacity = repulsorActive ? .62 + Math.sin(elapsed * 28) * .22 : 0;
        glow.scale.setScalar(1 + context.speed * .012);
      }
      const light = avatar.root.getObjectByName('Iron Man repulsor light') as THREE.PointLight | undefined;
      if (light) light.intensity = repulsorActive ? 5 + context.speed * .08 : 0;
      renderer.domElement.dataset.ironFlightMode = isIronMan ? ironFlightMode : '';
    };

    const tick = (timestamp = performance.now()) => {
      if (disposed) return;
      frameId = requestAnimationFrame(tick);
      const delta = Math.min(Math.max((timestamp - lastFrameTime) / 1000, 0), .034);
      lastFrameTime = timestamp;
      elapsedTime += delta;
      atmosphere.update(elapsedTime);
      if (!ready) { renderer.render(scene, camera); return; }
      if (keys.has('ArrowLeft')) cameraYaw += 1.5 * delta;
      if (keys.has('ArrowRight')) cameraYaw -= 1.5 * delta;
      if (keys.has('ArrowUp')) cameraPitch = clamp(cameraPitch + 1.05 * delta, -.18, .58);
      if (keys.has('ArrowDown')) cameraPitch = clamp(cameraPitch - 1.05 * delta, -.18, .58);
      const forward = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
      const right = new THREE.Vector3(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
      const wish = new THREE.Vector3();
      if (keys.has('KeyW')) wish.add(forward);
      if (keys.has('KeyS')) wish.sub(forward);
      if (keys.has('KeyD')) wish.add(right);
      if (keys.has('KeyA')) wish.sub(right);
      if (wish.lengthSq() > 0) wish.normalize();
      const hero = getSuit(props.suitId);
      const cameraAim = new THREE.Vector3(forward.x, Math.sin(cameraPitch) + .18, forward.z).normalize();
      const keyboardSwingHeld = hero.traversal === 'spider' && keys.has('Space') && !traversal.grounded && elapsedTime - spacePressedAt > .12;
      const pointerSwingHeld = pointerHeld && performance.now() - pointerDownAt >= 240;
      const swingHeld = hero.traversal === 'spider' && (pointerSwingHeld || keyboardSwingHeld);
      const targetNdc = pointerHeld || pointerPressed || pointerZipActive ? pointerNdc : new THREE.Vector2(0, .08);
      const needsAnchor = hero.traversal === 'spider' && (swingHeld || zipPressed || keys.has('KeyE'));
      const anchorCandidates = needsAnchor ? collectAnchorCandidates(targetNdc) : [];

      if (hero.traversal === 'ironman') {
        traversal.swing = null;
        traversal.zip = null;
        if (hoverTogglePressed) {
          ironFlightMode = ironFlightMode === 'hover' || ironFlightMode === 'cruise' ? 'freefall' : 'hover';
          if (ironFlightMode === 'hover') {
            if (traversal.grounded) traversal.velocity.y = Math.max(traversal.velocity.y, 8);
            traversal.grounded = false;
          }
        }
        if (cruiseTogglePressed || pointerPressed) {
          ironFlightMode = ironFlightMode === 'cruise' ? 'freefall' : 'cruise';
          if (ironFlightMode === 'cruise') traversal.grounded = false;
        }
        if (keys.has('Space')) {
          ironFlightMode = 'hover';
          traversal.grounded = false;
          traversal.velocity.y = damp(traversal.velocity.y, 18, 6, delta);
        } else if (keys.has('ShiftLeft')) {
          ironFlightMode = 'hover';
          traversal.grounded = false;
          traversal.velocity.y = damp(traversal.velocity.y, -13, 6, delta);
        } else if (ironFlightMode === 'hover') {
          traversal.grounded = false;
          traversal.velocity.y = damp(traversal.velocity.y, 0, 8, delta);
        }

        if (ironFlightMode === 'cruise') {
          traversal.grounded = false;
          const cruiseSpeed = pointerHeld ? 72 : 52;
          traversal.velocity.x = damp(traversal.velocity.x, cameraAim.x * cruiseSpeed, 4.8, delta);
          traversal.velocity.y = damp(traversal.velocity.y, cameraAim.y * cruiseSpeed, 4.8, delta);
          traversal.velocity.z = damp(traversal.velocity.z, cameraAim.z * cruiseSpeed, 4.8, delta);
        } else if (!traversal.grounded && ironFlightMode !== 'hover') {
          ironFlightMode = 'freefall';
        }
      }

      updateWorldStreaming(currentDistrict, player.position);
      const activeColliders = nearbyColliders(player.position, Math.max(42, player.velocity.length() * .12));
      const ironPowered = hero.traversal === 'ironman' && (ironFlightMode === 'hover' || ironFlightMode === 'cruise');
      const localGroundY = groundYAt(traversal.position);

      const traversalOverrides = hero.traversal === 'ironman' ? {
        gravity: ironPowered ? .8 : 29,
        groundAcceleration: 40,
        airAcceleration: ironPowered ? 30 : 10,
        runSpeed: 11,
        maximumSpeed: 92,
      } : pointerZipActive ? {
        // A click grapple is the traversal equivalent of Spider-Man's web
        // zip: a brief, decisive pull rather than another rope-swing state.
        zipAcceleration: 190,
        zipDamping: 2.35,
        zipMaximumSpeed: 88,
        maximumSpeed: 94,
      } : {
        zipAcceleration: 126,
        zipDamping: 3.6,
        zipMaximumSpeed: 66,
      };
      const result = stepTraversalInPlace(traversal, {
        move: wish,
        cameraForward: forward,
        aimDirection: cameraAim,
        jumpPressed: hero.traversal === 'spider' && jumpPressed,
        jumpHeld: keys.has('Space'),
        swingPressed: hero.traversal === 'spider' && (pointerSwingHeld || keyboardSwingHeld),
        swingHeld,
        swingReleased: hero.traversal === 'spider' && pointerReleased,
        zipPressed: hero.traversal === 'spider' && zipPressed,
        zipHeld: hero.traversal === 'spider' && (pointerZipActive || keys.has('KeyE')),
        zipReleased: hero.traversal === 'spider' && zipReleased && !pointerZipActive,
        diveHeld: hero.traversal === 'spider' && keys.has('ShiftLeft'),
        wallCrawlHeld: hero.traversal === 'spider' && keys.has('KeyQ'),
        wallClimb: keys.has('KeyW') ? 1 : keys.has('KeyS') ? -1 : 0,
        pointerPressure,
        reel: swingHeld && keys.has('KeyW') ? -1 : keys.has('KeyS') ? 1 : 0,
      }, {
        groundY: localGroundY,
        colliders: activeColliders,
        anchorCandidates,
        zipTargets: anchorCandidates,
      }, delta, traversalOverrides);

      if (enforceBuildingSolidity(traversal.position, traversal.velocity, activeColliders)) {
        buildingCorrectionCount += 1;
        renderer.domElement.dataset.buildingCorrectionCount = String(buildingCorrectionCount);
      }

      player.position.set(traversal.position.x, traversal.position.y, traversal.position.z);
      player.velocity.set(traversal.velocity.x, traversal.velocity.y, traversal.velocity.z);
      player.grounded = traversal.grounded;
      if (hero.traversal === 'ironman' && player.grounded && ironFlightMode === 'freefall') ironFlightMode = 'grounded';
      player.facing = result.context.animation.bodyYaw;
      for (const traversalEvent of result.events) {
        if (traversalEvent.type === 'web-attached' && traversal.swing) {
          const anchor = traversal.swing.anchor;
          renderer.domElement.dataset.lastSwingAnchor = [anchor.x, anchor.y, anchor.z].map((value) => value.toFixed(2)).join(',');
          renderer.domElement.dataset.lastSwingSource = pointerHeld ? 'pointer' : 'space';
        }
        if (traversalEvent.type === 'zip-started' && traversal.zip) {
          grappleLineUntil = elapsedTime + (pointerZipActive ? .16 : .28);
          renderer.domElement.dataset.lastGrappleTarget = [traversal.zip.target.x, traversal.zip.target.y, traversal.zip.target.z]
            .map((value) => value.toFixed(2)).join(',');
          renderer.domElement.dataset.lastGrappleSource = pointerZipActive ? 'click' : 'keyboard';
        }
      }
      if (pointerZipActive && !traversal.zip) pointerZipActive = false;
      jumpPressed = false;
      zipPressed = false;
      zipReleased = false;
      pointerPressed = false;
      pointerReleased = false;
      hoverTogglePressed = false;
      cruiseTogglePressed = false;

      if (player.position.y < -20) {
        const home = getDistrict(currentDistrict);
        player.position.copy(safeSpawn(home));
        player.velocity.set(0, 0, 0);
        player.grounded = true;
        setTraversalKinematics(traversal, player.position, player.velocity);
        traversal.grounded = true;
        traversal.mode = 'idle';
        traversal.swing = null;
        traversal.zip = null;
        traversal.wall = null;
      }
      updateAvatar(delta, elapsedTime, result.context);
      updateRemoteAvatars(delta);
      if (multiplayer && elapsedTime - lastNetworkBroadcast >= .125) {
        lastNetworkBroadcast = elapsedTime;
        multiplayer.publish({
          suitId: props.suitId,
          position: [player.position.x, player.position.y, player.position.z],
          velocity: [player.velocity.x, player.velocity.y, player.velocity.z],
          yaw: player.facing,
          mode: result.context.animation.state,
          sequence: ++networkSequence,
          sentAt: Date.now(),
        });
      }

      const grappleLineVisible = Boolean(traversal.zip && elapsedTime < grappleLineUntil);
      webLine.visible = Boolean(traversal.swing || grappleLineVisible);
      if (traversal.swing || grappleLineVisible) {
        const hand = player.position.clone().add(new THREE.Vector3(0, 1.58, 0));
        const webTarget = traversal.swing?.anchor ?? traversal.zip?.target;
        if (webTarget) webPositions.set([hand.x, hand.y, hand.z, webTarget.x, webTarget.y, webTarget.z]);
        (webGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      }
      const speed = result.context.speed;
      const distance = result.context.camera.followDistance;
      const horizontalDistance = Math.cos(cameraPitch) * distance;
      const wallNormal = result.context.wallNormal
        ? new THREE.Vector3(result.context.wallNormal.x, result.context.wallNormal.y, result.context.wallNormal.z).normalize()
        : null;
      let wallTopClearance = Infinity;
      if (wallNormal) {
        for (const collider of activeColliders) {
          const nearX = player.position.x > collider.min.x - .75 && player.position.x < collider.max.x + .75;
          const nearZ = player.position.z > collider.min.z - .75 && player.position.z < collider.max.z + .75;
          if (!nearX || !nearZ || player.position.y < collider.min.y - .2 || player.position.y > collider.max.y + .2) continue;
          wallTopClearance = Math.min(wallTopClearance, collider.max.y - player.position.y);
        }
      }
      const wallCameraRequested = traversal.mode === 'wallCrawl'
        && keys.has('KeyQ')
        && Boolean(wallNormal)
        && wallTopClearance > 2.2;
      wallCameraBlend = damp(wallCameraBlend, wallCameraRequested ? 1 : 0, wallCameraRequested ? 5.5 : 11, delta);
      if (wallNormal) wallCameraNormal.lerp(wallNormal, 1 - Math.exp(-10 * delta)).normalize();
      const target = player.position.clone().add(new THREE.Vector3(
        result.context.camera.lookAhead.x * .28,
        1.35 + result.context.camera.lookAhead.y * .16,
        result.context.camera.lookAhead.z * .28,
      ));
      const shake = result.context.camera.shake;
      const desired = player.position.clone().add(new THREE.Vector3(
        Math.sin(cameraYaw) * horizontalDistance + Math.sin(elapsedTime * 31) * shake,
        result.context.camera.heightOffset + Math.sin(cameraPitch) * distance + Math.sin(elapsedTime * 27) * shake * .45,
        Math.cos(cameraYaw) * horizontalDistance,
      ));
      if (wallCameraBlend > .001) {
        const wallTarget = player.position.clone().add(new THREE.Vector3(0, 4.2, 0));
        const wallDesired = player.position.clone()
          .addScaledVector(wallCameraNormal, 2.4)
          .add(new THREE.Vector3(0, -5.4, 0));
        target.lerp(wallTarget, wallCameraBlend);
        desired.lerp(wallDesired, wallCameraBlend);
      }
      cameraAgainstWorld(target, desired, activeColliders);
      camera.position.lerp(desired, 1 - Math.exp(-8 * delta));
      camera.fov = damp(camera.fov, result.context.camera.fov, 7, delta);
      camera.updateProjectionMatrix();
      const chaseUp = new THREE.Vector3(Math.sin(result.context.camera.roll), Math.cos(result.context.camera.roll), 0).normalize();
      camera.up.copy(chaseUp).lerp(wallCameraNormal, wallCameraBlend).normalize();
      camera.lookAt(target);
      sun.position.set(player.position.x - 180, player.position.y + 360, player.position.z + 170);

      hudAccumulator += delta;
      fpsAccumulator += delta;
      fpsFrames += 1;
      if (fpsAccumulator > .7) {
        measuredFps = Math.round(fpsFrames / fpsAccumulator);
        fpsFrames = 0;
        fpsAccumulator = 0;
        if (!performanceScaled && elapsedTime > 4 && measuredFps < 46) {
          performanceScaled = true;
          renderer.shadowMap.enabled = false;
          renderer.setPixelRatio(Math.min(window.devicePixelRatio, .82));
          renderer.domElement.dataset.performanceMode = 'latency';
          resize();
        }
      }
      if (hudAccumulator > .15) {
        const groundY = groundYAt(player.position);
        callbacksRef.current.onHud({ speed: Math.round(speed * 7.4), altitude: Math.max(0, Math.round(player.position.y - groundY)), fps: measuredFps, swinging: Boolean(traversal.swing) });
        renderer.domElement.dataset.playerPosition = [player.position.x, player.position.y, player.position.z].map((value) => value.toFixed(2)).join(',');
        renderer.domElement.dataset.grounded = String(player.grounded);
        renderer.domElement.dataset.groundY = groundY.toFixed(3);
        renderer.domElement.dataset.walkableSurfaceCount = String(walkableSurfaces.size);
        renderer.domElement.dataset.traversalMode = traversal.mode;
        renderer.domElement.dataset.colliderCount = String(worldColliders.length + indexedColliderCount);
        renderer.domElement.dataset.anchorTargetCount = String(anchorTargets.size + indexedColliderCount);
        renderer.domElement.dataset.ropeLength = traversal.swing?.ropeLength.toFixed(2) ?? '';
        renderer.domElement.dataset.swingTension = traversal.swing?.tension.toFixed(2) ?? '';
        renderer.domElement.dataset.grappling = String(Boolean(pointerZipActive && traversal.zip));
        renderer.domElement.dataset.grappleLineVisible = String(grappleLineVisible);
        renderer.domElement.dataset.wallContact = traversal.wall ? `${traversal.wall.normal.x.toFixed(2)},${traversal.wall.normal.y.toFixed(2)},${traversal.wall.normal.z.toFixed(2)}` : '';
        renderer.domElement.dataset.wallCameraBlend = wallCameraBlend.toFixed(2);
        renderer.domElement.dataset.wallTopClearance = Number.isFinite(wallTopClearance) ? wallTopClearance.toFixed(2) : '';
        hudAccumulator = 0;
      }
      renderer.render(scene, camera);
    };

    const setup = async () => {
      try {
        callbacksRef.current.onStatus('Booting SpiderMan city', 2);
        camera.position.copy(initialSpawn).add(new THREE.Vector3(0, 3.68, 10));
        camera.lookAt(initialSpawn.x, 1.4, initialSpawn.z);
        tick();
        await Promise.all([loadAvatar(), loadDistrict(initialDistrict)]);
        if (disposed) return;
        player.position.copy(safeSpawn(initialDistrict));
        player.velocity.set(0, 0, 0);
        player.grounded = true;
        setTraversalKinematics(traversal, player.position, player.velocity);
        traversal.grounded = true;
        traversal.mode = 'idle';
        const setupOffset = new THREE.Vector3(Math.sin(cameraYaw) * 10, 4.4, Math.cos(cameraYaw) * 10);
        camera.position.copy(player.position).add(setupOffset);
        camera.up.set(0, 1, 0);
        camera.lookAt(player.position.clone().add(new THREE.Vector3(0, 1.4, 0)));
        ready = true;
        connectMultiplayer();
        callbacksRef.current.onDistrictChange(initialDistrict.id);
        callbacksRef.current.onStatus(`${initialDistrict.name} route online`, 100);
        callbacksRef.current.onReady();
      } catch (error) {
        console.error('[game] unable to start SpiderMan city', error);
        callbacksRef.current.onStatus('Connected street grid recovery mode', 100);
        ready = true;
        callbacksRef.current.onReady();
      }
    };
    void setup();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearKeys);
      void multiplayer?.dispose();
      clearRemoteAvatars();
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
      travelRef.current = () => undefined;
    };
  }, [props.districtId, props.suitId]);

  return <div ref={mountRef} className="game-mount" />;
});

export default SpiderGame;
