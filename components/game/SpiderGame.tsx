'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { getDistrict, getSuit, type DistrictConfig, type DistrictId, type SuitId } from '@/lib/game-config';
import { SpiderMultiplayer, type MultiplayerStatus, type NetworkPlayerState } from '@/lib/multiplayer';
import {
  createTraversalState,
  runTraversalPhysicsSelfTests,
  setTraversalKinematics,
  stepTraversalInPlace,
  refreshTraversalContext,
  type TraversalContext,
  type TraversalInput,
  type SurfaceContact,
  type WebAnchorCandidate,
} from '@/lib/traversal-physics';
import { applySuitRestPose, normalizeSuit, suitAnimationClips, prepareMaterials, retargetMixamoClips, type ProceduralPose } from '@/lib/three-assets';
import { AvatarAnimator } from '@/lib/avatar-animation';
import { WorldMeshQuery, capsuleSupportHeight, type MeshSurfaceHit } from '@/lib/mesh-world';
import { RepeatingMeshWorld } from '@/lib/repeating-mesh-world';
import { createSwingAssistanceState, stepSwingAssistance } from '@/lib/swing-assistance';
import { WallPose } from '@/lib/wall-pose';
import { findMantleTarget, probeWallFeet } from '@/lib/wall-surface';
import { updateIronFlight, type IronFlightMode } from '@/lib/ironman-flight';
import { IronManRepulsors } from '@/lib/ironman-repulsors';
import { wallCameraOffset } from '@/lib/wall-camera';
import { WebStrand, WEB_STRAND_MODEL } from '@/lib/web-strand';
import { createCinematicCameraState, stepCinematicCamera } from '@/lib/cinematic-camera';
import { stepWindTunnels, type WindTunnelField } from '@/lib/wind-tunnel';
import { calculateWallSkim } from '@/lib/wall-skim';
import { resolveSwingGroundContact } from '@/lib/swing-ground-contact';
import { findTrafficLanes, trafficPose, type TrafficLane } from '@/lib/city-traffic';
import { deterministicRaceNodes, deterministicTileId } from '@/lib/deterministic-world';
import {
  advanceSwingRace,
  courseTileKeys,
  createSwingRaceState,
  interpolateRaceSample,
  parseRaceBest,
  raceGuidanceLine,
  raceStorageKey,
  sampleRaceTrack,
  type RaceBest,
  type RaceSample,
} from '@/lib/swing-race';

export type RaceHud = {
  checkpoint: number;
  total: number;
  lap: number;
  elapsed: number;
  best: number | null;
  delta: number | null;
  distance: number;
  bearing: number;
  ghostActive: boolean;
  lastFinish: number | null;
};
export type GameHud = {
  speed: number;
  altitude: number;
  fps: number;
  swinging: boolean;
  boosting: boolean;
  wallSkimming: boolean;
  race: RaceHud | null;
};
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
  onSwingAttached: () => void;
};

type AvatarRig = {
  root: THREE.Group;
  model: THREE.Object3D;
  surfaceFrame: THREE.Group;
  wallPose: WallPose;
  animator: AvatarAnimator;
  repulsors: IronManRepulsors | null;
};

type RaceGhost = {
  root: THREE.Group;
  animator: AvatarAnimator;
};

type CollisionMetadata = {
  sourceWidth: number;
  sourceGroundY?: number;
  sourceBounds?: [number, number, number, number, number, number];
  colliders: [number, number, number, number, number, number][];
};

type RemoteAvatar = {
  root: THREE.Group;
  surfaceFrame: THREE.Group;
  wallPose: WallPose;
  animator: AvatarAnimator;
  repulsors: IronManRepulsors | null;
  velocity: THREE.Vector3;
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
  districtId: DistrictId;
  template: THREE.Group;
  anchorTemplate: THREE.Object3D | null;
  baseColliders: THREE.Box3[];
  tileWidth: number;
  tileDepth: number;
  tiles: Map<string, StreamedTile>;
  centerX: number;
  centerZ: number;
};

const networkPose = (mode: string): ProceduralPose => mode === 'iron-hover' ? 'hover'
  : mode === 'iron-cruise' || mode === 'iron-boost' ? 'fly'
  : mode === 'iron-freefall' ? 'fall'
  : mode === 'swing' ? 'swing'
  : mode === 'doubleJump' ? 'backflip'
  : mode === 'webZip' || mode === 'pointLaunch' ? 'zip'
    : mode === 'wallRun' ? 'run'
      : mode === 'wallCrawl' ? 'crawl'
        : mode === 'dive' ? 'dive'
          : mode === 'run' ? 'run'
            : mode === 'perch' ? 'perch'
              : mode === 'fall' ? 'fall'
                : mode === 'idle' || mode === 'land' ? 'idle' : 'jump';

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
const dampYaw = (from: number, to: number, lambda: number, delta: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * (1 - Math.exp(-lambda * delta));
const colliderCellKey = (x: number, z: number) => `${x}:${z}`;

const TRAFFIC_MODELS = [
  { url: '/assets/vehicles/dodge-car.glb', name: 'Dodge', color: '#77202d', detailDistance: 38 },
  { url: '/assets/vehicles/hennessey-venom.glb', name: 'Hennessey Venom', color: '#202830', detailDistance: 58 },
  { url: '/assets/vehicles/futuristic-car.glb', name: 'Futuristic Car', color: '#1e6077', detailDistance: 64 },
  { url: '/assets/vehicles/hoonicorn.glb', name: 'Hoonicorn', color: '#37383b', detailDistance: 38 },
  { url: '/assets/vehicles/vintage-car.glb', name: 'Vintage Car', color: '#69472e', detailDistance: 56, prune: /shadowplane|vintage_lantern/i },
] as const;

type TrafficSource = {
  config: typeof TRAFFIC_MODELS[number];
  root: THREE.Group;
  clips: THREE.AnimationClip[];
};

type TrafficVehicle = {
  root: THREE.Group;
  lane: TrafficLane;
  speed: number;
  offset: number;
  mixer: THREE.AnimationMixer | null;
  wheels: THREE.Object3D[];
};

function createCheckpointMarker() {
  const root = new THREE.Group();
  root.name = 'Swing race checkpoint';
  const rings = new THREE.Group();
  rings.name = 'Checkpoint gate plane';
  const material = new THREE.MeshBasicMaterial({ color: '#42e6ff', transparent: true, opacity: .86, depthWrite: false });
  const outer = new THREE.Mesh(new THREE.TorusGeometry(1, .075, 8, 40), material);
  const inner = new THREE.Mesh(new THREE.TorusGeometry(.8, .022, 6, 32), material.clone());
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(.018, .018, 15, 6),
    new THREE.MeshBasicMaterial({ color: '#56ebff', transparent: true, opacity: .35, depthWrite: false }),
  );
  beacon.position.y = 8;
  rings.add(outer, inner);
  root.add(rings, beacon);
  root.userData.rings = rings;
  root.userData.materials = [outer.material, inner.material, beacon.material];
  return root;
}

function setCheckpointActive(marker: THREE.Group, active: boolean) {
  marker.visible = active;
  for (const material of marker.userData.materials as THREE.MeshBasicMaterial[]) {
    material.opacity = active ? (material === marker.userData.materials[2] ? .35 : .9) : .12;
  }
}

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

function chooseRooftopSpawn(config: DistrictConfig, colliders: readonly THREE.Box3[], bounds: THREE.Box3, query: WorldMeshQuery) {
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
  const candidates = [...central.sort((a, b) => b.max.y - a.max.y), ...viable.filter((box) => !central.includes(box)).sort((a, b) => b.max.y - a.max.y)];
  const roof = query.findRoofSpawn(candidates);
  if (!roof) throw new Error(`${config.name} has no verified clear, rendered rooftop spawn`);
  return roof;
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
    const meshQueries = new Map<DistrictId, WorldMeshQuery>();
    const repeatingWorlds = new Map<DistrictId, RepeatingMeshWorld>();
    const raycastWorld = (origin: THREE.Vector3, direction: THREE.Vector3, maximum: number, minNormalY?: number): MeshSurfaceHit | null => {
      return repeatingWorlds.get(currentDistrict)?.raycast(origin, direction, maximum, minNormalY) ?? null;
    };
    const meshSupportAt = (position: { x: number; y: number; z: number }, rise = .12, drop = .25) =>
      raycastWorld(new THREE.Vector3(position.x, position.y + rise, position.z), new THREE.Vector3(0, -1, 0), rise + drop, .65);
    const spawnViewYaw = (position: THREE.Vector3, preferred = 0) => {
      const origin = position.clone().add(new THREE.Vector3(0, .65, 0));
      let best = preferred, bestScore = -Infinity;
      for (let index = 0; index < 16; index++) {
        const yaw = preferred + index * Math.PI / 8;
        const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        const view = raycastWorld(origin, forward, 100)?.distance ?? 100;
        const behind = new THREE.Vector3(Math.sin(yaw) * 5.2, 2.1, Math.cos(yaw) * 5.2);
        const clearance = raycastWorld(origin, behind.clone().normalize(), behind.length())?.distance ?? behind.length();
        const score = (clearance >= 5.2 ? 1000 : 0) + view + clearance * 10 - index * .01;
        if (score > bestScore) { best = yaw; bestScore = score; }
      }
      return best;
    };
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
      const groundY = surface ? surface.point.y : GROUND_Y;
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
    let wallCameraYawAnchor = cameraYaw;
    let wallCameraWasRequested = false;
    const wallCameraNormal = new THREE.Vector3(0, 0, 1);
    let avatar: AvatarRig | null = null;
    let raceGhost: RaceGhost | null = null;
    let webStrand: WebStrand | null = null;
    let avatarPose: ProceduralPose = 'idle';
    let multiplayer: SpiderMultiplayer | null = null;
    let multiplayerStatus: MultiplayerStatus = 'connecting';
    let onlinePeerCount = 0;
    let networkSequence = 0;
    let lastNetworkBroadcast = -1;
    const remoteAvatars = new Map<string, RemoteAvatar>();
    const remoteStates = new Map<string, NetworkPlayerState>();
    const remoteLoads = new Map<string, Promise<void>>();
    let currentDistrict: DistrictId = props.districtId;
    const raceMarkers = new THREE.Group();
    raceMarkers.name = 'Swing race course';
    scene.add(raceMarkers);
    const raceGuideGeometry = new LineGeometry();
    const raceGuideMaterial = new LineMaterial({
      color: '#38dfff', linewidth: 3.4, transparent: true, opacity: .58,
      dashed: true, dashSize: 2.6, gapSize: 1.25, depthTest: false, depthWrite: false,
    });
    const raceGuide = new Line2(raceGuideGeometry, raceGuideMaterial);
    raceGuide.name = 'Hidden complete swing race path';
    raceGuide.renderOrder = 4;
    raceGuide.visible = false;
    scene.add(raceGuide);
    const activeGuideGeometry = new LineGeometry();
    const activeGuideMaterial = new LineMaterial({
      color: '#ffffff', linewidth: 5.8, transparent: true, opacity: .96,
      dashed: true, dashSize: 3.2, gapSize: .72, depthTest: false, depthWrite: false,
    });
    const activeRaceGuide = new Line2(activeGuideGeometry, activeGuideMaterial);
    activeRaceGuide.name = 'Current swing race segment';
    activeRaceGuide.renderOrder = 5;
    activeRaceGuide.visible = false;
    scene.add(activeRaceGuide);
    const raceDirectionArrows = new THREE.Group();
    raceDirectionArrows.name = 'Swing race direction chevrons';
    scene.add(raceDirectionArrows);
    const windTunnelVisuals = new THREE.Group();
    windTunnelVisuals.name = 'Traversal wind tunnels';
    scene.add(windTunnelVisuals);
    const trafficGroup = new THREE.Group();
    trafficGroup.name = 'Animated city traffic';
    scene.add(trafficGroup);
    let trafficSources: TrafficSource[] = [];
    let trafficVehicles: TrafficVehicle[] = [];
    let trafficLanes: TrafficLane[] = [];
    let trafficLoading: Promise<TrafficSource[]> | null = null;
    let windTunnelFields: WindTunnelField[] = [];
    let windBoostStrength = 0;
    let activeWindTunnel = -1;
    let raceRoute: THREE.Vector3[] = [];
    let raceNodeIds: number[] = [];
    let raceCourseTiles = new Set<string>();
    let raceStart = initialSpawn.clone();
    let raceState = createSwingRaceState(0);
    let raceSamples: RaceSample[] = [];
    let raceBest: RaceBest | null = null;
    let raceLap = 1;
    let lastRaceFinish: number | null = null;
    let raceFinishVisibleUntil = -1;
    const cinematicCamera = createCinematicCameraState();
    let wallSkimSeconds = 0;
    let wallSkimStrength = 0;
    let wallSkimCooldownUntil = 0;
    const wallSkimDirection = new THREE.Vector3(0, 0, -1);
    const wallSkimNormal = new THREE.Vector3(0, 0, 1);
    let previousPlayerYaw = 0;
    let manualCameraUntil = 0;
    let hudAccumulator = 0;
    let fpsAccumulator = 0;
    let fpsFrames = 0;
    let measuredFps = 60;
    let buildingCorrectionCount = 0;
    let performanceScaled = false;
    let lastFrameTime = performance.now();
    let elapsedTime = 0;
    let jumpPressed = false;
    let wallCrawlPressed = false;
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
    let spaceSwingBlockedUntilRelease = false;
    const swingAssistance = createSwingAssistanceState();
    let anchorSearchAt = -10;
    let cachedAnchors: WebAnchorCandidate[] = [];
    const anchorSearchPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
    const anchorSearchAim = new THREE.Vector2(Infinity, Infinity);
    let meshWallContact: SurfaceContact | null = null;
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
      raceGuideMaterial.resolution.set(width, height);
      activeGuideMaterial.resolution.set(width, height);
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

    const createTrafficProxy = (color: string) => {
      const proxy = new THREE.Group();
      proxy.name = 'Low latency traffic silhouette';
      const paint = new THREE.MeshStandardMaterial({ color, roughness: .48, metalness: .42 });
      const glass = new THREE.MeshStandardMaterial({ color: '#183044', roughness: .18, metalness: .55 });
      const light = new THREE.MeshBasicMaterial({ color: '#fff3bd' });
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.86, .54, 4.35), paint);
      body.position.y = .55;
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.56, .58, 2.15), glass);
      cabin.position.set(0, 1.03, -.18);
      cabin.rotation.x = -.035;
      const headlights = new THREE.Mesh(new THREE.BoxGeometry(1.35, .12, .035), light);
      headlights.position.set(0, .62, 2.19);
      proxy.add(body, cabin, headlights);
      return proxy;
    };

    const loadTrafficSources = () => {
      if (trafficLoading) return trafficLoading;
      trafficLoading = Promise.all(TRAFFIC_MODELS.map(async (config) => {
        try {
          const gltf = await loadModel<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>(config.url, config.name, 0, 0, false);
          if (disposed) return null;
          const model = gltf.scene;
          const pruned: THREE.Object3D[] = [];
          if ('prune' in config) model.traverse((object) => { if (config.prune.test(object.name)) pruned.push(object); });
          for (const object of pruned) object.parent?.remove(object);
          model.updateWorldMatrix(true, true);
          let box = new THREE.Box3().setFromObject(model);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const frontNodes: THREE.Object3D[] = [];
          model.traverse((object) => { if (/front|headlight|hood/i.test(object.name)) frontNodes.push(object); });
          const front = new THREE.Vector3();
          let frontSamples = 0;
          for (const node of frontNodes) {
            const nodeBox = new THREE.Box3().setFromObject(node);
            if (nodeBox.isEmpty()) continue;
            front.add(nodeBox.getCenter(new THREE.Vector3()));
            frontSamples += 1;
          }
          if (frontSamples) front.multiplyScalar(1 / frontSamples).sub(center);
          const sourceFrontYaw = front.lengthSq() > .01
            ? Math.atan2(front.x, front.z)
            : size.x > size.z ? Math.PI / 2 : 0;
          model.rotation.y -= sourceFrontYaw;
          model.updateWorldMatrix(true, true);
          box = new THREE.Box3().setFromObject(model);
          const rotatedSize = box.getSize(new THREE.Vector3());
          model.scale.multiplyScalar(4.65 / Math.max(rotatedSize.x, rotatedSize.z, .001));
          model.updateWorldMatrix(true, true);
          box = new THREE.Box3().setFromObject(model);
          const normalizedCenter = box.getCenter(new THREE.Vector3());
          model.position.x -= normalizedCenter.x;
          model.position.z -= normalizedCenter.z;
          model.position.y -= box.min.y;
          prepareMaterials(model, renderer, 'baked');
          model.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            object.castShadow = false;
            object.receiveShadow = false;
            object.frustumCulled = true;
          });
          const root = new THREE.Group();
          root.name = `${config.name} normalized traffic source`;
          root.add(model);
          root.updateWorldMatrix(true, true);
          return { config, root, clips: gltf.animations ?? [] } satisfies TrafficSource;
        } catch (error) {
          console.warn(`[traffic] ${config.name} unavailable`, error);
          return null;
        }
      })).then((sources) => {
        trafficSources = sources.filter(Boolean) as TrafficSource[];
        renderer.domElement.dataset.trafficModelCount = String(trafficSources.length);
        return trafficSources;
      });
      return trafficLoading;
    };

    const configureTraffic = (config: DistrictConfig) => {
      const world = repeatingWorlds.get(config.id);
      const stream = districtStreams.get(config.id);
      trafficGroup.clear();
      trafficVehicles = [];
      trafficLanes = [];
      if (!world || !stream || !trafficSources.length) return;
      const bounds = world.query.bounds;
      const highY = Math.max(18, bounds.max.y + 18);
      const maximumDrop = highY - bounds.min.y + 20;
      const driveableY = (x: number, z: number, requireClearance = true) => {
        const support = world.raycast({ x, y: highY, z }, { x: 0, y: -1, z: 0 }, maximumDrop, .78);
        if (!support || support.point.y > GROUND_Y + 2.2) return null;
        if (requireClearance && !world.isCapsuleClear({ x, y: support.point.y + .02, z }, .72, 1.42, false)) return null;
        return support.point.y + .025;
      };
      const trafficBounds = { minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z };
      trafficLanes = findTrafficLanes(trafficBounds, (x, z) => driveableY(x, z), {
        candidates: 11,
        samples: 48,
        maximum: 6,
        minimumLength: clamp(config.targetWidth * .08, 13, 28),
      });
      if (trafficLanes.length < 2) {
        trafficLanes = findTrafficLanes(trafficBounds, (x, z) => driveableY(x, z, false), {
          candidates: 13,
          samples: 54,
          maximum: 6,
          minimumLength: clamp(config.targetWidth * .055, 10, 22),
        });
      }
      if (!trafficLanes.length) {
        renderer.domElement.dataset.trafficLaneCount = '0';
        renderer.domElement.dataset.trafficVehicleCount = '0';
        return;
      }
      const count = Math.min(10, Math.max(6, trafficLanes.length * 2));
      for (let index = 0; index < count; index += 1) {
        const source = trafficSources[index % trafficSources.length];
        const high = cloneSkeleton(source.root) as THREE.Group;
        const wheels: THREE.Object3D[] = [];
        high.traverse((object) => { if (/wheel|tire/i.test(object.name)) wheels.push(object); });
        let mixer: THREE.AnimationMixer | null = null;
        if (source.clips.length) {
          mixer = new THREE.AnimationMixer(high);
          const action = mixer.clipAction(source.clips[0]);
          action.setEffectiveTimeScale(.62);
          action.play();
        }
        const lod = new THREE.LOD();
        lod.name = `${source.config.name} traffic LOD`;
        lod.addLevel(high, 0);
        lod.addLevel(createTrafficProxy(source.config.color), source.config.detailDistance);
        const root = new THREE.Group();
        root.name = `Traffic vehicle ${index + 1}: ${source.config.name}`;
        root.add(lod);
        trafficGroup.add(root);
        const lane = trafficLanes[index % trafficLanes.length];
        trafficVehicles.push({
          root,
          lane,
          speed: 4.2 + index % 4 * .72,
          offset: lane.length * ((index * .37) % 1),
          mixer,
          wheels: source.clips.length ? [] : wheels,
        });
      }
      renderer.domElement.dataset.trafficLaneCount = String(trafficLanes.length);
      renderer.domElement.dataset.trafficVehicleCount = String(trafficVehicles.length);
      renderer.domElement.dataset.trafficMode = 'street-grounded-lod';
    };

    const updateTraffic = (delta: number) => {
      const stream = districtStreams.get(currentDistrict);
      if (!stream || !trafficVehicles.length) return;
      const tileX = stream.centerX * stream.tileWidth;
      const tileZ = stream.centerZ * stream.tileDepth;
      for (let index = 0; index < trafficVehicles.length; index += 1) {
        const vehicle = trafficVehicles[index];
        const pose = trafficPose(vehicle.lane, elapsedTime, vehicle.speed, vehicle.offset);
        const x = pose.x + tileX;
        const z = pose.z + tileZ;
        vehicle.root.position.set(x, groundYAt({ x, y: pose.y, z }) + .025, z);
        vehicle.root.rotation.y = pose.yaw;
        vehicle.root.visible = vehicle.root.position.distanceToSquared(player.position) < 360 * 360;
        vehicle.mixer?.update(delta);
        for (const wheel of vehicle.wheels) wheel.rotation.x -= vehicle.speed * delta / .34;
      }
    };

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
        existing.velocity.fromArray(state.velocity);
        existing.lastSequence = state.sequence;
        existing.lastUpdate = performance.now();
        return;
      }
      if (existing) removeRemoteAvatar(state.playerId);
      if (remoteLoads.has(state.playerId)) return;

      const promise = (async () => {
        const suit = getSuit(state.suitId);
        const gltf = await loadModel<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>(suit.model, `${suit.name} network avatar`, 0, 0, false);
        if (disposed) return;
        const latest = remoteStates.get(state.playerId);
        if (!latest || latest.suitId !== suit.id || latest.districtId !== currentDistrict) return;
        prepareMaterials(gltf.scene, renderer, 'character');
        const clips = suitAnimationClips(gltf.animations, suit);
        applySuitRestPose(gltf.scene, suit, clips);
        if (suit.animationSource && suit.animationSource !== suit.model) {
          const library = await loadModel<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>(suit.animationSource, 'network traversal library', 0, 0, false);
          if (disposed || !remoteStates.has(state.playerId)) return;
          clips.push(...retargetMixamoClips(library.animations, library.scene, gltf.scene));
        }
        normalizeSuit(gltf.scene, suit, 2.05);
        const root = new THREE.Group();
        root.name = `Network player: ${state.playerId}`;
        if (suit.traversal === 'ironman') root.rotation.order = 'YXZ';
        const surfaceFrame = new THREE.Group();
        surfaceFrame.add(gltf.scene);
        root.add(surfaceFrame);
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
        const animator = new AvatarAnimator(gltf.scene, suit, clips);
        remoteAvatars.set(state.playerId, {
          root,
          surfaceFrame,
          wallPose: new WallPose(gltf.scene),
          animator,
          repulsors: suit.traversal === 'ironman' ? new IronManRepulsors(root, animator.bones) : null,
          velocity: new THREE.Vector3().fromArray(latest.velocity),
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
        remote.root.rotation.y = dampYaw(remote.root.rotation.y, remote.targetYaw, 12, delta);
        remote.wallPose.reset(remote.surfaceFrame);
        const crawling = remote.mode === 'wallCrawl';
        const ironCruise = remote.mode === 'iron-cruise' || remote.mode === 'iron-boost';
        remote.root.rotation.x = damp(remote.root.rotation.x, ironCruise ? -1.1 * remote.animator.cruiseBlend : 0, 7, delta);
        remote.animator.update(delta, { pose: networkPose(remote.mode), grounded: ['idle', 'land', 'perch', 'run'].includes(remote.mode),
          speed: crawling ? remote.velocity.length() : Math.hypot(remote.velocity.x, remote.velocity.z), verticalSpeed: remote.velocity.y,
          boost: remote.mode === 'iron-boost',
          crawlDirection: remote.velocity.y < -.1 ? -1 : 1 });
        remote.repulsors?.update(ironCruise || remote.mode === 'iron-hover', remote.velocity.length(), remote.mode === 'iron-boost', elapsedTime);
        if (crawling) {
          const normal = new THREE.Vector3(Math.sin(remote.targetYaw), 0, Math.cos(remote.targetYaw));
          const contact = probeWallFeet(remote.root.position, normal, raycastWorld);
          if (contact) remote.wallPose.apply(remote.surfaceFrame, remote.animator.bones, contact);
        }
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
      const permanentTileId = deterministicTileId(stream.districtId, x, z);
      root.userData.worldTileX = x;
      root.userData.worldTileZ = z;
      root.userData.worldTileId = permanentTileId;
      root.name = `${stream.template.name} · tile ${permanentTileId}`;
      scene.add(root);
      root.updateMatrixWorld(true);

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
      // Race coordinates and collision exist mathematically at every tile, but
      // heavy visual clones are mounted only when the player approaches them.
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
      renderer.domElement.dataset.streamTileId = String(deterministicTileId(district, centerX, centerZ));
      renderer.domElement.dataset.streamedTileCount = String(stream.tiles.size);
    };

    const resetRacePlayer = (now: number) => {
      player.position.copy(raceStart);
      player.velocity.set(0, 0, 0);
      player.grounded = true;
      Object.assign(traversal, createTraversalState(raceStart));
      traversal.grounded = true;
      traversal.mode = 'idle';
      cameraYaw = spawnViewYaw(raceStart, getDistrict(currentDistrict).spawnYaw ?? 0);
      cameraPitch = getDistrict(currentDistrict).spawnPitch ?? .08;
      traversal.heading = cameraYaw;
      player.facing = cameraYaw;
      meshWallContact = null;
      pointerZipActive = false;
      wallCameraBlend = 0;
      camera.up.set(0, 1, 0);
      raceState = createSwingRaceState(now, raceStart);
      raceSamples = [];
      const offset = new THREE.Vector3(Math.sin(cameraYaw) * 9, 4, Math.cos(cameraYaw) * 9);
      camera.position.copy(raceStart).add(offset);
      camera.lookAt(raceStart.clone().add(new THREE.Vector3(0, 1.35, 0)));
    };

    const showFinishGuide = (currentPosition = player.position) => {
      const finishIndex = raceRoute.length - 1;
      const to = raceRoute[finishIndex];
      if (!to) { activeRaceGuide.visible = false; return; }
      activeGuideGeometry.setPositions(raceGuidanceLine(currentPosition, to));
      activeRaceGuide.computeLineDistances();
      activeRaceGuide.visible = true;
      renderer.domElement.dataset.raceGuideAttached = 'true';
      renderer.domElement.dataset.raceGuidePoints = '2';
      renderer.domElement.dataset.raceGuideTarget = 'finish';
      renderer.domElement.dataset.raceGuideTargetId = String(raceNodeIds[finishIndex] ?? '');
    };

    const drawRaceCourse = () => {
      const coursePoints = [raceStart, ...raceRoute, raceStart];
      raceGuideGeometry.setPositions(coursePoints.flatMap(point => [point.x, point.y, point.z]));
      raceGuide.computeLineDistances();
      // Only the live player-to-finish tether is rendered. Checkpoints remain
      // authoritative for race progress but do not bend the visual heading.
      raceGuide.visible = false;
      raceDirectionArrows.clear();
      showFinishGuide();
    };

    const configureWindTunnels = (coursePoints: THREE.Vector3[], config: DistrictConfig) => {
      windTunnelVisuals.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
      windTunnelVisuals.clear();
      windTunnelFields = [];
      const candidates = coursePoints.slice(0, -1).map((from, index) => ({
        from,
        to: coursePoints[index + 1],
        index,
        length: from.distanceTo(coursePoints[index + 1]),
      })).filter((segment) => segment.length > 18 && segment.index > 0);
      // Spread two boosts around the lap instead of stacking them into one
      // avenue. Their velocity-only fields are resolved before the exact mesh
      // sweep, so buildings remain authoritative even at full boost.
      const selected = [candidates[Math.floor(candidates.length * .18)], candidates[Math.floor(candidates.length * .63)]]
        .filter((segment, index, entries) => segment && entries.indexOf(segment) === index);
      selected.forEach((segment, tunnelIndex) => {
        if (!segment) return;
        const direction = segment.to.clone().sub(segment.from).normalize();
        const center = segment.from.clone().lerp(segment.to, .5);
        const halfLength = clamp(segment.length * .2, 8, 30);
        const radius = clamp(config.targetWidth / 42, 5.5, 10.5);
        windTunnelFields.push({
          center: { x: center.x, y: center.y, z: center.z },
          direction: { x: direction.x, y: direction.y, z: direction.z },
          halfLength,
          radius,
          acceleration: 54,
          maximumSpeed: 96,
        });

        const visual = new THREE.Group();
        visual.name = `Wind tunnel ${tunnelIndex + 1}`;
        const shell = new THREE.Mesh(
          new THREE.CylinderGeometry(radius, radius, halfLength * 2, 18, 1, true),
          new THREE.MeshBasicMaterial({ color: tunnelIndex ? '#7a7dff' : '#35e7ff', transparent: true, opacity: .075,
            wireframe: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
        );
        shell.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
        visual.add(shell);
        const ringMaterial = new THREE.MeshBasicMaterial({ color: tunnelIndex ? '#9291ff' : '#75f2ff', transparent: true,
          opacity: .56, depthWrite: false, blending: THREE.AdditiveBlending });
        const ringCount = Math.max(5, Math.min(10, Math.ceil(halfLength * 2 / 6)));
        for (let index = 0; index < ringCount; index += 1) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, .075, 4, 28), ringMaterial);
          ring.position.copy(direction).multiplyScalar(-halfLength + index / Math.max(1, ringCount - 1) * halfLength * 2);
          ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
          ring.userData.windPhase = index / ringCount;
          visual.add(ring);
        }
        visual.position.copy(center);
        windTunnelVisuals.add(visual);
      });
      renderer.domElement.dataset.windTunnelCount = String(windTunnelFields.length);
    };

    const configureRaceCourse = (config: DistrictConfig, now: number) => {
      const world = repeatingWorlds.get(config.id);
      const stream = districtStreams.get(config.id);
      if (!world || !stream) return;
      raceStart = safeSpawn(config);
      const clearance = clamp(Math.min(stream.tileWidth, stream.tileDepth) * .045, 3.4, 13);
      const highY = Math.max(world.query.bounds.max.y + 90, raceStart.y + 180);
      const nodes = deterministicRaceNodes(config.id, raceStart, stream.tileWidth, stream.tileDepth, {
        count: 8,
        minimumRadius: config.id === 'backstreet' ? 12 : 30,
        maximumRadius: 108,
      });
      raceNodeIds = nodes.map((node) => node.id);
      raceRoute = nodes.map((node, index) => {
        const point = new THREE.Vector3(node.x, raceStart.y + clearance, node.z);
        const support = world.raycast({ x: point.x, y: highY, z: point.z }, { x: 0, y: -1, z: 0 }, highY + 200, .55);
        if (support) point.y = Math.max(GROUND_Y + clearance, support.point.y + clearance + (index % 2 ? 2.4 : 0));
        return point;
      });
      const coursePoints = [raceStart, ...raceRoute, raceStart];
      configureWindTunnels(coursePoints, config);
      raceCourseTiles = courseTileKeys(
        coursePoints,
        stream.tileWidth,
        stream.tileDepth,
        { x: config.position[0], y: 0, z: config.position[2] },
      );
      raceMarkers.clear();
      raceRoute.forEach((point, index) => {
        const marker = createCheckpointMarker();
        marker.userData.checkpointId = raceNodeIds[index];
        marker.position.copy(point);
        const next = raceRoute[(index + 1) % raceRoute.length];
        (marker.userData.rings as THREE.Group).quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1), next.clone().sub(point).normalize(),
        );
        marker.scale.setScalar(clamp(config.targetWidth / 75, 2.8, 5.4));
        setCheckpointActive(marker, index === 0);
        raceMarkers.add(marker);
      });
      drawRaceCourse();
      raceBest = parseRaceBest(localStorage.getItem(raceStorageKey(config.id, props.suitId)));
      raceLap = 1;
      if (raceGhost) raceGhost.root.visible = Boolean(raceBest);
      resetRacePlayer(now);
      renderer.domElement.dataset.raceCheckpoints = String(raceRoute.length);
      renderer.domElement.dataset.raceCourse = config.id;
      renderer.domElement.dataset.raceBest = raceBest?.duration.toFixed(3) ?? '';
      renderer.domElement.dataset.raceLogicalTiles = [...raceCourseTiles].join('|');
      renderer.domElement.dataset.raceNodeIds = raceNodeIds.join('|');
      renderer.domElement.dataset.raceRouteHash = String(deterministicTileId(`${config.id}:route`, raceNodeIds[0] ?? 0, raceNodeIds.at(-1) ?? 0));
      updateWorldStreaming(config.id, raceStart);
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
        const query = await WorldMeshQuery.fromObject(root, { onProgress: (ratio) => {
          if (report && !disposed) callbacksRef.current.onStatus(`Building ${config.name} surface collisions`, 80 + ratio * 15);
        } });
        if (disposed) throw new Error('Game disposed');
        meshQueries.set(config.id, query);
        renderer.domElement.dataset.meshTriangles = String(query.triangleCount);
        renderer.domElement.dataset.meshCollisionMb = (query.byteLength / 1048576).toFixed(2);
        const rooftopSpawn = chooseRooftopSpawn(config, baseColliders, finalDistrictBounds, query);
        districtRooftopSpawns.set(config.id, rooftopSpawn);
        renderer.domElement.dataset.spawnSurfaceVerified = String(query.hasSurface(rooftopSpawn) && query.isCapsuleClear(rooftopSpawn));
        if (config.id === currentDistrict) {
          renderer.domElement.dataset.spawnMode = 'central-rooftop';
          renderer.domElement.dataset.rooftopSpawn = rooftopSpawn.toArray().map((value) => value.toFixed(2)).join(',');
        }
        anchorTargetList = [...anchorTargets];
        const baseWalkables = tileWalkables(root);
        root.userData.worldTileX = 0;
        root.userData.worldTileZ = 0;
        root.userData.worldTileId = deterministicTileId(config.id, 0, 0);
        districtStreams.set(config.id, {
          districtId: config.id,
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
        repeatingWorlds.set(config.id, new RepeatingMeshWorld(query, Math.max(8, rotatedWidth + 8), Math.max(8, rotatedDepth + 8)));
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
        if (disposed) throw error;
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
      const authoredClips = suitAnimationClips(gltf.animations, suit);
      // Calibrate exporter-specific horizontal/crouched skeletons to their
      // actual standing reference before borrowing local-space limb motion.
      applySuitRestPose(gltf.scene, suit, authoredClips);
      const clips = [...authoredClips];
      if (suit.animationSource && suit.animationSource !== suit.model) {
        callbacksRef.current.onStatus(`Calibrating ${suit.name} traversal rig`, 43);
        const library = await loadModel<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>(
          suit.animationSource, `${suit.name} traversal library`, 43, 58, false,
        );
        clips.push(...retargetMixamoClips(library.animations, library.scene, gltf.scene));
      }
      normalizeSuit(gltf.scene, suit, 2.05);
      const root = new THREE.Group();
      root.name = `Player: ${suit.name}`;
      if (suit.traversal === 'ironman') root.rotation.order = 'YXZ';
      const surfaceFrame = new THREE.Group();
      surfaceFrame.name = 'Surface-aligned avatar pose';
      surfaceFrame.add(gltf.scene);
      root.add(surfaceFrame);
      root.position.copy(player.position);
      scene.add(root);
      const animator = new AvatarAnimator(gltf.scene, suit, clips);
      const repulsors = suit.traversal === 'ironman' ? new IronManRepulsors(root, animator.bones) : null;
      avatar = { root, model: gltf.scene, animator, surfaceFrame, wallPose: new WallPose(gltf.scene), repulsors };
      const ghostModel = cloneSkeleton(gltf.scene) as THREE.Group;
      ghostModel.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const source = Array.isArray(object.material) ? object.material : [object.material];
        const materials = source.map((material) => {
          const copy = material.clone();
          copy.transparent = true;
          copy.opacity = .26;
          copy.depthWrite = false;
          copy.blending = THREE.NormalBlending;
          if ('color' in copy && copy.color instanceof THREE.Color) copy.color.set('#9da9b2');
          if ('emissive' in copy && copy.emissive instanceof THREE.Color) copy.emissive.set('#4c555b');
          return copy;
        });
        object.material = Array.isArray(object.material) ? materials : materials[0];
        object.castShadow = false;
        object.receiveShadow = false;
        object.renderOrder = 3;
      });
      const ghostRoot = new THREE.Group();
      ghostRoot.name = `Best run ghost: ${suit.name}`;
      ghostRoot.add(ghostModel);
      ghostRoot.visible = false;
      scene.add(ghostRoot);
      raceGhost = { root: ghostRoot, animator: new AvatarAnimator(ghostModel, suit, clips) };
      renderer.domElement.dataset.suit = suit.id;
      renderer.domElement.dataset.animationClips = animator.clips.map((clip) => clip.name).join('|');
      renderer.domElement.dataset.rigRoles = [...new Set(animator.bones.map((entry) => entry.role))].join('|');
    };

    const loadWebEffect = async () => {
      try {
        const gltf = await loadModel<{ scene: THREE.Group }>(WEB_STRAND_MODEL, 'textured web strand', 40, 52, false);
        if (disposed) return;
        prepareMaterials(gltf.scene, renderer, 'character');
        webStrand = new WebStrand(gltf.scene);
        scene.add(webStrand.group);
        renderer.domElement.dataset.webRender = 'downloaded-3d-model';
        renderer.domElement.dataset.webSourceTriangles = String(webStrand.sourceTriangleCount);
        renderer.domElement.dataset.webMaximumTriangles = String(webStrand.maximumTriangles);
      } catch (error) {
        console.warn('[web] downloaded strand unavailable; keeping line fallback', error);
        renderer.domElement.dataset.webRender = 'line-fallback';
      }
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
      if (elapsedTime - anchorSearchAt < .08 && anchorSearchPosition.distanceToSquared(player.position) < 4
        && anchorSearchAim.distanceToSquared(ndc) < .002 && !zipPressed) {
        const chest = player.position.clone().add(new THREE.Vector3(0, 1.3, 0));
        const valid = cachedAnchors.filter(candidate => {
          const direction = new THREE.Vector3().copy(candidate.point).sub(chest);
          const distance = direction.length();
          return distance > 3 && !raycastWorld(chest, direction.normalize(), Math.max(0, distance - .08));
        });
        if (valid.length) return valid;
      }
      anchorSearchAt = elapsedTime; anchorSearchPosition.copy(player.position); anchorSearchAim.copy(ndc);
      const candidates: WebAnchorCandidate[] = [];
      cachedAnchors = candidates;
      if (meshQueries.has(currentDistrict)) {
        const chest = new THREE.Vector3(traversal.position.x, traversal.position.y + 1.3, traversal.position.z);
        const addSurface = (hit: MeshSurfaceHit | null, weight: number) => {
          if (!hit) return;
          const offset = hit.point.clone().sub(chest);
          const distance = offset.length();
          if (distance < 3 || distance > 150) return;
          const obstruction = raycastWorld(chest, offset.normalize(), Math.max(0, distance - .08));
          if (obstruction) return;
          candidates.push({ id: `mesh:${hit.triangleIndex}:${hit.point.x.toFixed(1)}:${hit.point.z.toFixed(1)}`,
            point: hit.point.clone(), normal: hit.normal.clone(), kind: hit.normal.y > .65 ? 'roof' : 'facade', lineOfSight: true, weight });
        };
        for (const [x, y, weight] of [[ndc.x, ndc.y, 1.35], [ndc.x - .16, ndc.y + .15, .95], [ndc.x + .16, ndc.y + .15, .95], [ndc.x - .32, ndc.y + .32, .8], [ndc.x + .32, ndc.y + .32, .8]]) {
          raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
          addSurface(raycastWorld(raycaster.ray.origin, raycaster.ray.direction, 150), weight);
        }
        if (swingHeldForAssist()) {
          // Imported cities need not contain hand-authored anchor tags. Search
          // elevated facades alongside the travel corridor, then require actual
          // visible triangle contact. Never attach to a proxy or empty sky.
          const heading = Math.hypot(player.velocity.x, player.velocity.z) > 8
            ? Math.atan2(-player.velocity.x, -player.velocity.z) : cameraYaw;
          for (const elevation of [.52, .87, 1.13]) for (const side of [-.9, -.45, 0, .45, .9]) {
            const yaw = heading + side;
            const direction = new THREE.Vector3(-Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation), -Math.cos(yaw) * Math.cos(elevation));
            addSurface(raycastWorld(chest, direction, 145), 1 + elevation * .12);
          }
        }
        // Proxy boxes only suggest search directions. Every accepted assist
        // point is replaced by a visible triangle hit with clear player LOS.
        if (!candidates.length || swingHeldForAssist()) {
          for (const box of nearbyColliders(traversal.position, 92)) {
            if (box.max.y < chest.y + 2) continue;
            const target = box.clampPoint(chest, new THREE.Vector3());
            target.y = clamp(chest.y + 22, box.min.y + 2, box.max.y - .1);
            const direction = target.sub(chest);
            if (direction.lengthSq() < 9 || direction.lengthSq() > 92 * 92) continue;
            const aim = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
            if (direction.clone().normalize().dot(aim) < -.1) continue;
            addSurface(raycastWorld(chest, direction.normalize(), 92), .8);
            if (candidates.length >= 14) break;
          }
        }
        renderer.domElement.dataset.lastAnchorCandidateCount = String(candidates.length);
        renderer.domElement.dataset.lastAnchorCandidate = candidates[0] ? [candidates[0].point.x, candidates[0].point.y, candidates[0].point.z].map((value) => value.toFixed(2)).join(',') : '';
        renderer.domElement.dataset.anchorValidation = 'rendered-mesh-los';
        return candidates;
      }
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
    const swingHeldForAssist = () => keys.has('Space') || (pointerHeld && performance.now() - pointerDownAt >= 240);

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
      if (event.button !== 0 || !pointerHeld) return;
      readPointer(event);
      const quickClick = performance.now() - pointerDownAt < 240;
      pointerHeld = false;
      if (quickClick && getSuit(props.suitId).traversal === 'ironman') cruiseTogglePressed = true;
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
      if (process.env.NODE_ENV !== 'production') renderer.domElement.dataset.lastKey = event.code;
      const firstPress = !keys.has(event.code);
      keys.add(event.code);
      if (['Space', 'KeyE', 'KeyF', 'ShiftLeft', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
      if (event.code === 'Space' && firstPress) {
        jumpPressed = true;
        spacePressedAt = elapsedTime;
        const active = getSuit(props.suitId);
        // An airborne tap is the double-jump command. If the key is held a
        // fraction too long, do not silently turn that same press into a web
        // attachment; releasing Space arms swinging again.
        spaceSwingBlockedUntilRelease = active.traversal === 'spider' && !traversal.grounded
          && !traversal.swing && !traversal.zip && traversal.airJumpsRemaining > 0;
      }
      if (event.code === 'KeyQ' && firstPress) wallCrawlPressed = true;
      if (event.code === 'KeyE' && firstPress) { zipPressed = true; zipReleased = false; }
      if (event.code === 'KeyF' && firstPress) hoverTogglePressed = true;
      if (event.code === 'KeyE' && firstPress) cruiseTogglePressed = true;
      if (process.env.NODE_ENV !== 'production' && event.code === 'KeyN' && firstPress
        && new URLSearchParams(location.search).has('raceTest') && raceRoute[raceState.checkpoint]) {
        player.position.copy(raceRoute[raceState.checkpoint]);
        player.velocity.set(0, 0, 0);
        player.grounded = false;
        setTraversalKinematics(traversal, player.position, player.velocity);
        traversal.grounded = false;
        renderer.domElement.dataset.raceDebugGate = String(raceState.checkpoint + 1);
      }
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
      if (event.code === 'Space') spaceSwingBlockedUntilRelease = false;
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
      wallCrawlPressed = false;
      spaceSwingBlockedUntilRelease = false;
    };
    // Opt-in, visible development controls exercise the real input/mesh/render
    // loop. No browser-injected game state and no public production test UI.
    const trialEnabled = process.env.NODE_ENV !== 'production' && new URLSearchParams(location.search).has('traversalTest');
    let trial: { elapsed: number; previous: THREE.Vector3; startY: number; distance: number; peakSpeed: number; peakHeight: number; air: number; attaches: number; contacts: number; penetrationChecks: number; penetrations: number; penetrationDetails: unknown[]; nextCheck: number; phase: boolean } | null = null;
    const trialPanel = trialEnabled ? document.createElement('section') : null;
    const trialOutput = document.createElement('output');
    if (trialPanel) {
      trialPanel.setAttribute('aria-label', 'Traversal verification');
      trialPanel.style.cssText = 'position:absolute;left:16px;bottom:14px;z-index:60;background:#091b28ed;color:#bcefff;padding:12px;max-width:460px;font-size:13px;pointer-events:auto';
      for (const street of [true, false]) {
        const button = document.createElement('button'); button.textContent = street ? 'Run street swing trial' : 'Run rooftop swing trial';
        button.style.cssText = 'padding:8px;margin:3px;border:1px solid #48cfea;background:#12384a;color:white';
        button.onclick = () => {
          if (!ready || getSuit(props.suitId).traversal !== 'spider') return;
          const world = repeatingWorlds.get(currentDistrict); if (!world) return;
          let spawn = safeSpawn(getDistrict(currentDistrict));
          if (street) {
            const config = getDistrict(currentDistrict), hint = config.spawn ?? [config.position[0], config.position[2]];
            let best: THREE.Vector3 | null = null, bestScore = -Infinity;
            const stride = Math.min(12, config.targetWidth / 16);
            for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) {
              const support = world.supportAt({ x: hint[0] + x * stride, y: 3, z: hint[1] + z * stride }, 0, 6);
              if (!support || support.normal.y < .9) continue;
              const point = support.point.clone(); point.y = capsuleSupportHeight(support);
              if (!world.isCapsuleClear(point)) continue;
              const eye = point.clone().add(new THREE.Vector3(0, 1.3, 0));
              const open = Math.max(...[0, Math.PI / 2, Math.PI, -Math.PI / 2].map(yaw => world.raycast(eye, { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) }, 60)?.distance ?? 60));
              const score = open - Math.hypot(x, z) * .7;
              if (score > bestScore) { best = point; bestScore = score; }
            }
            if (!best) { trialOutput.textContent = 'No capsule-clear street start found; trial not run.'; return; }
            spawn = best;
          }
          clearKeys(); anchorSearchAt = -10;
          player.position.copy(spawn); player.velocity.set(0, 0, 0); player.grounded = true;
          Object.assign(traversal, createTraversalState(spawn)); traversal.grounded = true;
          cameraYaw = spawnViewYaw(spawn, 0); cameraPitch = .08; traversal.heading = cameraYaw;
          camera.position.copy(spawn).add(new THREE.Vector3(Math.sin(cameraYaw) * 7, 3.2, Math.cos(cameraYaw) * 7));
          meshWallContact = null;
          trial = { elapsed: 0, previous: spawn.clone(), startY: spawn.y, distance: 0, peakSpeed: 0, peakHeight: 0, air: 0, attaches: 0, contacts: 0, penetrationChecks: 0, penetrations: 0, penetrationDetails: [], nextCheck: 0, phase: false };
          trialOutput.textContent = 'Running real-map swing/release trial (16 seconds)…';
        };
        trialPanel.appendChild(button);
      }
      const cancel = document.createElement('button'); cancel.textContent = 'Stop trial';
      cancel.onclick = () => { trial = null; clearKeys(); trialOutput.textContent = 'Stopped'; };
      trialPanel.appendChild(cancel); trialPanel.appendChild(document.createElement('br')); trialPanel.appendChild(trialOutput); mount.appendChild(trialPanel);
    }
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
        configureRaceCourse(district, elapsedTime);
        if (trafficSources.length) configureTraffic(district);
        cameraPitch = district.spawnPitch ?? .08;
        player.position.copy(safeSpawn(district));
        cameraYaw = spawnViewYaw(player.position, district.spawnYaw ?? 0);
        traversal.heading = cameraYaw;
        player.facing = cameraYaw;
        player.velocity.set(0, 0, 0);
        player.grounded = true;
        setTraversalKinematics(traversal, player.position, player.velocity);
        traversal.grounded = true;
        traversal.mode = 'idle';
        traversal.swing = null;
        traversal.zip = null;
        traversal.wall = null;
        traversal.wallCrawlActive = false;
        traversal.wallRunActive = false;
        traversal.mantle = null;
        traversal.swingNeedsRelease = false;
        ironFlightMode = 'grounded';
        anchorSearchAt = -10; cachedAnchors = [];
        meshWallContact = null;
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
      avatar.wallPose.reset(avatar.surfaceFrame);
      avatar.root.position.copy(player.position);
      avatar.root.rotation.y = dampYaw(avatar.root.rotation.y, context.animation.bodyYaw, 13, delta);
      avatar.root.rotation.z = damp(avatar.root.rotation.z, context.animation.bodyRoll, 8, delta);
      const activeSuit = getSuit(props.suitId);
      const isIronMan = activeSuit.traversal === 'ironman';
      const ironPitch = ironFlightMode === 'cruise' ? -1.1 * avatar.animator.cruiseBlend : ironFlightMode === 'freefall' ? context.animation.bodyPitch : 0;
      avatar.root.rotation.x = damp(avatar.root.rotation.x, player.grounded ? 0 : isIronMan ? ironPitch : context.animation.bodyPitch, 8, delta);
      const mode = context.animation.state;
      const pose: ProceduralPose = isIronMan
        ? ironFlightMode === 'cruise' ? 'fly'
          : ironFlightMode === 'hover' ? 'hover'
            : mode === 'run' ? 'run'
              : player.grounded ? 'idle' : player.velocity.y < -1 ? 'fall' : 'jump'
        : mode === 'swing' ? 'swing'
          : mode === 'doubleJump' ? 'backflip'
          : mode === 'webZip' || mode === 'pointLaunch' ? 'zip'
            : mode === 'wallRun' ? 'run'
              : mode === 'wallCrawl' ? 'crawl'
                : mode === 'mantle' ? 'perch'
                : mode === 'dive' ? 'dive'
                  : mode === 'run' ? 'run'
                    : player.grounded && (mode === 'idle' || mode === 'perch') && player.position.y > groundYAt(player.position) + 4 ? 'perch'
                      : mode === 'idle' || mode === 'land' || mode === 'perch' ? 'idle' : player.velocity.y < -1 ? 'fall' : 'jump';
      renderer.domElement.dataset.animationState = mode;
      avatarPose = pose;
      const anchor = context.webAnchor ?? traversal.zip?.surfacePoint ?? traversal.zip?.target;
      avatar.animator.update(delta, { pose, grounded: player.grounded, speed: mode === 'wallCrawl' || mode === 'wallRun' ? player.velocity.length() : context.horizontalSpeed, verticalSpeed: player.velocity.y, tension: context.webTension,
        crawlDirection: player.velocity.y < -.1 ? -1 : 1,
        boost: isIronMan && ironFlightMode === 'cruise' && pointerHeld,
        anchor: anchor ? new THREE.Vector3(anchor.x, anchor.y, anchor.z) : null });
      if (mode === 'wallCrawl' && traversal.wall?.feetTouching) avatar.wallPose.apply(avatar.surfaceFrame, avatar.animator.bones, traversal.wall);
      if (mode === 'wallRun' && traversal.wall) {
        const surfaceUp = new THREE.Vector3(traversal.wall.normal.x, 0, traversal.wall.normal.z).normalize();
        const runForward = player.velocity.clone().addScaledVector(surfaceUp, -player.velocity.dot(surfaceUp));
        if (runForward.lengthSq() < .01) runForward.set(0, 1, 0);
        runForward.normalize();
        const surfaceBack = runForward.clone().negate();
        const surfaceRight = new THREE.Vector3().crossVectors(surfaceUp, surfaceBack).normalize();
        const worldFrame = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(surfaceRight, surfaceUp, surfaceBack),
        );
        const rootWorld = avatar.root.getWorldQuaternion(new THREE.Quaternion());
        avatar.surfaceFrame.quaternion.copy(rootWorld.invert().multiply(worldFrame));
        avatar.surfaceFrame.position.copy(surfaceUp).multiplyScalar(-.43).applyQuaternion(
          avatar.root.getWorldQuaternion(new THREE.Quaternion()).invert(),
        );
      }
      renderer.domElement.dataset.wallCrawlActive = String(traversal.wallCrawlActive);
      renderer.domElement.dataset.wallRunActive = String(traversal.wallRunActive);
      renderer.domElement.dataset.wallFootGap = mode === 'wallCrawl' ? avatar.wallPose.footGap.toFixed(3) : '';
      renderer.domElement.dataset.wallBodyClearance = mode === 'wallCrawl' ? avatar.wallPose.bodyClearance.toFixed(3) : '';
      renderer.domElement.dataset.activeAnimation = avatar.animator.activeClip;
      renderer.domElement.dataset.soleError = avatar.animator.contactError.toFixed(4);
      const repulsorActive = isIronMan && (ironFlightMode === 'hover' || ironFlightMode === 'cruise');
      avatar.repulsors?.update(repulsorActive, context.speed, pointerHeld, elapsed);
      renderer.domElement.dataset.ironFlightMode = isIronMan ? ironFlightMode : '';
    };

    const tick = (timestamp = performance.now()) => {
      if (disposed) return;
      frameId = requestAnimationFrame(tick);
      const delta = Math.min(Math.max((timestamp - lastFrameTime) / 1000, 0), .034);
      lastFrameTime = timestamp;
      elapsedTime += delta;
      wallSkimSeconds = Math.max(0, wallSkimSeconds - delta);
      atmosphere.update(elapsedTime);
      if (!ready) { renderer.render(scene, camera); return; }
      if (trial) {
        trial.elapsed += delta;
        const held = trial.elapsed % 3.35 < 3;
        if (held && !trial.phase) { keys.add('Space'); keys.add('KeyW'); spacePressedAt = elapsedTime - .13; }
        if (!held && trial.phase) { keys.delete('Space'); keys.delete('KeyW'); }
        trial.phase = held;
      }
      if (keys.has('ArrowLeft')) { cameraYaw += 1.5 * delta; manualCameraUntil = elapsedTime + 1.35; }
      if (keys.has('ArrowRight')) { cameraYaw -= 1.5 * delta; manualCameraUntil = elapsedTime + 1.35; }
      if (keys.has('ArrowUp')) { cameraPitch = clamp(cameraPitch + 1.05 * delta, -.18, .58); manualCameraUntil = elapsedTime + 1.35; }
      if (keys.has('ArrowDown')) { cameraPitch = clamp(cameraPitch - 1.05 * delta, -.18, .58); manualCameraUntil = elapsedTime + 1.35; }
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
      if (pointerHeld || pointerZipActive) {
        raycaster.setFromCamera(pointerNdc, camera);
        cameraAim.copy(raycaster.ray.direction);
      }
      const keyboardSwingHeld = hero.traversal === 'spider' && keys.has('Space') && !spaceSwingBlockedUntilRelease
        && elapsedTime - spacePressedAt > .12;
      const pointerSwingHeld = pointerHeld && performance.now() - pointerDownAt >= 240;
      const swingHeld = hero.traversal === 'spider' && (pointerSwingHeld || keyboardSwingHeld);
      const targetNdc = pointerHeld || pointerPressed || pointerZipActive ? pointerNdc : new THREE.Vector2(0, .08);
      const needsAnchor = hero.traversal === 'spider' && ((!traversal.swing && !traversal.zip && swingHeld) || zipPressed);
      const anchorCandidates = needsAnchor ? collectAnchorCandidates(targetNdc) : [];

      if (hero.traversal === 'ironman') {
        traversal.swing = null;
        traversal.zip = null;
        ironFlightMode = updateIronFlight(ironFlightMode, traversal, {
          hoverToggle: hoverTogglePressed, cruiseToggle: cruiseTogglePressed,
          ascend: keys.has('Space'), ascendPressed: jumpPressed, descend: keys.has('ShiftLeft'), boost: pointerHeld, aim: cameraAim,
        }, delta);
      }

      updateWorldStreaming(currentDistrict, player.position);
      const activeColliders = nearbyColliders(player.position, Math.max(42, player.velocity.length() * .12));
      const ironPowered = hero.traversal === 'ironman' && (ironFlightMode === 'hover' || ironFlightMode === 'cruise');
      const localGroundY = groundYAt(traversal.position);
      const windStep = stepWindTunnels(traversal.position, traversal.velocity, windTunnelFields, delta);
      Object.assign(traversal.velocity, windStep.velocity);
      activeWindTunnel = windStep.strength > 0 ? windStep.active : -1;
      windBoostStrength = damp(windBoostStrength, windStep.strength, windStep.strength > 0 ? 9 : 4.5, delta);

      const traversalOverrides = hero.traversal === 'ironman' ? {
        gravity: ironPowered ? 0 : 29,
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
        anchorMaximumDistance: 150,
      } : {
        zipAcceleration: 126,
        zipDamping: 3.6,
        zipMaximumSpeed: 66,
        maximumSpeed: windStep.strength > 0 ? 98 : 68,
      };
      const frameInput: TraversalInput = {
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
        wallCrawlPressed: hero.traversal === 'spider' && wallCrawlPressed,
        wallClimb: keys.has('KeyW') ? 1 : keys.has('KeyS') ? -1 : 0,
        wallStrafe: keys.has('KeyD') ? 1 : keys.has('KeyA') ? -1 : 0,
        pointerPressure: pointerHeld ? pointerPressure : undefined,
        reel: swingHeld && keys.has('KeyW') ? -1 : keys.has('KeyS') ? 1 : 0,
      };
      const exactWorld = repeatingWorlds.get(currentDistrict);
      if (hero.traversal === 'spider' && exactWorld) {
        const assisted = stepSwingAssistance(swingAssistance, {
          position: traversal.position, velocity: traversal.velocity, dt: delta,
          swinging: Boolean(traversal.swing && swingHeld), diving: keys.has('ShiftLeft'),
          desiredDirection: wish.lengthSq() > .01 ? wish : forward,
        }, (origin, direction, maximum) => exactWorld.raycast(origin, direction, maximum));
        Object.assign(traversal.velocity, assisted.velocity);
        renderer.domElement.dataset.swingAssistance = assisted.active ? 'steering' : 'clear';
        renderer.domElement.dataset.assistanceProbes = String(assisted.probeCount);
      }
      if (exactWorld && wallCrawlPressed && !meshWallContact) {
        // Q only attaches within physical capsule-to-facade reach, never at a
        // remote aimed building. Short probes also allow attaching at rest.
        for (const normal of [forward.clone().negate(), right, right.clone().negate(), forward]) {
          meshWallContact = probeWallFeet(traversal.position, normal, raycastWorld);
          if (meshWallContact) break;
        }
      }
      if (exactWorld && traversal.wallCrawlActive && traversal.wall && frameInput.wallClimb! > 0 && !jumpPressed && !swingHeld && !zipPressed) {
        const target = findMantleTarget(traversal.position, traversal.wall.normal, raycastWorld,
          (point) => exactWorld.isCapsuleClear(point));
        if (target) {
          traversal.mantle = { target, elapsed: 0 };
          traversal.wallCrawlActive = false;
        }
      }
      const beforeMotion = new THREE.Vector3().copy(traversal.position);
      const wasGrounded = traversal.grounded;
      const result = stepTraversalInPlace(traversal, frameInput, {
        groundY: exactWorld ? -10000 : localGroundY,
        sampleGround: exactWorld ? (point, stepUp, maximumDrop) => meshSupportAt(point, stepUp, maximumDrop ?? .1)?.point.y ?? null : undefined,
        isCapsuleClear: exactWorld
          ? (point, radius, height) => exactWorld.isCapsuleClear(point, radius, height, false)
          : undefined,
        wallContact: exactWorld ? meshWallContact : undefined,
        colliders: exactWorld ? [] : activeColliders,
        anchorColliders: exactWorld ? [] : nearbyColliders(player.position, 110),
        anchorCandidates,
        zipTargets: pointerZipActive ? anchorCandidates.slice(0, 1) : anchorCandidates,
      }, delta, traversalOverrides);

      if (exactWorld) {
        const attemptedVelocity = new THREE.Vector3().copy(traversal.velocity);
        const hit = exactWorld.sweepCapsule(beforeMotion, traversal.position, traversal.velocity);
        const position = hit.position;
        const velocity = hit.velocity;
        let wallSkimTriggered = false;
        meshWallContact = null;
        const blocked = Boolean(hit.wallNormal) || hit.blocked && !hit.grounded;
        if (hit.wallNormal) meshWallContact = { point: position.clone(), normal: hit.wallNormal, feetTouching: true, colliderId: 'rendered-facade' };
        // A feet-level probe maintains real facade contact at collision-skin distance.
        const previousWall = traversal.wall;
        const contactNormal = meshWallContact?.normal ?? previousWall?.normal;
        if (contactNormal) meshWallContact = probeWallFeet(position, contactNormal, raycastWorld) ?? meshWallContact;
        const support = velocity.y <= .1 ? meshSupportAt(position, .015, .51) : null;
        const supportY = support ? capsuleSupportHeight(support) : null;
        traversal.grounded = Boolean(supportY !== null && Math.abs(position.y - supportY) < .045);
        if (supportY !== null && traversal.grounded) {
          const exactSupport = position.clone();
          exactSupport.y = supportY;
          // Preserve the repeated-world solver's tiny clearance skin whenever
          // an imported map contains overlapping sidewalk shells.
          if (exactWorld.isCapsuleClear(exactSupport, .46, 2.05, false)) position.y = supportY;
          else position.y = Math.max(position.y, supportY);
          velocity.y = Math.max(0, velocity.y);
        }
        if (!wasGrounded && traversal.grounded) traversal.landingSeconds = .16;
        if (traversal.grounded) traversal.airSeconds = 0;
        setTraversalKinematics(traversal, position, velocity);
        if (meshWallContact) traversal.wall = { ...meshWallContact, feetTouching: meshWallContact.feetTouching === true, contactSeconds: previousWall?.contactSeconds ?? 0, graceSeconds: .14 };
        else traversal.wall = null;
        if (!meshWallContact) { traversal.wallCrawlActive = false; traversal.wallRunActive = false; }
        const wallApproachSpeed = hit.wallNormal ? -attemptedVelocity.dot(hit.wallNormal) : 0;
        const automaticWallAttach = hero.traversal === 'spider'
          && Boolean(hit.wallNormal && meshWallContact)
          && wallApproachSpeed > .35
          && traversal.wallAttachCooldownSeconds <= 0
          && !traversal.mantle
          && !frameInput.jumpPressed && !frameInput.zipPressed;
        if (automaticWallAttach && traversal.wall) {
          const interruptedSwing = Boolean(traversal.swing);
          const incomingSpeed = attemptedVelocity.length();
          traversal.swing = null;
          traversal.zip = null;
          traversal.mantle = null;
          pointerZipActive = false;
          traversal.swingNeedsRelease ||= interruptedSwing || swingHeld;
          traversal.swingRetryAfter = Math.max(traversal.swingRetryAfter ?? 0, elapsedTime + .18);
          traversal.wall.feetTouching = true;
          const normal = new THREE.Vector3(traversal.wall.normal.x, 0, traversal.wall.normal.z).normalize();
          const planeVelocity = attemptedVelocity.clone().addScaledVector(normal, -attemptedVelocity.dot(normal));
          if (planeVelocity.lengthSq() < .04) planeVelocity.set(0, 1, 0);
          velocity.copy(planeVelocity.normalize().multiplyScalar(Math.max(7, incomingSpeed)));
          traversal.grounded = false;
          traversal.wallCrawlActive = false;
          traversal.wallRunActive = true;
          wallSkimSeconds = 0;
          setTraversalKinematics(traversal, position, velocity);
          renderer.domElement.dataset.lastWallAttach = elapsedTime.toFixed(3);
          renderer.domElement.dataset.wallTraversalSource = 'impact';
        }
        if (hit.wallNormal && traversal.swing && swingHeld && !traversal.wallCrawlActive
          && elapsedTime >= wallSkimCooldownUntil) {
          const skim = calculateWallSkim(attemptedVelocity, hit.wallNormal, forward, 94);
          if (skim.eligible) {
            wallSkimNormal.copy(hit.wallNormal).normalize();
            wallSkimDirection.set(skim.direction.x, skim.direction.y, skim.direction.z).normalize();
            // Imported city meshes do not consistently wind their triangles, so a
            // contact normal can point into a building. Only accept an offset that
            // keeps the entire avatar capsule outside the exact render geometry.
            const positiveOffset = position.clone().addScaledVector(wallSkimNormal, .045);
            const negativeOffset = position.clone().addScaledVector(wallSkimNormal, -.045);
            if (exactWorld.isCapsuleClear(positiveOffset, .46, 2.05, false)) {
              position.copy(positiveOffset);
            } else if (exactWorld.isCapsuleClear(negativeOffset, .46, 2.05, false)) {
              position.copy(negativeOffset);
              wallSkimNormal.multiplyScalar(-1);
            }
            velocity.set(skim.velocity.x, skim.velocity.y, skim.velocity.z);
            traversal.grounded = false;
            traversal.landingSeconds = 0;
            traversal.swing = null;
            traversal.swingRetryAfter = elapsedTime + .18;
            traversal.wall = null;
            traversal.wallCrawlActive = false;
            traversal.wallRunActive = false;
            wallSkimSeconds = .38;
            wallSkimStrength = skim.strength;
            wallSkimCooldownUntil = elapsedTime + .52;
            wallSkimTriggered = true;
            setTraversalKinematics(traversal, position, velocity);
            renderer.domElement.dataset.lastWallSkim = elapsedTime.toFixed(3);
            renderer.domElement.dataset.wallSkimSpeed = velocity.length().toFixed(2);
          }
        }
        const swing = traversal.swing;
        if (swing) {
          const anchor = new THREE.Vector3().copy(swing.anchor);
          const line = anchor.clone().sub(position.clone().add(new THREE.Vector3(0, 1.3, 0)));
          const obstruction = raycastWorld(position.clone().add(new THREE.Vector3(0, 1.3, 0)), line.clone().normalize(), Math.max(0, line.length() - .1));
          const excess = position.distanceTo(anchor) - swing.ropeLength;
          const ropeTolerance = Math.max(.25, swing.ropeLength * .01);
          const groundContact = resolveSwingGroundContact({
            attemptedVelocity,
            sweptVelocity: velocity,
            grounded: traversal.grounded,
            swingHeld,
            obstructed: Boolean(obstruction),
            hitWall: Boolean(hit.wallNormal),
            anchorHeight: anchor.y - position.y,
            elevatedLaunch: position.y > 18,
            tension: swing.tension,
            attachedSeconds: swing.attachedSeconds,
          });
          const groundSkim = groundContact.active;
          if (groundSkim) {
            velocity.set(groundContact.velocity.x, groundContact.velocity.y, groundContact.velocity.z);
            traversal.grounded = !groundContact.liftOff;
            if (groundContact.liftOff) {
              // Cross the collision skin once. Subsequent height and velocity
              // come exclusively from the rope solver—never a per-frame hop.
              position.y += .012;
              traversal.landingSeconds = 0;
            }
            setTraversalKinematics(traversal, position, velocity);
            renderer.domElement.dataset.swingGroundEscape = groundContact.liftOff ? 'assisted-liftoff' : 'frictionless-skid';
            renderer.domElement.dataset.swingGroundRetainedSpeed = Math.hypot(velocity.x, velocity.z).toFixed(2);
          }
          const incompatibleContact = blocked && !groundSkim && excess > ropeTolerance;
          if (obstruction || traversal.grounded && !groundSkim || incompatibleContact) {
            traversal.swing = null;
            traversal.swingRetryAfter = traversal.elapsed + .2;
            renderer.domElement.dataset.swingDetachReason = obstruction ? 'blocked-web' : traversal.grounded ? 'landed' : 'solid-rope-conflict';
          } else if (excess > 0 && excess <= .5 && swing.ropeLength + excess <= swing.maximumLength) {
            // Pay out only measured numerical/contact clearance; never pull the
            // body back across a facade to satisfy the old rope projection.
            swing.ropeLength += excess;
          }
        }
        if (traversal.zip && blocked) {
          const toTarget = new THREE.Vector3().copy(traversal.zip.target).sub(position);
          if ((meshWallContact && velocity.dot(toTarget.clone().normalize()) < .5) || (traversal.grounded && toTarget.length() < 1.2)) {
            traversal.zip = null;
            pointerZipActive = false;
          }
        }
        if (blocked) buildingCorrectionCount++;
        result.context = refreshTraversalContext(traversal, frameInput, traversalOverrides);
        if (wallSkimSeconds > 0 || wallSkimTriggered) {
          const blend = clamp(wallSkimSeconds / .38, 0, 1);
          result.context.animation.state = 'wallRun';
          result.context.animation.bodyYaw = Math.atan2(-wallSkimDirection.x, -wallSkimDirection.z);
          result.context.animation.bodyPitch = -.08;
          result.context.animation.bodyRoll = clamp(wallSkimNormal.x * .18 + wallSkimDirection.z * .06, -.24, .24) * blend;
          result.context.animation.wallBlend = blend;
        }
        renderer.domElement.dataset.meshContacts = String(buildingCorrectionCount);
        renderer.domElement.dataset.spawnSurfaceVerified = String(Boolean(support));
      } else if (enforceBuildingSolidity(traversal.position, traversal.velocity, activeColliders)) {
        buildingCorrectionCount += 1;
        renderer.domElement.dataset.buildingCorrectionCount = String(buildingCorrectionCount);
      }

      player.position.set(traversal.position.x, traversal.position.y, traversal.position.z);
      player.velocity.set(traversal.velocity.x, traversal.velocity.y, traversal.velocity.z);
      player.grounded = traversal.grounded;
      if (trial) {
        trial.distance += player.position.distanceTo(trial.previous); trial.previous.copy(player.position);
        trial.peakSpeed = Math.max(trial.peakSpeed, player.velocity.length()); trial.peakHeight = Math.max(trial.peakHeight, player.position.y - trial.startY);
        if (!player.grounded) trial.air += delta;
        trial.attaches += result.events.filter(event => event.type === 'web-attached').length;
        if (meshWallContact) trial.contacts++;
        if (trial.elapsed >= trial.nextCheck && exactWorld) {
          trial.nextCheck = trial.elapsed + .2; trial.penetrationChecks++;
          if (!exactWorld.isCapsuleClear(player.position, .46, 2.05, false)) {
            trial.penetrations++;
            if (trial.penetrationDetails.length < 4) {
              const support = exactWorld.supportAt(player.position, .02, .6);
              trial.penetrationDetails.push({ position: player.position.toArray(), velocity: player.velocity.toArray(), surfaceClear: exactWorld.isCapsuleClear(player.position, .46, 2.05, false), support: support ? { point: support.point.toArray(), normal: support.normal.toArray() } : null });
            }
          }
        }
        const report = { map: currentDistrict, seconds: +trial.elapsed.toFixed(1), distance: +trial.distance.toFixed(1), peakSpeed: +trial.peakSpeed.toFixed(1), peakHeight: +trial.peakHeight.toFixed(1), airbornePercent: Math.round(100 * trial.air / trial.elapsed), attachments: trial.attaches, contactFrames: trial.contacts, penetrationChecks: trial.penetrationChecks, penetrations: trial.penetrations, penetrationDetails: trial.penetrationDetails };
        trialOutput.textContent = `${trial.elapsed < 16 ? 'Running' : 'Complete'}: ${JSON.stringify(report)}`;
        if (trial.elapsed >= 16) { trial = null; clearKeys(); }
      }
      if (hero.traversal === 'ironman' && player.grounded) ironFlightMode = 'grounded';
      player.facing = result.context.animation.bodyYaw;
      for (const traversalEvent of result.events) {
        if (process.env.NODE_ENV !== 'production') {
          renderer.domElement.dataset.lastTraversalEvent = traversalEvent.type;
          if (traversalEvent.type === 'jump') renderer.domElement.dataset.jumpCount = String(Number(renderer.domElement.dataset.jumpCount ?? 0) + 1);
          if (traversalEvent.type === 'double-jump') renderer.domElement.dataset.doubleJumpCount = String(Number(renderer.domElement.dataset.doubleJumpCount ?? 0) + 1);
        }
        if (traversalEvent.type === 'web-attached' && traversal.swing) {
          callbacksRef.current.onSwingAttached();
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
      wallCrawlPressed = false;
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
        traversal.wallCrawlActive = false;
        traversal.wallRunActive = false;
        traversal.mantle = null;
        meshWallContact = null;
        result.context = refreshTraversalContext(traversal, frameInput, traversalOverrides);
      }

      if (raceRoute.length) {
        // Update every frame so the first endpoint remains physically attached
        // to Spider-Man rather than being left at the previous checkpoint.
        showFinishGuide(player.position);
        const raceTime = elapsedTime - raceState.startedAt;
        sampleRaceTrack(raceSamples, {
          t: raceTime,
          x: player.position.x,
          y: player.position.y,
          z: player.position.z,
          yaw: player.facing,
          pose: networkPose(result.context.animation.state),
        });
        const gateRadius = clamp(getDistrict(currentDistrict).targetWidth / 60, 3.4, 6.2);
        const raceEvent = advanceSwingRace(raceState, player.position, raceRoute, elapsedTime, gateRadius);
        if (raceEvent) {
          raceMarkers.children.forEach((marker, index) => setCheckpointActive(marker as THREE.Group, index === raceState.checkpoint));
          showFinishGuide();
          if (raceEvent.finished && raceEvent.duration !== null) {
            lastRaceFinish = raceEvent.duration;
            raceLap += 1;
            const finishSample: RaceSample = {
              t: raceEvent.duration,
              x: player.position.x, y: player.position.y, z: player.position.z,
              yaw: player.facing,
              pose: networkPose(result.context.animation.state),
            };
            raceSamples.push(finishSample);
            if (!raceBest || raceEvent.duration < raceBest.duration) {
              raceBest = { duration: raceEvent.duration, samples: raceSamples.slice() };
              localStorage.setItem(raceStorageKey(currentDistrict, props.suitId), JSON.stringify(raceBest));
              renderer.domElement.dataset.raceBest = raceBest.duration.toFixed(3);
            }
            raceFinishVisibleUntil = elapsedTime + 2.4;
            resetRacePlayer(elapsedTime);
            result.context = refreshTraversalContext(traversal, frameInput, traversalOverrides);
            raceMarkers.children.forEach((marker, index) => setCheckpointActive(marker as THREE.Group, index === 0));
            showFinishGuide();
          }
        }
      }
      updateAvatar(delta, elapsedTime, result.context);
      if (raceGhost && raceBest) {
        const ghost = interpolateRaceSample(raceBest.samples, elapsedTime - raceState.startedAt);
        raceGhost.root.visible = Boolean(ghost);
        if (ghost) {
          raceGhost.root.position.set(ghost.x, ghost.y, ghost.z);
          raceGhost.root.rotation.y = ghost.yaw;
          raceGhost.animator.update(delta, {
            pose: networkPose(ghost.pose),
            grounded: ghost.pose === 'idle' || ghost.pose === 'run' || ghost.pose === 'land' || ghost.pose === 'perch',
            speed: ghost.pose === 'run' ? 10 : 28,
            verticalSpeed: 0,
          });
        }
      } else if (raceGhost) raceGhost.root.visible = false;
      updateRemoteAvatars(delta);
      if (multiplayer && elapsedTime - lastNetworkBroadcast >= .125) {
        lastNetworkBroadcast = elapsedTime;
        multiplayer.publish({
          suitId: props.suitId,
          position: [player.position.x, player.position.y, player.position.z],
          velocity: [player.velocity.x, player.velocity.y, player.velocity.z],
          yaw: player.facing,
          mode: hero.traversal === 'ironman' && !player.grounded ? `iron-${ironFlightMode === 'cruise' && pointerHeld ? 'boost' : ironFlightMode}`
            : avatarPose === 'perch' ? 'perch' : result.context.animation.state,
          sequence: ++networkSequence,
          sentAt: Date.now(),
        });
      }

      const grappleLineVisible = Boolean(traversal.zip && elapsedTime < grappleLineUntil);
      const webVisible = Boolean(traversal.swing || grappleLineVisible);
      webLine.visible = webVisible && !webStrand;
      if (webVisible) {
        const hand = avatar ? avatar.animator.webHand(new THREE.Vector3()) : player.position.clone().add(new THREE.Vector3(0, 1.58, 0));
        const webTarget = traversal.swing?.anchor ?? traversal.zip?.surfacePoint ?? traversal.zip?.target;
        if (webTarget) {
          webPositions.set([hand.x, hand.y, hand.z, webTarget.x, webTarget.y, webTarget.z]);
          webStrand?.update(hand, new THREE.Vector3(webTarget.x, webTarget.y, webTarget.z), true, traversal.swing?.tension ?? .82);
        }
        (webGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      } else webStrand?.update(player.position, player.position, false);
      const speed = result.context.speed;
      const yawDelta = Math.atan2(Math.sin(player.facing - previousPlayerYaw), Math.cos(player.facing - previousPlayerYaw));
      previousPlayerYaw = player.facing;
      const velocityDirection = player.velocity.clone().setY(0);
      if (velocityDirection.lengthSq() > .2) velocityDirection.normalize();
      const webLateral = traversal.swing
        ? new THREE.Vector3().copy(traversal.swing.anchor).sub(player.position).normalize().cross(velocityDirection).y
        : 0;
      const skimLateral = wallSkimSeconds > 0 ? Math.sign(wallSkimNormal.dot(right)) * .82 : 0;
      const cinematic = stepCinematicCamera(cinematicCamera, {
        mode: result.context.animation.state,
        speed,
        verticalSpeed: player.velocity.y,
        turnRate: yawDelta / Math.max(delta, 1 / 120),
        webLateral: webLateral || skimLateral,
        grounded: player.grounded,
        boostStrength: windBoostStrength,
        wallKick: wallSkimSeconds > 0 ? wallSkimStrength * clamp(wallSkimSeconds / .38, 0, 1) : 0,
      }, delta);
      if (elapsedTime > manualCameraUntil && velocityDirection.lengthSq() > .2 && wallCameraBlend < .2) {
        const travelYaw = Math.atan2(-velocityDirection.x, -velocityDirection.z);
        cameraYaw = dampYaw(cameraYaw, travelYaw, cinematic.followStrength, delta);
      }
      const perched = avatarPose === 'perch' && player.grounded;
      const ironCamera = hero.traversal === 'ironman';
      const baseDistance = perched ? 5.2 : ironCamera ? 5.4 + Math.min(speed / 72, 1) * 1.8 : Math.min(10, result.context.camera.followDistance);
      const distance = clamp(baseDistance + cinematic.distanceOffset, 4.2, 14.5);
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
      const wallCameraRequested = ((traversal.mode === 'wallCrawl' && traversal.wallCrawlActive)
        || (traversal.mode === 'wallRun' && traversal.wallRunActive))
        && Boolean(wallNormal);
      if (wallCameraRequested && wallNormal && !wallCameraWasRequested) {
        wallCameraNormal.copy(wallNormal);
        wallCameraYawAnchor = cameraYaw;
      }
      wallCameraWasRequested = wallCameraRequested;
      wallCameraBlend = damp(wallCameraBlend, wallCameraRequested ? 1 : 0, wallCameraRequested ? 8.5 : 10.5, delta);
      if (wallNormal) wallCameraNormal.lerp(wallNormal, 1 - Math.exp(-10 * delta)).normalize();
      const target = player.position.clone().add(new THREE.Vector3(
        result.context.camera.lookAhead.x * (ironCamera ? .08 : .28),
        1.35 + result.context.camera.lookAhead.y * .16,
        result.context.camera.lookAhead.z * (ironCamera ? .08 : .28),
      ));
      const nextCheckpoint = raceRoute[raceState.checkpoint];
      if (nextCheckpoint && wallCameraBlend < .25) {
        const checkpointDirection = nextCheckpoint.clone().sub(player.position);
        const checkpointDistance = checkpointDirection.length();
        if (checkpointDistance > .1) target.addScaledVector(
          checkpointDirection.normalize(),
          cinematic.checkpointLook * clamp(checkpointDistance / 28, .3, 1) * 5,
        );
      }
      if (perched && avatar) {
        // Collision-check the sightline to the actual crouched body, not to a
        // standing-height point above it. Otherwise a parapet can hide the
        // entire crouch while the old camera ray passes harmlessly overhead.
        const head = avatar.animator.bones.find((entry) => entry.role === 'head')?.bone;
        if (head) { avatar.root.updateMatrixWorld(true); head.getWorldPosition(target); }
        else target.copy(player.position).add(new THREE.Vector3(0, .7, 0));
      }
      const shake = Math.min(.11, result.context.camera.shake * .42 + cinematic.shake);
      const desired = player.position.clone().add(new THREE.Vector3(
        Math.sin(cameraYaw) * horizontalDistance + Math.sin(elapsedTime * 31) * shake,
        result.context.camera.heightOffset + cinematic.heightOffset + Math.sin(cameraPitch) * distance + Math.sin(elapsedTime * 27) * shake * .45,
        Math.cos(cameraYaw) * horizontalDistance,
      ));
      if (wallCameraBlend > .001) {
        const wallTarget = player.position.clone().add(new THREE.Vector3(0, 1.2, 0));
        const wallDesired = player.position.clone().add(
          wallCameraOffset(wallCameraNormal, cameraYaw - wallCameraYawAnchor, cameraPitch),
        );
        target.lerp(wallTarget, wallCameraBlend);
        desired.lerp(wallDesired, wallCameraBlend);
      }
      if (exactWorld) {
        const sight = desired.clone().sub(target);
        const obstruction = raycastWorld(target, sight.clone().normalize(), sight.length());
        if (obstruction) desired.copy(target).addScaledVector(sight.normalize(), Math.max(.4, obstruction.distance - .25));
      } else cameraAgainstWorld(target, desired, activeColliders);
      const cameraPositionDamping = cinematic.phase === 'zip'
        ? 19
        : cinematic.zoomDirection === 'out'
          ? 14
          : ironCamera ? 18 : 12;
      camera.position.lerp(desired, 1 - Math.exp(-cameraPositionDamping * delta));
      if (exactWorld) {
        // Damping itself must not carry the camera through a wall between two
        // otherwise clear chase positions (especially after map/spawn changes).
        const actualSight = camera.position.clone().sub(target);
        const obstruction = raycastWorld(target, actualSight.clone().normalize(), actualSight.length());
        if (obstruction) camera.position.copy(target).addScaledVector(actualSight.normalize(), Math.max(.12, obstruction.distance - .25));
      }
      const cinematicFov = clamp(result.context.camera.fov + cinematic.fovOffset * .86, 62, ironCamera ? 82 : 98);
      const fovDamping = cinematic.phase === 'zip'
        ? 18
        : cinematic.zoomDirection === 'out' || cinematic.phase === 'release' || windBoostStrength > .1
          ? 13
          : 7.5;
      camera.fov = damp(camera.fov, cinematicFov, fovDamping, delta);
      camera.updateProjectionMatrix();
      const cameraRoll = clamp(result.context.camera.roll * .55 + cinematic.roll, -.24, .24);
      const chaseUp = new THREE.Vector3(Math.sin(cameraRoll), Math.cos(cameraRoll), 0).normalize();
      const wallPerspectiveUp = wallCameraNormal.clone().setY(0).normalize();
      camera.up.copy(chaseUp).lerp(wallPerspectiveUp, wallCameraBlend).normalize();
      camera.lookAt(target);
      raceMarkers.children.forEach((marker, index) => {
        if (index !== raceState.checkpoint) return;
        marker.rotation.z += delta * 1.2;
        const pulse = 1 + Math.sin(elapsedTime * 5.2) * .045;
        const baseScale = clamp(getDistrict(currentDistrict).targetWidth / 75, 2.8, 5.4);
        marker.scale.setScalar(baseScale * pulse);
      });
      windTunnelVisuals.children.forEach((tunnel, tunnelIndex) => {
        tunnel.children.forEach((child) => {
          if (!(child instanceof THREE.Mesh) || child.userData.windPhase === undefined) return;
          const wave = .5 + .5 * Math.sin(elapsedTime * 7.5 - Number(child.userData.windPhase) * Math.PI * 2);
          child.scale.setScalar(1 + wave * .035 + (activeWindTunnel === tunnelIndex ? windBoostStrength * .045 : 0));
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach((material) => { material.opacity = .32 + wave * .32 + (activeWindTunnel === tunnelIndex ? .2 : 0); });
        });
      });
      updateTraffic(delta);
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
        const leadTraffic = trafficVehicles[0]?.root;
        if (leadTraffic) {
          renderer.domElement.dataset.trafficLeadPosition = leadTraffic.position.toArray().map((value) => value.toFixed(2)).join(',');
          renderer.domElement.dataset.trafficLeadGroundError = Math.abs(
            leadTraffic.position.y - (groundYAt(leadTraffic.position) + .025),
          ).toFixed(4);
          renderer.domElement.dataset.trafficVisibleCount = String(trafficVehicles.filter((vehicle) => vehicle.root.visible).length);
        }
        const checkpoint = raceRoute[raceState.checkpoint];
        let raceHud: RaceHud | null = null;
        if (checkpoint) {
          const dx = checkpoint.x - player.position.x;
          const dz = checkpoint.z - player.position.z;
          const targetYaw = Math.atan2(-dx, -dz);
          const elapsed = Math.max(0, elapsedTime - raceState.startedAt);
          const expectedBest = raceBest ? raceBest.duration * (raceState.checkpoint / Math.max(1, raceRoute.length)) : null;
          raceHud = {
            checkpoint: raceState.checkpoint + 1,
            total: raceRoute.length,
            lap: raceLap,
            elapsed,
            best: raceBest?.duration ?? null,
            delta: expectedBest === null ? null : elapsed - expectedBest,
            distance: Math.hypot(dx, checkpoint.y - player.position.y, dz),
            bearing: Math.atan2(Math.sin(targetYaw - cameraYaw), Math.cos(targetYaw - cameraYaw)),
            ghostActive: Boolean(raceBest),
            lastFinish: elapsedTime < raceFinishVisibleUntil ? lastRaceFinish : null,
          };
        }
        callbacksRef.current.onHud({
          speed: Math.round(speed * 3.6),
          altitude: Math.max(0, Math.round(player.position.y - groundY)),
          fps: measuredFps,
          swinging: Boolean(traversal.swing),
          boosting: windBoostStrength > .12,
          wallSkimming: wallSkimSeconds > 0,
          race: raceHud,
        });
        renderer.domElement.dataset.playerPosition = [player.position.x, player.position.y, player.position.z].map((value) => value.toFixed(2)).join(',');
        renderer.domElement.dataset.grounded = String(player.grounded);
        renderer.domElement.dataset.groundY = groundY.toFixed(3);
        renderer.domElement.dataset.walkableSurfaceCount = String(walkableSurfaces.size);
        renderer.domElement.dataset.traversalMode = traversal.mode;
        renderer.domElement.dataset.colliderCount = String(worldColliders.length + indexedColliderCount);
        renderer.domElement.dataset.anchorTargetCount = String(anchorTargets.size + indexedColliderCount);
        renderer.domElement.dataset.ropeLength = traversal.swing?.ropeLength.toFixed(2) ?? '';
        renderer.domElement.dataset.airJumpsRemaining = String(traversal.airJumpsRemaining);
        renderer.domElement.dataset.doubleJumpActive = String(traversal.doubleJumpSeconds > 0);
        renderer.domElement.dataset.swingTension = traversal.swing?.tension.toFixed(2) ?? '';
        renderer.domElement.dataset.windBoost = windBoostStrength.toFixed(2);
        renderer.domElement.dataset.activeWindTunnel = activeWindTunnel >= 0 ? String(activeWindTunnel + 1) : '';
        renderer.domElement.dataset.wallSkimActive = String(wallSkimSeconds > 0);
        renderer.domElement.dataset.cameraPhase = cinematic.phase;
        renderer.domElement.dataset.cameraFov = camera.fov.toFixed(2);
        renderer.domElement.dataset.cameraDistance = camera.position.distanceTo(target).toFixed(2);
        renderer.domElement.dataset.cameraZoomDirection = cinematic.zoomDirection;
        renderer.domElement.dataset.grappling = String(Boolean(pointerZipActive && traversal.zip));
        renderer.domElement.dataset.grappleLineVisible = String(grappleLineVisible);
        renderer.domElement.dataset.wallContact = traversal.wall ? `${traversal.wall.normal.x.toFixed(2)},${traversal.wall.normal.y.toFixed(2)},${traversal.wall.normal.z.toFixed(2)}` : '';
        renderer.domElement.dataset.wallCameraBlend = wallCameraBlend.toFixed(2);
        renderer.domElement.dataset.wallCameraState = wallCameraRequested ? 'facade' : wallCameraBlend > .03 ? 'returning' : 'world';
        renderer.domElement.dataset.wallCameraYawDelta = (cameraYaw - wallCameraYawAnchor).toFixed(2);
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
        await Promise.all([loadAvatar(), loadDistrict(initialDistrict), loadWebEffect()]);
        if (disposed) return;
        configureRaceCourse(initialDistrict, elapsedTime);
        player.position.copy(safeSpawn(initialDistrict));
        cameraYaw = spawnViewYaw(player.position, initialDistrict.spawnYaw ?? 0);
        traversal.heading = cameraYaw;
        player.facing = cameraYaw;
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
        if (!trialEnabled) connectMultiplayer();
        callbacksRef.current.onDistrictChange(initialDistrict.id);
        callbacksRef.current.onStatus(`${initialDistrict.name} route online`, 100);
        callbacksRef.current.onReady();
        // Traffic is decorative and intentionally streams after the playable
        // city is ready, so large downloaded vehicle textures never delay spawn.
        void loadTrafficSources().then(() => {
          if (!disposed) configureTraffic(getDistrict(currentDistrict));
        });
      } catch (error) {
        if (disposed) return;
        console.error('[game] unable to start SpiderMan city', error);
        callbacksRef.current.onStatus('Could not verify safe city surfaces. Reload to retry.', 100);
        ready = false;
      }
    };
    void setup();

    return () => {
      disposed = true;
      trialPanel?.remove();
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
      webStrand?.dispose();
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
