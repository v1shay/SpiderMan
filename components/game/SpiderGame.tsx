'use client';

import { hasWallRunSupport } from '@/lib/traversal-feel';
import {
  ADVANCED_TUNING,
  ADVANCED_TRAVERSAL_CONFIG as SPIDER_TRAVERSAL_FEEL,
} from '@/lib/traversal-advanced';
import {
  probeAdvancedWorld,
  probeLowObstacle,
  type FeatureQuery,
} from '@/lib/traversal-feature-world';
import { TraversalTetherVisual } from '@/lib/traversal-extras-visual';

import { clone as cloneRig } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  RaceSession,
  createRaceCourse,
  dailyRaceSeed,
  raceResultValue,
  type RaceCourse,
  type RaceMode,
  validRaceCourse,
  raceDistance,
  type RaceView,
  type RacePoint,
} from '@/lib/race-session';
import { sampleRaceInput } from '@/lib/race-input';
import { InputSystem, toTraversalInput } from '@/lib/input-system';
import { TraversalTelemetry } from '@/lib/telemetry';
import { RenderQualityManager } from '@/lib/render-quality';
import { TrickSystem } from '@/lib/trick-system';
import { MissionSystem, createCityMission, type MissionView } from '@/lib/mission-system';
import { MissionVisuals } from '@/lib/mission-visuals';
import { BossSystem, type BossSnapshot, type BossWorld } from '@/lib/boss-system';
import { BOSS_DEFINITIONS, type BossId } from '@/lib/boss-definitions';
import { BossVisuals } from '@/lib/boss-visuals';
import { verifyBlurColors } from '@/lib/render-verification';
import {
  GhostRecorder,
  poseGhost,
  loadGhost,
  saveGhost,
  readBest,
  readBestRun,
  isBetterRaceRun,
  storeBest,
  type GhostRecord,
  type GhostRig,
} from '@/lib/race-ghost';
import { RaceWorldVisuals, sampleWindAssist, createRaceGeometrySampler, raceRoutePoints } from '@/lib/race-world';
import { CityWeather, type SkyPreset } from '@/lib/city-weather';
import { CityHorizon } from '@/lib/city-horizon';
import { createCityAtmosphere } from '@/lib/city-atmosphere';
import { WebStrand, WEB_STRAND_MODEL } from '@/lib/web-strand';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  supportLegacyMaterials,
  calibrate2099Materials,
} from '@/lib/gltf-materials';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {
  getDistrict,
  getSuit,
  type DistrictConfig,
  type DistrictId,
  type SuitId,
} from '@/lib/game-config';
import {
  SpiderMultiplayer,
  type MultiplayerStatus,
  type NetworkPlayerState,
} from '@/lib/multiplayer';
import {
  createTraversalState,
  runTraversalPhysicsSelfTests,
  setTraversalKinematics,
  stepTraversalInPlace,
  refreshTraversalContext,
  acceptTraversalWallContact,
  resolveSwingContinuation,
  applyLandingRoll,
  type TraversalContext,
  type TraversalInput,
  type TraversalEvent,
  type TraversalConfig,
  commitAdvancedMotion,
  type SurfaceContact,
  type WebAnchorCandidate,
} from '@/lib/traversal-physics';
import {
  applySuitRestPose,
  normalizeSuit,
  suitAnimationClips,
  prepareMaterials,
  retargetMixamoClips,
  type ProceduralPose,
} from '@/lib/three-assets';
import { AvatarAnimator } from '@/lib/avatar-animation';
import {
  WorldMeshQuery,
  capsuleSupportHeight,
  type MeshSurfaceHit,
} from '@/lib/mesh-world';
import { RepeatingMeshWorld } from '@/lib/repeating-mesh-world';
import {
  createSwingAssistanceState,
  stepSwingAssistance,
} from '@/lib/swing-assistance';
import { WallPose } from '@/lib/wall-pose';
import { findMantleTarget, probeWallFeet } from '@/lib/wall-surface';
import { updateIronFlight, type IronFlightMode } from '@/lib/ironman-flight';
import { IronManRepulsors } from '@/lib/ironman-repulsors';
import { wallCameraOffset } from '@/lib/wall-camera';
import {
  predictTraversalLanding,
  hasRollCorridor,
} from '@/lib/traversal-prediction';
import {
  TraversalSpeedBlur,
  constrainCameraBoom,
} from '@/lib/traversal-camera';
import { findWallScenario, findRollScenario } from '@/lib/traversal-scenarios';

export type ActivityAction = 'hulk'|'venom'|'ironman'|'courier'|'rescue'|'style'|'retry'|'stop';
export type GameHud = {
  boss?: BossSnapshot | null;
  mission?: MissionView | null;
  activityMessage?: string;
  trickScore?: number;
  flowMultiplier?: number;
  speed: number;
  altitude: number;
  fps: number;
  swinging: boolean;
  mode: string;
  charge: number;
  chargeLabel: string;
  announcement: HudTrick | null;
  callout: {
    x: number;
    y: number;
    side: 'left' | 'right';
  };
};
export type HudTrick = {
  id: number;
  label: string;
  score: number;
  multiplier: number;
  kind: 'air' | 'web' | 'glide' | 'impact';
};
export type RaceAction = 'invite' | 'accept' | 'decline' | 'cancel' | 'pb' | 'restart' | 'daily' | 'mode-speed' | 'mode-style' | 'mode-combined';
export type MapPlayer = { id: string; position: RacePoint; self: boolean };
export type SpiderGameHandle = {
  travelTo: (id: DistrictId) => void;
  switchSuit: (id: SuitId) => void;
  raceAction: (action: RaceAction) => void;
  activityAction: (action: ActivityAction) => void;
};

type Props = {
  night?: boolean;
  sky?: SkyPreset;
  experimentalCamera?: boolean;
  cameraZoom?: number;
  paused?: boolean;
  onRaceView?: (view: RaceView) => void;
  onMapPlayers?: (players: MapPlayer[]) => void;
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
  animationAccumulator: number;
};

type StreamedTile = {
  root: THREE.Group;
  anchorProxy: THREE.Object3D | null;
  walkables: THREE.Object3D[];
  x: number;
  z: number;
};

type DistrictStream = {
  horizon: CityHorizon;
  template: THREE.Group;
  anchorTemplate: THREE.Object3D | null;
  baseColliders: THREE.Box3[];
  tileWidth: number;
  tileDepth: number;
  tiles: Map<string, StreamedTile>;
  centerX: number;
  centerZ: number;
};

const networkPose = (mode: string): ProceduralPose =>
  mode === 'glide'
    ? 'fly'
    : mode === 'iron-hover'
      ? 'hover'
      : mode === 'iron-cruise' || mode === 'iron-boost'
        ? 'fly'
        : mode === 'iron-freefall'
          ? 'fall'
          : mode === 'swing'
            ? 'swing'
            : mode === 'webZip' || mode === 'pointLaunch'
              ? 'zip'
              : mode === 'wallRun'
                ? 'wall'
                : mode === 'wallCrawl'
                  ? 'crawl'
                  : mode === 'dive'
                    ? 'dive'
                    : mode === 'run'
                      ? 'run'
                      : mode === 'perch'
                        ? 'perch'
                        : mode === 'fall'
                          ? 'fall'
                          : mode === 'idle' || mode === 'land'
                            ? 'idle'
                            : 'jump';

const GROUND_Y = 0.12;
const COLLIDER_CELL_SIZE = 48;
const districtSpawn = (district: DistrictConfig) => {
  const local = new THREE.Vector3(
    district.spawn?.[0] ?? 0,
    0,
    district.spawn?.[1] ?? 0,
  ).applyAxisAngle(new THREE.Vector3(0, 1, 0), district.rotation ?? 0);
  return new THREE.Vector3(
    district.position[0] + local.x,
    GROUND_Y,
    district.position[2] + local.z,
  );
};
const cameraCollisionBox = new THREE.Box3();
const cameraCollisionHit = new THREE.Vector3();
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const damp = (from: number, to: number, lambda: number, delta: number) =>
  THREE.MathUtils.lerp(from, to, 1 - Math.exp(-lambda * delta));
const dampYaw = (from: number, to: number, lambda: number, delta: number) =>
  from +
  Math.atan2(Math.sin(to - from), Math.cos(to - from)) *
    (1 - Math.exp(-lambda * delta));
const colliderCellKey = (x: number, z: number) => `${x}:${z}`;

function addSpatialCollider(
  index: Map<string, THREE.Box3[]>,
  collider: THREE.Box3,
) {
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

function transformSourceCollider(
  source: readonly number[],
  scale: number,
  modelOffset: THREE.Vector3,
  config: DistrictConfig,
) {
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
      context.fillStyle = `rgba(${shade},${shade + 2},${shade + 4},${0.08 + seeded(index + 77) * 0.18})`;
      const size = 1 + Math.floor(seeded(index + 101) * 3);
      context.fillRect(
        seeded(index + 33) * 512,
        seeded(index + 61) * 512,
        size,
        size,
      );
    }
    context.strokeStyle = 'rgba(12,16,20,.14)';
    context.lineWidth = 1;
    for (let crack = 0; crack < 4; crack += 1) {
      context.beginPath();
      context.moveTo(seeded(crack + 400) * 512, seeded(crack + 500) * 512);
      for (let segment = 0; segment < 3; segment += 1) {
        context.lineTo(
          seeded(crack * 17 + segment + 600) * 512,
          seeded(crack * 23 + segment + 700) * 512,
        );
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
        const lit = seeded(variant * 1000 + floor * 19 + column * 7) > 0.68;
        context.fillStyle = lit ? palettes.light : palettes.dark;
        context.fillRect(x, y, 20, 16);
        context.fillStyle = lit
          ? 'rgba(255,255,255,.24)'
          : 'rgba(95,170,205,.09)';
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
  [-196, -224],
  [-84, -224],
  [84, -224],
  [196, -224],
  [-252, -96],
  [-140, -96],
  [140, -96],
  [252, -96],
  [-196, 32],
  [-84, 32],
  [84, 32],
  [196, 32],
  [-252, 160],
  [-140, 160],
  [0, 160],
  [140, 160],
  [252, 160],
  [-196, 224],
  [-84, 224],
  [84, 224],
  [196, 224],
] as const;

function distributeLandmarks(model: THREE.Group, root: THREE.Group) {
  const landmarks = model.children.filter((object) => {
    let containsMesh = false;
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) containsMesh = true;
    });
    return containsMesh;
  });
  model.updateWorldMatrix(true, true);
  const ranked = landmarks
    .map((object) => ({
      object,
      height: new THREE.Box3()
        .setFromObject(object)
        .getSize(new THREE.Vector3()).y,
    }))
    .sort((a, b) => a.height - b.height);
  const rank = new Map(
    ranked.map((entry, index) => [
      entry.object,
      index / Math.max(1, ranked.length - 1),
    ]),
  );
  const boxes: THREE.Box3[] = [];

  landmarks.forEach((object, index) => {
    let box = new THREE.Box3().setFromObject(object);
    let size = box.getSize(new THREE.Vector3());
    const stature = rank.get(object) ?? 0;
    const targetHeight = 62 + stature * 96 + seeded(index + 1300) * 12;
    const targetFootprint = 20 + seeded(index + 1500) * 12;
    const footprintScale = clamp(
      targetFootprint / Math.max(size.x, size.z, 0.1),
      0.62,
      2.15,
    );
    object.scale.x *= footprintScale;
    object.scale.z *= footprintScale;
    object.scale.y *= targetHeight / Math.max(size.y, 0.1);
    object.updateWorldMatrix(true, true);

    box = new THREE.Box3().setFromObject(object);
    size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const slot = landmarkSlots[index % landmarkSlots.length];
    const desired = root.localToWorld(new THREE.Vector3(slot[0], 0, slot[1]));
    const deltaWorld = new THREE.Vector3(
      desired.x - center.x,
      desired.y - box.min.y,
      desired.z - center.z,
    );
    const inverseModel = model.matrixWorld.clone().invert();
    const localOrigin = new THREE.Vector3().applyMatrix4(inverseModel);
    const localDelta = deltaWorld
      .clone()
      .applyMatrix4(inverseModel)
      .sub(localOrigin);
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
  const landmarkClearance = landmarkBounds.map((bounds) =>
    bounds.clone().expandByScalar(12),
  );

  let index = 0;
  for (let gridX = -5; gridX < 5; gridX += 1) {
    for (let gridZ = -4; gridZ < 4; gridZ += 1) {
      const x = (gridX + 0.5) * cellX;
      const z = (gridZ + 0.5) * cellZ;
      const width = cellX - roadX - 2 - seeded(index + 20) * 5;
      const depth = cellZ - roadZ - 2 - seeded(index + 40) * 6;
      const skylineBand = 1 - Math.min(1, Math.hypot(x, z) / half);
      const height = 34 + seeded(index + 60) * 50 + skylineBand * 34;
      const worldCenter = new THREE.Vector3(x, height / 2, z)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), config.rotation ?? 0)
        .add(new THREE.Vector3(...config.position));
      const collider = new THREE.Box3(
        new THREE.Vector3(
          worldCenter.x - width / 2,
          0,
          worldCenter.z - depth / 2,
        ),
        new THREE.Vector3(
          worldCenter.x + width / 2,
          height + 0.4,
          worldCenter.z + depth / 2,
        ),
      );
      index += 1;
      if (landmarkClearance.some((bounds) => collider.intersectsBox(bounds)))
        continue;

      const facadeMatrix = new THREE.Matrix4().compose(
        new THREE.Vector3(x, height / 2, z),
        quaternion,
        new THREE.Vector3(width, height, depth),
      );
      const roofMatrix = new THREE.Matrix4().compose(
        new THREE.Vector3(x, height + 0.2, z),
        quaternion,
        new THREE.Vector3(width + 0.35, 0.4, depth + 0.35),
      );
      buildings.push({
        collider,
        facadeMatrix,
        roofMatrix,
        variant: Math.floor(seeded(index + 800) * 4),
      });
    }
  }

  const district = new THREE.Group();
  district.name = 'Collision-safe Manhattan swing grid';
  const facadeGeometry = new THREE.BoxGeometry(1, 1, 1);
  const roofGeometry = new THREE.BoxGeometry(1, 1, 1);
  for (let variant = 0; variant < 4; variant += 1) {
    const variantBuildings = buildings.filter(
      (building) => building.variant === variant,
    );
    if (!variantBuildings.length) continue;
    const facade = new THREE.InstancedMesh(
      facadeGeometry,
      new THREE.MeshStandardMaterial({
        map: createFacadeTexture(variant),
        color: '#ffffff',
        roughness: 0.78,
        metalness: 0.05,
      }),
      variantBuildings.length,
    );
    const roof = new THREE.InstancedMesh(
      roofGeometry,
      new THREE.MeshStandardMaterial({
        color: ['#243542', '#4b403b', '#38444a', '#303c58'][variant],
        roughness: 0.9,
        metalness: 0.03,
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
    new THREE.BoxGeometry(roadX + 8, 0.035, extent),
    new THREE.MeshBasicMaterial({ color: '#202b34' }),
  );
  avenue.position.y = 0.012;
  avenue.name = 'Central swing avenue';
  district.add(avenue);
  root.add(district);
  return {
    colliders: buildings.map((building) => building.collider),
    extent,
    buildingCount: buildings.length,
  };
}

function createColliderAnchorProxy(
  colliders: readonly THREE.Box3[],
  name: string,
) {
  const proxyMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  proxyMaterial.colorWrite = false;
  const proxy = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    proxyMaterial,
    colliders.length,
  );
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

function addAuthoredMapFloor(
  root: THREE.Group,
  width: number,
  depth: number,
  name: string,
) {
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(width + 12, 0.28, depth + 12),
    new THREE.MeshBasicMaterial({
      map: createAsphaltTexture(),
      color: '#d7dce0',
    }),
  );
  floor.position.y = -0.16;
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
  const road = clamp(
    shortSide * 0.18,
    Math.min(2, shortSide * 0.2),
    shortSide * 0.45,
  );
  const blockWidth = Math.max(2, (width - road) / 2);
  const blockDepth = Math.max(2, (depth - road) / 2);
  const proxyMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  proxyMaterial.colorWrite = false;
  for (const xSign of [-1, 1]) {
    for (const zSign of [-1, 1]) {
      const x = config.position[0] + xSign * (road / 2 + blockWidth / 2);
      const z = config.position[2] + zSign * (road / 2 + blockDepth / 2);
      const box = new THREE.Box3(
        new THREE.Vector3(x - blockWidth / 2, 0, z - blockDepth / 2),
        new THREE.Vector3(
          x + blockWidth / 2,
          Math.max(12, height),
          z + blockDepth / 2,
        ),
      );
      colliders.push(box);
      const proxy = new THREE.Mesh(
        new THREE.BoxGeometry(blockWidth, Math.max(12, height), blockDepth),
        proxyMaterial,
      );
      proxy.position.set(x, Math.max(12, height) / 2, z);
      proxy.name = `${config.name} building collision`;
      scene.add(proxy);
      anchors.add(proxy);
    }
  }
}

function cameraAgainstWorld(
  target: THREE.Vector3,
  desired: THREE.Vector3,
  colliders: readonly THREE.Box3[],
) {
  const direction = desired.clone().sub(target);
  const distance = direction.length();
  if (distance < 0.001) return desired;
  const ray = new THREE.Ray(target, direction.normalize());
  let nearest = distance;
  for (const collider of colliders) {
    cameraCollisionBox.copy(collider).expandByScalar(0.3);
    const point = ray.intersectBox(cameraCollisionBox, cameraCollisionHit);
    if (point) nearest = Math.min(nearest, point.distanceTo(target) - 0.3);
  }
  if (nearest < distance)
    desired.copy(target).addScaledVector(direction, Math.max(1.4, nearest));
  desired.y = Math.max(1.15, desired.y);
  return desired;
}

function enforceBuildingSolidity(
  position: { x: number; y: number; z: number },
  velocity: { x: number; y: number; z: number },
  colliders: readonly THREE.Box3[],
) {
  const radius = 0.46;
  let corrected = false;
  for (const collider of colliders) {
    if (position.y > collider.max.y + 1.7 || position.y + 1.8 < collider.min.y)
      continue;
    // The traversal solver deliberately lands on collider tops. Do not run the
    // horizontal penetration fallback against a player standing on a rooftop.
    if (position.y >= collider.max.y - 0.08) continue;
    const minX = collider.min.x - radius;
    const maxX = collider.max.x + radius;
    const minZ = collider.min.z - radius;
    const maxZ = collider.max.z + radius;
    if (
      position.x <= minX ||
      position.x >= maxX ||
      position.z <= minZ ||
      position.z >= maxZ
    )
      continue;
    const exits = [
      {
        distance: position.x - minX,
        axis: 'x' as const,
        value: minX,
        normal: -1,
      },
      {
        distance: maxX - position.x,
        axis: 'x' as const,
        value: maxX,
        normal: 1,
      },
      {
        distance: position.z - minZ,
        axis: 'z' as const,
        value: minZ,
        normal: -1,
      },
      {
        distance: maxZ - position.z,
        axis: 'z' as const,
        value: maxZ,
        normal: 1,
      },
    ].sort((a, b) => a.distance - b.distance);
    const exit = exits[0];
    position[exit.axis] = exit.value;
    if (velocity[exit.axis] * exit.normal < 0) velocity[exit.axis] = 0;
    corrected = true;
  }
  return corrected;
}

function chooseRooftopSpawn(
  config: DistrictConfig,
  colliders: readonly THREE.Box3[],
  bounds: THREE.Box3,
  query: WorldMeshQuery,
) {
  const highest = query.findHighestRoofSpawn();
  if (highest) return highest;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const viable = colliders.filter((collider) => {
    const footprint = collider.getSize(new THREE.Vector3());
    return (
      collider.max.y > GROUND_Y + 4 && footprint.x > 1.2 && footprint.z > 1.2
    );
  });
  const central = viable.filter((collider) => {
    const colliderCenter = collider.getCenter(new THREE.Vector3());
    return (
      Math.abs(colliderCenter.x - center.x) < Math.max(8, size.x * 0.34) &&
      Math.abs(colliderCenter.z - center.z) < Math.max(8, size.z * 0.34)
    );
  });
  const candidates = [
    ...central.sort((a, b) => b.max.y - a.max.y),
    ...viable
      .filter((box) => !central.includes(box))
      .sort((a, b) => b.max.y - a.max.y),
  ];
  const roof = query.findRoofSpawn(candidates);
  if (!roof)
    throw new Error(
      `${config.name} has no verified clear, rendered rooftop spawn`,
    );
  return roof;
}

export const SpiderGame = forwardRef<SpiderGameHandle, Props>(
  function SpiderGame(props, ref) {
    const mountRef = useRef<HTMLDivElement>(null);
    const travelRef = useRef<(id: DistrictId) => void>(() => undefined);
    const switchSuitRef = useRef<(id: SuitId) => void>(() => undefined);
    const raceActionRef = useRef<(action: RaceAction) => void>(() => undefined);
    const activityActionRef = useRef<(action: ActivityAction) => void>(() => undefined);
    const callbacksRef = useRef(props);
    useEffect(() => {
      callbacksRef.current = props;
    }, [props]);
    useImperativeHandle(
      ref,
      () => ({
        travelTo: (id) => travelRef.current(id),
        switchSuit: (id) => switchSuitRef.current(id),
        raceAction: (action) => raceActionRef.current(action),
        activityAction: (action) => activityActionRef.current(action),
      }),
      [],
    );

    useEffect(() => {
      const mount = mountRef.current;
      if (!mount) return;
      let disposed = false;
      let frameId = 0;
      let ready = false;
      let activeSuitId = props.suitId;
      let avatarLoadGeneration = 0;
      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog('#9acbe3', 1000, 2600);
      const atmosphere = createCityAtmosphere(scene);
      const weather = new CityWeather(scene);
      const camera = new THREE.PerspectiveCamera(66, 1, 0.08, 2800);
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      renderer.shadowMap.enabled = false;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      const speedBlur = new TraversalSpeedBlur();
      const reducedMotion = matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      renderer.domElement.className = 'game-canvas';
      renderer.domElement.tabIndex = 0;
      renderer.domElement.setAttribute(
        'aria-label',
        'Playable 3D SpiderMan city',
      );
      if (process.env.NODE_ENV !== 'production') {
        renderer.domElement.dataset.collisionSelfTest = String(
          runTraversalPhysicsSelfTests().passed,
        );
      }
      mount.appendChild(renderer.domElement);
      scene.add(new THREE.AmbientLight('#9bc9e8', 0.42));
      const skyFill = new THREE.HemisphereLight('#b7c9e4', '#443347', 1.55);
      scene.add(skyFill);
      const rim = new THREE.DirectionalLight('#829dff', 0.7);
      rim.position.set(120, 65, -120);
      scene.add(rim);
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
      const raycastWorld = (
        origin: THREE.Vector3,
        direction: THREE.Vector3,
        maximum: number,
        minNormalY?: number,
      ): MeshSurfaceHit | null => {
        return (
          repeatingWorlds
            .get(currentDistrict)
            ?.raycast(origin, direction, maximum, minNormalY) ?? null
        );
      };
      const meshSupportAt = (
        position: { x: number; y: number; z: number },
        rise = 0.12,
        drop = 0.25,
      ) =>
        raycastWorld(
          new THREE.Vector3(position.x, position.y + rise, position.z),
          new THREE.Vector3(0, -1, 0),
          rise + drop,
          0.65,
        );
      const spawnViewYaw = (position: THREE.Vector3, preferred = 0) => {
        const origin = position.clone().add(new THREE.Vector3(0, 0.65, 0));
        let best = preferred,
          bestScore = -Infinity;
        for (let index = 0; index < 16; index++) {
          const yaw = preferred + (index * Math.PI) / 8;
          const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
          const view = raycastWorld(origin, forward, 100)?.distance ?? 100;
          const behind = new THREE.Vector3(
            Math.sin(yaw) * 5.2,
            2.1,
            Math.cos(yaw) * 5.2,
          );
          const clearance =
            raycastWorld(origin, behind.clone().normalize(), behind.length())
              ?.distance ?? behind.length();
          const score =
            (clearance >= 5.2 ? 1000 : 0) +
            view +
            clearance * 10 -
            index * 0.01;
          if (score > bestScore) {
            best = yaw;
            bestScore = score;
          }
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
        const surface = groundRaycaster.intersectObjects(
          walkableSurfaceList,
          false,
        )[0];
        const groundY = surface ? surface.point.y : GROUND_Y;
        if (groundHeightCache.size > 8000) groundHeightCache.clear();
        groundHeightCache.set(cacheKey, groundY);
        return groundY;
      };
      let indexedColliderCount = 0;
      const nearbyColliders = (
        position: { x: number; y: number; z: number },
        radius = 42,
      ) => {
        const result = new Set<THREE.Box3>(worldColliders);
        const minX = Math.floor((position.x - radius) / COLLIDER_CELL_SIZE);
        const maxX = Math.floor((position.x + radius) / COLLIDER_CELL_SIZE);
        const minZ = Math.floor((position.z - radius) / COLLIDER_CELL_SIZE);
        const maxZ = Math.floor((position.z + radius) / COLLIDER_CELL_SIZE);
        for (let x = minX; x <= maxX; x += 1) {
          for (let z = minZ; z <= maxZ; z += 1) {
            for (const collider of spatialColliders.get(
              colliderCellKey(x, z),
            ) ?? [])
              result.add(collider);
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
            const dx = Math.max(
              collider.min.x - point.x,
              0,
              point.x - collider.max.x,
            );
            const dz = Math.max(
              collider.min.z - point.z,
              0,
              point.z - collider.max.z,
            );
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
        const maximumRadius = Math.min(120, district.targetWidth * 0.28);
        const radiusStep = Math.max(0.75, Math.min(8, maximumRadius / 4));
        const boundsInset = Math.min(4, district.targetWidth * 0.04);
        for (
          let radius = radiusStep;
          radius <= maximumRadius;
          radius += radiusStep
        ) {
          for (let step = 0; step < 32; step += 1) {
            const angle = (step / 32) * Math.PI * 2;
            const candidate = desired
              .clone()
              .add(
                new THREE.Vector3(
                  Math.cos(angle) * radius,
                  0,
                  Math.sin(angle) * radius,
                ),
              );
            if (
              bounds &&
              (candidate.x < bounds.min.x + boundsInset ||
                candidate.x > bounds.max.x - boundsInset ||
                candidate.z < bounds.min.z + boundsInset ||
                candidate.z > bounds.max.z - boundsInset)
            )
              continue;
            const candidateClearance = clearance(candidate);
            if (candidateClearance >= requiredClearance) {
              candidate.y = groundYAt(candidate);
              return candidate;
            }
            const score = candidateClearance - radius * 0.006;
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
      const loader = supportLegacyMaterials(new GLTFLoader());
      loader.setMeshoptDecoder(MeshoptDecoder);
      const inputSystem = new InputSystem();
      const keys = inputSystem.raw.keys;
      const telemetry = new TraversalTelemetry();
      const quality = new RenderQualityManager();
      const tricks = new TrickSystem();
      const missions = new MissionSystem();
      const missionVisuals = new MissionVisuals(scene);
      let activityMessage = '';
      let interactPressed = false;
      const bosses = new BossSystem();
      const bossVisuals = new BossVisuals(scene);
      let bossLoadingGeneration = 0;
      let bossAttackPressed = false;
      let bossHeavyPressed = false;
      let bossLauncherPressed = false;
      let bossGrabPressed = false;
      let bossDodgePressed = false;
      let bossWebPressed = false;
      let bossTauntPressed = false;
      let bossCheckpointPlayer: THREE.Vector3 | null = null;
      const bossWorld: BossWorld = {
        groundAt: (point) => {
          const world = repeatingWorlds.get(currentDistrict);
          const hit = world?.supportAt(point, 1.5, 40);
          return hit ? capsuleSupportHeight(hit, .8) : null;
        },
        move: (from, to, radius) => {
          const world = repeatingWorlds.get(currentDistrict);
          if (!world) return {...from};
          const height = BOSS_DEFINITIONS[bosses.snapshot()?.id ?? 'hulk'].height;
          const hit = world.sweepCapsule(from,to,{x:to.x-from.x,y:to.y-from.y,z:to.z-from.z},radius,height);
          return {x:hit.position.x,y:hit.position.y,z:hit.position.z};
        },
        lineOfSight: (from,to) => {
          const ray = new THREE.Vector3().copy(to).sub(from), distance = ray.length();
          return distance < .1 || !raycastWorld(new THREE.Vector3().copy(from),ray.normalize(),distance-.08);
        },
      };
      const initialDistrict = getDistrict(props.districtId);
      const initialSpawn = districtSpawn(initialDistrict);
      const player = {
        position: initialSpawn.clone(),
        velocity: new THREE.Vector3(),
        facing: 0,
        grounded: true,
      };
      const traversal = createTraversalState(player.position, player.velocity);
      traversal.grounded = true;
      traversal.mode = 'idle';
      let rollPressed = false;
      let trickRequest = 0;
      let landingPrediction = { time: 0, clear: false };
      let predictionAfter = 0;
      let cameraRoll = 0;
      let cameraBoomDistance = 7;
      let cameraYaw = initialDistrict.spawnYaw ?? 0;
      let cameraPitch = initialDistrict.spawnPitch ?? 0.08;
      let wallCameraBlend = 0;
      let combatCameraBlend = 0;
      let wallCameraYawAnchor = cameraYaw;
      let wallCameraWasRequested = false;
      const wallCameraNormal = new THREE.Vector3(0, 0, 1);
      let avatar: AvatarRig | null = null;
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
      let hudAccumulator = 0;
      let fpsAccumulator = 0;
      let fpsFrames = 0;
      let measuredFps = 60;
      let buildingCorrectionCount = 0;
      let telemetryAt = 0;
      let lastFrameTime = performance.now();
      let wasPaused = false;
      let elapsedTime = 0;
      let visualTime = 0;
      let pausedVisualSky: SkyPreset | null = null;
      let pausedVisualNight: boolean | null = null;
      let jumpPressed = false;
      let glidePressed = false,
        chargeJumpReleased = false,
        slingshotReleased = false,
        cancelAbilities = false;
      let featureProbeAfter = 0;
      let featureQuery: FeatureQuery = {
        slingshotAnchors: null,
        cornerTarget: null,
      };
      let wallCrawlPressed = false;
      let zipPressed = false;
      let pointerHeld = false;
      let pointerPressed = false;
      let pointerReleased = false;
      let hudAnnouncement: HudTrick | null = null;
      let hudAnnouncementAt = -10;
      const trickQueue: HudTrick[] = [];
      let trickProbeAt = 0;
      let trickClearance = {left: 100, right: 100};
      let lastTrickSpeed = 0;

      let pointerZipActive = false;
      let grappleLineUntil = -1;
      let pointerPressure: number | undefined;
      let measuredPressure = false;

      let hoverTogglePressed = false;
      let cruiseTogglePressed = false;
      let ironFlightMode: IronFlightMode = 'grounded';

      const swingAssistance = createSwingAssistanceState();
      let anchorSearchAt = -10;
      let cachedAnchors: WebAnchorCandidate[] = [];
      const anchorSearchPosition = new THREE.Vector3(
        Infinity,
        Infinity,
        Infinity,
      );
      const anchorSearchAim = new THREE.Vector2(Infinity, Infinity);
      let meshWallContact: SurfaceContact | null = null;
      const pointerNdc = new THREE.Vector2(0, 0);
      const raycaster = new THREE.Raycaster();
      raycaster.far = 360;
      const webPositions = new Float32Array(6);
      const webGeometry = new THREE.BufferGeometry();
      webGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(webPositions, 3),
      );
      const webLine = new THREE.Line(
        webGeometry,
        new THREE.LineBasicMaterial({
          color: '#e6fbff',
          transparent: true,
          opacity: 0.94,
        }),
      );
      webLine.visible = false;
      webLine.frustumCulled = false;
      scene.add(webLine);
      let webStrand: WebStrand | null = null;
      const webTargetPoint = new THREE.Vector3();
      const extraTethers = new TraversalTetherVisual(scene);
      const resize = () => {
        const width = Math.max(1, mount.clientWidth);
        const height = Math.max(1, mount.clientHeight);
        renderer.setSize(width, height, false);
        const drawingSize = renderer.getDrawingBufferSize(new THREE.Vector2());
        speedBlur.resize(drawingSize.x, drawingSize.y);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      resize();
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(mount);
      const notifyLoaded = () =>
        callbacksRef.current.onLoadedDistricts(new Set(loadedDistricts));

      const loadModel = <T,>(
        url: string,
        label: string,
        start: number,
        end: number,
        report = true,
      ) =>
        new Promise<T>((resolve, reject) => {
          loader.load(
            url,
            (gltf) => resolve(gltf as T),
            (event) => {
              const ratio =
                event.total > 0
                  ? event.loaded / event.total
                  : Math.min(0.92, event.loaded / 20_000_000);
              if (report)
                callbacksRef.current.onStatus(
                  `Streaming ${label}`,
                  start + (end - start) * clamp(ratio, 0, 1),
                );
            },
            reject,
          );
        });

      let race: RaceSession | null = null;
      let recorder: GhostRecorder | null = null,
        ghostRecord: GhostRecord | null = null,
        ghostRig: GhostRig | null = null;
      let ghostSave: Promise<void> = Promise.resolve();
      let ghostLoadGeneration = 0;
      let lastRaceSide = -1;
      let selectedRaceMode: RaceMode = 'speed';
      let raceCourseId = '',
        raceBest: number | null = null,
        raceMessage = 'Own the skyline',
        raceHudAt = 0,
        windActive = false;
      const raceVisuals = new RaceWorldVisuals(scene);
      const raceNow = () => performance.timeOrigin + performance.now();
      const removeGhost = () => {
        ghostLoadGeneration++;
        if (!ghostRig) return;
        ghostRig.root.removeFromParent();
        ghostRig.model.traverse((o) => {
          if (o instanceof THREE.Mesh)
            (Array.isArray(o.material) ? o.material : [o.material]).forEach(
              (m) => m.dispose(),
            );
        });
        ghostRig = null;
      };
      const prepareRaceCourse = () => {
        if (!race?.course || !avatar || race.course.id === raceCourseId) return;
        const course = race.course,
          world = repeatingWorlds.get(currentDistrict);
        if (!world) return;
        raceCourseId = course.id;
        raceBest = readBest(course.id);
        race.bestSplits = readBestRun(course.id)?.splits ?? [];
        raceVisuals.setCourse(course, world);
        ghostRecord = null;
        removeGhost();
        const loadGeneration = ghostLoadGeneration;
        void ghostSave.then(() => loadGhost(course.id))
          .then((record) => {
            if (
              disposed ||
              loadGeneration !== ghostLoadGeneration ||
              race?.course?.id !== course.id ||
              !record ||
              !avatar
            )
              return;
            ghostRecord = record;
            const model = cloneRig(avatar.model);
            model.traverse((o) => {
              if (!(o instanceof THREE.Mesh)) return;
              o.material = new THREE.MeshBasicMaterial({
                color: '#8beaff',
                transparent: true,
                opacity: 0.24,
                depthWrite: false,
              });
              o.frustumCulled = false;
            });
            const root = new THREE.Group(),
              surfaceFrame = new THREE.Group();
            surfaceFrame.add(model);
            root.add(surfaceFrame);
            scene.add(root);
            root.visible = false;
            ghostRig = { root, surfaceFrame, model };
          })
          .catch(() => {
            raceMessage = 'PB ready · ghost storage unavailable';
          });
      };
      const removeRemoteAvatar = (playerId: string) => {
        const remote = remoteAvatars.get(playerId);
        if (!remote) return;
        scene.remove(remote.root);
        remote.root.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.geometry.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((material) => material.dispose());
        });
        remoteAvatars.delete(playerId);
      };

      const clearRemoteAvatars = () => {
        for (const playerId of remoteAvatars.keys())
          removeRemoteAvatar(playerId);
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
          const gltf = await loadModel<{
            scene: THREE.Group;
            animations: THREE.AnimationClip[];
          }>(suit.model, `${suit.name} network avatar`, 0, 0, false);
          if (disposed) return;
          const latest = remoteStates.get(state.playerId);
          if (
            !latest ||
            latest.suitId !== suit.id ||
            latest.districtId !== currentDistrict
          )
            return;
          prepareMaterials(gltf.scene, renderer, 'character');
          calibrate2099Materials(gltf.scene);
          const clips = suitAnimationClips(gltf.animations, suit);
          applySuitRestPose(gltf.scene, suit, clips);
          if (suit.animationSource && suit.animationSource !== suit.model) {
            const library = await loadModel<{
              scene: THREE.Group;
              animations: THREE.AnimationClip[];
            }>(suit.animationSource, 'network traversal library', 0, 0, false);
            if (disposed || !remoteStates.has(state.playerId)) return;
            clips.push(
              ...retargetMixamoClips(
                library.animations,
                library.scene,
                gltf.scene,
              ),
            );
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
            new THREE.RingGeometry(0.72, 0.82, 32),
            new THREE.MeshBasicMaterial({
              color: '#44e5ff',
              transparent: true,
              opacity: 0.72,
              side: THREE.DoubleSide,
            }),
          );
          marker.rotation.x = -Math.PI / 2;
          marker.position.y = 0.025;
          marker.name = 'Network player marker';
          root.add(marker);
          scene.add(root);
          const animator = new AvatarAnimator(gltf.scene, suit, clips);
          remoteAvatars.set(state.playerId, {
            root,
            surfaceFrame,
            wallPose: new WallPose(gltf.scene, suit.id),
            animator,
            repulsors:
              suit.traversal === 'ironman'
                ? new IronManRepulsors(root, animator.bones)
                : null,
            velocity: new THREE.Vector3().fromArray(latest.velocity),
            targetPosition: new THREE.Vector3().fromArray(latest.position),
            targetYaw: latest.yaw,
            mode: latest.mode,
            suitId: latest.suitId,
            lastSequence: latest.sequence,
            lastUpdate: performance.now(),
            animationAccumulator: 0,
          });
        })()
          .catch((error) =>
            console.info('[multiplayer] remote avatar unavailable', error),
          )
          .finally(() => {
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
          remote.root.position.lerp(
            remote.targetPosition,
            1 - Math.exp(-12 * delta),
          );
          remote.root.rotation.y = dampYaw(
            remote.root.rotation.y,
            remote.targetYaw,
            12,
            delta,
          );
          remote.animationAccumulator += delta;
          const animateRemote = remote.animationAccumulator >= 1 / quality.settings.secondaryAnimationHz;
          if (animateRemote) remote.wallPose.reset(remote.surfaceFrame);
          const crawling = remote.mode === 'wallCrawl';
          const ironCruise =
            remote.mode === 'iron-cruise' || remote.mode === 'iron-boost';
          remote.root.rotation.x = damp(
            remote.root.rotation.x,
            remote.mode === 'glide'
              ? -Math.atan2(
                  remote.velocity.y,
                  Math.hypot(remote.velocity.x, remote.velocity.z),
                )
              : ironCruise
                ? -1.1 * remote.animator.cruiseBlend
                : 0,
            7,
            delta,
          );
          if (animateRemote) remote.animator.update(remote.animationAccumulator, {
            pose: networkPose(remote.mode),
            mode: remote.mode,
            grounded: ['idle', 'land', 'perch', 'run'].includes(remote.mode),
            speed: crawling
              ? remote.velocity.length()
              : Math.hypot(remote.velocity.x, remote.velocity.z),
            verticalSpeed: remote.velocity.y,
            boost: remote.mode === 'iron-boost',
            crawlDirection: remote.velocity.y < -0.1 ? -1 : 1,
          });
          if (animateRemote) remote.animationAccumulator = 0;
          remote.repulsors?.update(
            ironCruise || remote.mode === 'iron-hover',
            remote.velocity.length(),
            remote.mode === 'iron-boost',
            elapsedTime,
          );
          if (crawling && animateRemote) {
            const normal = new THREE.Vector3(
              Math.sin(remote.targetYaw),
              0,
              Math.cos(remote.targetYaw),
            );
            const contact = probeWallFeet(
              remote.root.position,
              normal,
              raycastWorld,
            );
            if (contact)
              remote.wallPose.apply(
                remote.surfaceFrame,
                remote.animator.bones,
                contact,
              );
          }
        }
      };

      const reportMultiplayer = () => {
        callbacksRef.current.onOnlineCount(
          multiplayerStatus === 'online' ? onlinePeerCount + 1 : 1,
          multiplayerStatus,
        );
        renderer.domElement.dataset.multiplayerStatus = multiplayerStatus;
        renderer.domElement.dataset.onlinePlayers = String(
          multiplayerStatus === 'online' ? onlinePeerCount + 1 : 1,
        );
      };

      const connectMultiplayer = () => {
        multiplayer = SpiderMultiplayer.create(activeSuitId, currentDistrict, {
          onPlayerState: ensureRemoteAvatar,
          onRacePacket: (packet) => {
            const world = repeatingWorlds.get(currentDistrict);
            if (
              packet.course &&
              (!world ||
                !world.isCapsuleClear(
                  new THREE.Vector3().fromArray(packet.course.start),
                ) ||
                !world.isCapsuleClear(
                  new THREE.Vector3().fromArray(packet.course.finish),
                ))
            )
              return;
            if (packet.course?.mapId && packet.course.mapId !== currentDistrict) return;
            race?.receive(packet, raceNow());
            if (!race?.course) {raceVisuals.clear();removeGhost();ghostRecord=null;recorder=null;raceCourseId='';}
            else prepareRaceCourse();
          },
          onPeers: (peerIds) => {
            onlinePeerCount = peerIds.size;
            for (const id of remoteStates.keys())
              if (!peerIds.has(id)) remoteStates.delete(id);
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
        if (multiplayer) void multiplayer.join(currentDistrict, activeSuitId);
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

      const mountStreamedTile = (
        stream: DistrictStream,
        x: number,
        z: number,
      ) => {
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
        root.updateMatrixWorld(true);

        const anchorProxy = stream.anchorTemplate
          ? isOrigin
            ? stream.anchorTemplate
            : stream.anchorTemplate.clone()
          : null;
        if (anchorProxy) {
          anchorProxy.position.set(
            x * stream.tileWidth,
            0,
            z * stream.tileDepth,
          );
          scene.add(anchorProxy);
          anchorTargets.add(anchorProxy);
          anchorTargetList = [...anchorTargets];
        }

        const walkables = tileWalkables(root);
        for (const surface of walkables) walkableSurfaces.add(surface);
        walkableSurfaceList = [...walkableSurfaces];
        stream.tiles.set(key, { root, anchorProxy, walkables, x, z });
      };

      const unmountStreamedTile = (
        stream: DistrictStream,
        tile: StreamedTile,
      ) => {
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

      const updateWorldStreaming = (
        district: DistrictId,
        position: THREE.Vector3,
      ) => {
        const stream = districtStreams.get(district);
        if (!stream) return;
        const config = getDistrict(district);
        const centerX = Math.round(
          (position.x - config.position[0]) / stream.tileWidth,
        );
        const centerZ = Math.round(
          (position.z - config.position[2]) / stream.tileDepth,
        );
        const desired = new Set<string>([tileKey(centerX, centerZ)]);
        const localX =
          position.x - config.position[0] - centerX * stream.tileWidth;
        const localZ =
          position.z - config.position[2] - centerZ * stream.tileDepth;
        const edgeX =
          Math.abs(localX) > stream.tileWidth * 0.3 ? Math.sign(localX) : 0;
        const edgeZ =
          Math.abs(localZ) > stream.tileDepth * 0.3 ? Math.sign(localZ) : 0;
        if (edgeX) desired.add(tileKey(centerX + edgeX, centerZ));
        if (edgeZ) desired.add(tileKey(centerX, centerZ + edgeZ));
        if (edgeX && edgeZ)
          desired.add(tileKey(centerX + edgeX, centerZ + edgeZ));

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
        stream.horizon.update(camera, position, stream.tiles);
        renderer.domElement.dataset.horizonTileCount = String(
          stream.horizon.root.userData.tileCount,
        );
        stream.centerX = centerX;
        stream.centerZ = centerZ;
        renderer.domElement.dataset.streamCenter = `${centerX}:${centerZ}`;
        renderer.domElement.dataset.streamedTileCount = String(
          stream.tiles.size,
        );
      };

      const loadDistrict = (config: DistrictConfig, report = true) => {
        const existing = districtPromises.get(config.id);
        if (existing) return existing;
        let modelPromise = districtModelPromises.get(config.model);
        if (!modelPromise)
          modelPromise = (async () => {
            if (report)
              callbacksRef.current.onStatus(
                `Opening route to ${config.name}`,
                loadedDistricts.size ? 84 : 28,
              );
            const gltf = await loadModel<{ scene: THREE.Group }>(
              config.model,
              config.name,
              loadedDistricts.size ? 84 : 28,
              loadedDistricts.size ? 98 : 78,
              report,
            );
            if (disposed) throw new Error('Game disposed');
            const model = gltf.scene;
            // The City Night environment ships with a sample rigged Spider-Man.
            // It is scenery, not the selected playable avatar, so remove it before
            // bounds, collision, and material preparation are calculated.
            if (config.id === 'city-night') {
              const embeddedCharacters: THREE.SkinnedMesh[] = [];
              model.traverse((object) => {
                if (object instanceof THREE.SkinnedMesh)
                  embeddedCharacters.push(object);
              });
              for (const character of embeddedCharacters)
                character.parent?.remove(character);
            }
            model.traverse((object) => {
              if (!(object instanceof THREE.Mesh)) return;
              const materials = Array.isArray(object.material)
                ? object.material
                : [object.material];
              const materialNames = materials
                .map((material) => material.name)
                .join(' ');
              const sourceBox = new THREE.Box3().setFromObject(object);
              object.userData.walkableStreetSurface =
                config.id === 'new-york-city' &&
                sourceBox.max.y < (config.sourceGroundY ?? 0) + 1.5 &&
                /citygen_streets|side_walks|citygen_curb|citygen_grass/i.test(
                  materialNames,
                );
            });
            prepareMaterials(model, renderer, 'baked');
            model.updateWorldMatrix(true, true);
            let box = new THREE.Box3().setFromObject(model);
            const sourceSize = box.getSize(new THREE.Vector3());
            const horizontal = Math.max(sourceSize.x, sourceSize.z, 0.001);
            const modelScale = config.targetWidth / horizontal;
            model.scale.setScalar(modelScale);
            model.updateWorldMatrix(true, true);
            box = new THREE.Box3().setFromObject(model);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            // Align each asset's authored road plane. Bounding-box minima often belong
            // to basements/scan debris and were the source of the underground starts.
            model.position.set(
              -center.x,
              -config.sourceGroundY * modelScale,
              -center.z,
            );
            const root = new THREE.Group();
            root.name = `District: ${config.name}`;
            root.position.set(...config.position);
            root.rotation.y = config.rotation ?? 0;
            root.add(model);
            if (config.id !== currentDistrict)
              root.traverse((object) => object.layers.set(31));
            scene.add(root);
            root.updateWorldMatrix(true, true);
            const landmarkBoxes =
              config.id === 'new-york-buildings'
                ? distributeLandmarks(model, root)
                : [new THREE.Box3().setFromObject(model)];
            const landmarkBounds = landmarkBoxes.reduce(
              (combined, bounds) => combined.union(bounds),
              new THREE.Box3().makeEmpty(),
            );
            districtBounds.set(config.id, landmarkBounds.clone());
            model.traverse((object) => {
              if (object.userData.walkableStreetSurface)
                walkableSurfaces.add(object);
            });
            const authoredFloorExtent =
              config.id === 'new-york-buildings' ? 560 : 0;
            walkableSurfaces.add(
              addAuthoredMapFloor(
                root,
                Math.max(size.x, authoredFloorExtent),
                Math.max(size.z, authoredFloorExtent),
                config.name,
              ),
            );
            walkableSurfaceList = [...walkableSurfaces];
            const baseColliders: THREE.Box3[] = [];
            let anchorTemplate: THREE.Object3D | null = null;
            let detailedColliderCount = 0;
            const usesCollisionMetadata = Boolean(
              config.collisionData && config.id !== 'new-york-buildings',
            );
            if (config.collisionData && usesCollisionMetadata) {
              const response = await fetch(config.collisionData);
              if (!response.ok)
                throw new Error(
                  `Collision data unavailable: ${response.status}`,
                );
              const metadata = (await response.json()) as CollisionMetadata;
              const collisionScale = config.targetWidth / metadata.sourceWidth;
              const proxyGeometry = new THREE.BoxGeometry(1, 1, 1);
              const proxyMaterial = new THREE.MeshBasicMaterial({
                transparent: true,
                opacity: 0,
                depthWrite: false,
              });
              proxyMaterial.colorWrite = false;
              const proxy = new THREE.InstancedMesh(
                proxyGeometry,
                proxyMaterial,
                metadata.colliders.length,
              );
              proxy.name = `${config.name} collision and web anchors`;
              const matrix = new THREE.Matrix4();
              const center = new THREE.Vector3();
              const colliderSize = new THREE.Vector3();
              let proxyIndex = 0;
              for (const sourceCollider of metadata.colliders) {
                const collider = transformSourceCollider(
                  sourceCollider,
                  collisionScale,
                  model.position,
                  config,
                );
                // Ground slabs and shallow curbs belong to the walkable plane, not
                // the building solver. Treating them as walls traps the avatar and
                // causes the repeated correction/sticking failure seen on imports.
                if (collider.max.y <= GROUND_Y + 0.75) continue;
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
              const positionCount =
                object.geometry.getAttribute('position')?.count ?? 0;
              if (
                !usesCollisionMetadata &&
                positionCount > 0 &&
                positionCount < 180_000
              )
                anchorTargets.add(object);
              if (usesCollisionMetadata) return;
              if (positionCount <= 0 || positionCount >= 180_000) return;
              const meshBox = new THREE.Box3().setFromObject(object);
              const meshSize = meshBox.getSize(new THREE.Vector3());
              const isSolidBuildingPart =
                meshSize.y > 2.4 &&
                meshSize.x > 1 &&
                meshSize.z > 1 &&
                meshSize.x < config.targetWidth * 0.72 &&
                meshSize.z < config.targetWidth * 0.72;
              if (!isSolidBuildingPart) return;
              worldColliders.push(meshBox);
              baseColliders.push(meshBox);
              detailedColliderCount += 1;
            });
            const landmarkColliderCount = detailedColliderCount;
            let proceduralExtent = 0;
            if (config.id === 'new-york-buildings') {
              const procedural = addProceduralSwingDistrict(
                root,
                config,
                landmarkBoxes,
              );
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
              renderer.domElement.dataset.proceduralBuildingCount = String(
                procedural.buildingCount,
              );
              renderer.domElement.dataset.clickableRooftopCount = String(
                procedural.buildingCount,
              );
              renderer.domElement.dataset.landmarkColliderCount = String(
                landmarkColliderCount,
              );
            }
            districtBounds.set(config.id, new THREE.Box3().setFromObject(root));
            const rotatedWidth = Math.max(
              proceduralExtent,
              Math.abs(Math.cos(root.rotation.y)) * size.x +
                Math.abs(Math.sin(root.rotation.y)) * size.z,
            );
            const rotatedDepth = Math.max(
              proceduralExtent,
              Math.abs(Math.sin(root.rotation.y)) * size.x +
                Math.abs(Math.cos(root.rotation.y)) * size.z,
            );
            const hasElevatedRooftop = baseColliders.some((collider) => {
              const footprint = collider.getSize(new THREE.Vector3());
              return (
                collider.max.y > GROUND_Y + 4 &&
                footprint.x > 1.2 &&
                footprint.z > 1.2
              );
            });
            if (detailedColliderCount < 4 || !hasElevatedRooftop) {
              const beforeFallback = worldColliders.length;
              addLandmarkColliders(
                scene,
                worldColliders,
                anchorTargets,
                config,
                rotatedWidth,
                rotatedDepth,
                size.y,
              );
              baseColliders.push(...worldColliders.slice(beforeFallback));
            }
            const finalDistrictBounds =
              districtBounds.get(config.id) ??
              new THREE.Box3().setFromObject(root);
            const query = await WorldMeshQuery.fromObject(root, {
              onProgress: (ratio) => {
                if (report && !disposed)
                  callbacksRef.current.onStatus(
                    `Building ${config.name} surface collisions`,
                    80 + ratio * 15,
                  );
              },
            });
            if (disposed) throw new Error('Game disposed');
            meshQueries.set(config.id, query);
            renderer.domElement.dataset.meshTriangles = String(
              query.triangleCount,
            );
            renderer.domElement.dataset.meshCollisionMb = (
              query.byteLength / 1048576
            ).toFixed(2);
            const rooftopSpawn = chooseRooftopSpawn(
              config,
              baseColliders,
              finalDistrictBounds,
              query,
            );
            districtRooftopSpawns.set(config.id, rooftopSpawn);
            renderer.domElement.dataset.spawnSurfaceVerified = String(
              query.hasSurface(rooftopSpawn) &&
                query.isCapsuleClear(rooftopSpawn),
            );
            if (config.id === currentDistrict) {
              renderer.domElement.dataset.spawnMode = 'highest-rooftop';
              renderer.domElement.dataset.rooftopSpawn = rooftopSpawn
                .toArray()
                .map((value) => value.toFixed(2))
                .join(',');
            }
            anchorTargetList = [...anchorTargets];
            const baseWalkables = tileWalkables(root);
            weather.apply(root);
            const distant = await loadModel<{ scene: THREE.Group }>(
              config.horizonModel!,
              `${config.name} skyline`,
              95,
              99,
              report,
            );
            if (disposed) throw new Error('Game disposed');
            const horizon = new CityHorizon(
              distant.scene,
              model.matrixWorld,
              root,
              Math.max(8, rotatedWidth + 8),
              Math.max(8, rotatedDepth + 8),
            );
            weather.apply(horizon.root);
            if (config.id !== currentDistrict)
              horizon.root.traverse((object) => object.layers.set(31));
            scene.add(horizon.root);
            districtStreams.set(config.id, {
              horizon,
              template: root,
              anchorTemplate,
              baseColliders,
              // Leave a narrow street-width seam between repeated imports. Several
              // source scans have facade collision right on their bounds; abutting
              // those bounds exactly makes the expanded player capsule overlap two
              // tiles at once. The authored floor overhang bridges this seam.
              tileWidth: Math.max(8, rotatedWidth + 8),
              tileDepth: Math.max(8, rotatedDepth + 8),
              tiles: new Map([
                [
                  tileKey(0, 0),
                  {
                    root,
                    anchorProxy: anchorTemplate,
                    walkables: baseWalkables,
                    x: 0,
                    z: 0,
                  },
                ],
              ]),
              centerX: 0,
              centerZ: 0,
            });
            repeatingWorlds.set(
              config.id,
              new RepeatingMeshWorld(
                query,
                Math.max(8, rotatedWidth + 8),
                Math.max(8, rotatedDepth + 8),
              ),
            );
            updateWorldStreaming(config.id, rooftopSpawn);
            return root;
          })();
        districtModelPromises.set(config.model, modelPromise);
        const promise = modelPromise
          .then((root) => {
            loadedDistricts.add(config.id);
            notifyLoaded();
            if (report && config.id === currentDistrict)
              callbacksRef.current.onStatus(`${config.name} online`, 100);
            return root;
          })
          .catch((error) => {
            if (disposed) throw error;
            districtPromises.delete(config.id);
            if (districtModelPromises.get(config.model) === modelPromise)
              districtModelPromises.delete(config.model);
            console.error(`[city] unable to stream ${config.name}`, error);
            if (report)
              callbacksRef.current.onStatus(
                `${config.name} unavailable — connected street grid remains active`,
                100,
              );
            throw error;
          });
        districtPromises.set(config.id, promise);
        return promise;
      };

      const disposeAvatar = (target: AvatarRig | null) => {
        if (!target) return;
        target.animator.mixer.stopAllAction();
        target.root.removeFromParent();
        target.root.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.geometry.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((material) => material.dispose());
        });
      };

      const loadAvatar = async (suitId: SuitId = activeSuitId) => {
        const generation = ++avatarLoadGeneration;
        const suit = getSuit(suitId);
        callbacksRef.current.onStatus(`Syncing ${suit.name} rig`, 4);
        const gltf = await loadModel<{
          scene: THREE.Group;
          animations: THREE.AnimationClip[];
        }>(suit.model, `${suit.name} suit`, 4, 42);
        if (disposed || generation !== avatarLoadGeneration) return;
        prepareMaterials(gltf.scene, renderer, 'character');
        calibrate2099Materials(gltf.scene);
        const authoredClips = suitAnimationClips(gltf.animations, suit);
        // Calibrate exporter-specific horizontal/crouched skeletons to their
        // actual standing reference before borrowing local-space limb motion.
        applySuitRestPose(gltf.scene, suit, authoredClips);
        const clips = [...authoredClips];
        if (suit.animationSource && suit.animationSource !== suit.model) {
          callbacksRef.current.onStatus(
            `Calibrating ${suit.name} traversal rig`,
            43,
          );
          const library = await loadModel<{
            scene: THREE.Group;
            animations: THREE.AnimationClip[];
          }>(
            suit.animationSource,
            `${suit.name} traversal library`,
            43,
            58,
            false,
          );
          clips.push(
            ...retargetMixamoClips(
              library.animations,
              library.scene,
              gltf.scene,
            ),
          );
        }
        if (disposed || generation !== avatarLoadGeneration) return;
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
        const repulsors =
          suit.traversal === 'ironman'
            ? new IronManRepulsors(root, animator.bones)
            : null;
        const nextAvatar: AvatarRig = {
          root,
          model: gltf.scene,
          animator,
          surfaceFrame,
          wallPose: new WallPose(gltf.scene, suit.id),
          repulsors,
        };
        nextAvatar.animator.update(0.18, {
          pose: 'perch',
          grounded: true,
          speed: 0,
          verticalSpeed: 0,
        });
        const previousAvatar = avatar;
        avatar = nextAvatar;
        activeSuitId = suit.id;
        disposeAvatar(previousAvatar);
        renderer.domElement.dataset.suit = suit.id;
        renderer.domElement.dataset.animationClips = animator.clips
          .map((clip) => clip.name)
          .join('|');
        renderer.domElement.dataset.rigRoles = [
          ...new Set(animator.bones.map((entry) => entry.role)),
        ].join('|');
        callbacksRef.current.onStatus(`${suit.name} ready`, 100);
      };

      switchSuitRef.current = (id: SuitId) => {
        if (id === activeSuitId) return;
        void loadAvatar(id).then(() => {
          if (disposed || activeSuitId !== id) return;
          clearRemoteAvatars();
          if (multiplayer) void multiplayer.join(currentDistrict, activeSuitId);
        });
      };

      const loadWebVisual = async () => {
        const gltf = await loadModel<{ scene: THREE.Group }>(
          WEB_STRAND_MODEL,
          'authored Spider-Man web',
          0,
          0,
          false,
        );
        if (disposed) return;
        webStrand = new WebStrand(gltf.scene);
        scene.add(webStrand.group);
        renderer.domElement.dataset.webVisual = 'downloaded-spiderman-web';
      };

      const readPointer = (event: MouseEvent) => {
        const bounds = renderer.domElement.getBoundingClientRect();
        if (document.pointerLockElement === renderer.domElement)
          pointerNdc.set(0, 0);
        else
          pointerNdc.set(
            ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
            -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
          );
        const pressure =
          'pressure' in event && typeof event.pressure === 'number'
            ? event.pressure
            : 0;
        if (pressure > 0 && Math.abs(pressure - 0.5) > 0.015)
          measuredPressure = true;
        if (measuredPressure && pressure > 0)
          pointerPressure = clamp(pressure, 0.1, 1);
        inputSystem.setPressure(pointerPressure);
      };

      const collectAnchorCandidates = (ndc: THREE.Vector2) => {
        if (
          elapsedTime - anchorSearchAt < 0.08 &&
          anchorSearchPosition.distanceToSquared(player.position) < 4 &&
          anchorSearchAim.distanceToSquared(ndc) < 0.002 &&
          !zipPressed
        ) {
          const chest = player.position
            .clone()
            .add(new THREE.Vector3(0, 1.3, 0));
          const valid = cachedAnchors.filter((candidate) => {
            const direction = new THREE.Vector3()
              .copy(candidate.point)
              .sub(chest);
            const distance = direction.length();
            return (
              distance > 3 &&
              !raycastWorld(
                chest,
                direction.normalize(),
                Math.max(0, distance - 0.08),
              )
            );
          });
          if (valid.length) return valid;
        }
        anchorSearchAt = elapsedTime;
        anchorSearchPosition.copy(player.position);
        anchorSearchAim.copy(ndc);
        const candidates: WebAnchorCandidate[] = [];
        cachedAnchors = candidates;
        if (meshQueries.has(currentDistrict)) {
          const chest = new THREE.Vector3(
            traversal.position.x,
            traversal.position.y + 1.3,
            traversal.position.z,
          );
          const addSurface = (hit: MeshSurfaceHit | null, weight: number) => {
            if (!hit) return;
            const offset = hit.point.clone().sub(chest);
            const distance = offset.length();
            if (distance < 3 || distance > 150) return;
            const obstruction = raycastWorld(
              chest,
              offset.normalize(),
              Math.max(0, distance - 0.08),
            );
            if (obstruction) return;
            candidates.push({
              id: `mesh:${hit.triangleIndex}:${hit.point.x.toFixed(1)}:${hit.point.z.toFixed(1)}`,
              point: hit.point.clone(),
              normal: hit.normal.clone(),
              kind: hit.normal.y > 0.65 ? 'roof' : 'facade',
              lineOfSight: true,
              weight,
            });
          };
          for (const [x, y, weight] of [
            [ndc.x, ndc.y, 1.35],
            [ndc.x - 0.16, ndc.y + 0.15, 0.95],
            [ndc.x + 0.16, ndc.y + 0.15, 0.95],
            [ndc.x - 0.32, ndc.y + 0.32, 0.8],
            [ndc.x + 0.32, ndc.y + 0.32, 0.8],
          ]) {
            raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
            addSurface(
              raycastWorld(raycaster.ray.origin, raycaster.ray.direction, 150),
              weight,
            );
          }
          if (swingHeldForAssist()) {
            // Imported cities need not contain hand-authored anchor tags. Search
            // elevated facades alongside the travel corridor, then require actual
            // visible triangle contact. Never attach to a proxy or empty sky.
            const heading = cameraYaw;
            const supportBelow = meshSupportAt(traversal.position, 0.2, 180);
            const altitude = supportBelow
              ? Math.max(0, traversal.position.y - supportBelow.point.y)
              : 0;
            const elevations = altitude > 14 || traversal.velocity.y < -8
              ? [-0.16, 0.1, 0.34, 0.62, 0.92]
              : [0.34, 0.58, 0.87, 1.13];
            for (const elevation of elevations)
              for (const side of [-1.65, -1.2, -0.6, 0, 0.6, 1.2, 1.65]) {
                const yaw = heading + side;
                const direction = new THREE.Vector3(
                  -Math.sin(yaw) * Math.cos(elevation),
                  Math.sin(elevation),
                  -Math.cos(yaw) * Math.cos(elevation),
                );
                addSurface(
                  raycastWorld(chest, direction, 145),
                  1 + Math.max(-0.04, elevation * 0.12),
                );
              }
          }
          // Proxy boxes only suggest search directions. Every accepted assist
          // point is replaced by a visible triangle hit with clear player LOS.
          if (!candidates.length || swingHeldForAssist()) {
            for (const box of nearbyColliders(traversal.position, 92)) {
              if (box.max.y < chest.y + 2) continue;
              const target = box.clampPoint(chest, new THREE.Vector3());
              target.y = clamp(chest.y + 22, box.min.y + 2, box.max.y - 0.1);
              const direction = target.sub(chest);
              if (direction.lengthSq() < 9 || direction.lengthSq() > 92 * 92)
                continue;
              const aim = new THREE.Vector3(
                -Math.sin(cameraYaw),
                0,
                -Math.cos(cameraYaw),
              );
              if (direction.clone().normalize().dot(aim) < -0.1) continue;
              addSurface(raycastWorld(chest, direction.normalize(), 92), 0.8);
              if (candidates.length >= 14) break;
            }
          }
          renderer.domElement.dataset.lastAnchorCandidateCount = String(
            candidates.length,
          );
          renderer.domElement.dataset.lastAnchorCandidate = candidates[0]
            ? [
                candidates[0].point.x,
                candidates[0].point.y,
                candidates[0].point.z,
              ]
                .map((value) => value.toFixed(2))
                .join(',')
            : '';
          renderer.domElement.dataset.anchorValidation = 'rendered-mesh-los';
          return candidates;
        }
        const samples = [
          ndc,
          new THREE.Vector2(ndc.x - 0.11, ndc.y + 0.05),
          new THREE.Vector2(ndc.x + 0.11, ndc.y + 0.05),
        ];
        const localFacades = nearbyColliders(traversal.position, 180);
        for (let index = 0; index < samples.length; index += 1) {
          raycaster.setFromCamera(samples[index], camera);
          // Preserve the actual pointed-at surface for web zips, including roofs
          // below a tallest-building spawn. Swing selection applies its own
          // height rule later, so this does not create downward swing anchors.
          const meshHit = raycaster
            .intersectObjects(anchorTargetList, true)
            .find((item) => item.distance > 5 && item.distance < 170);
          let point = meshHit?.point;
          if (!point) {
            let nearestDistance = Infinity;
            for (const collider of localFacades) {
              const facadeBounds = new THREE.Box3(
                new THREE.Vector3(
                  collider.min.x,
                  collider.min.y,
                  collider.min.z,
                ),
                new THREE.Vector3(
                  collider.max.x,
                  collider.max.y,
                  collider.max.z,
                ),
              );
              const collisionPoint = raycaster.ray.intersectBox(
                facadeBounds,
                new THREE.Vector3(),
              );
              if (!collisionPoint) continue;
              const distance = collisionPoint.distanceTo(camera.position);
              if (
                distance > 5 &&
                distance < 170 &&
                distance < nearestDistance
              ) {
                nearestDistance = distance;
                point = collisionPoint.clone();
              }
            }
          }
          if (!point) {
            let bestAlignment = 0.42;
            const playerPoint = new THREE.Vector3(
              traversal.position.x,
              traversal.position.y,
              traversal.position.z,
            );
            for (const collider of localFacades) {
              if (collider.max.y <= traversal.position.y + 4) continue;
              const surfacePoint = collider.clampPoint(
                playerPoint,
                new THREE.Vector3(),
              );
              surfacePoint.y = clamp(
                traversal.position.y +
                  Math.min(
                    18,
                    Math.max(6, (collider.max.y - traversal.position.y) * 0.58),
                  ),
                collider.min.y + 0.4,
                collider.max.y - 0.4,
              );
              const offset = surfacePoint.clone().sub(camera.position);
              const distance = offset.length();
              if (distance <= 5 || distance >= 170) continue;
              const alignment =
                raycaster.ray.direction.dot(offset.normalize()) -
                Math.abs(distance - 42) * 0.0015;
              if (alignment > bestAlignment) {
                bestAlignment = alignment;
                point = surfacePoint;
              }
            }
          }
          if (!point) continue;
          const hitIsRoof = Boolean(
            meshHit?.face && meshHit.face.normal.y > 0.65,
          );
          candidates.push({
            id: meshHit
              ? `${meshHit.object.uuid}:${meshHit.instanceId ?? 'mesh'}`
              : `facade:${point.x.toFixed(1)}:${point.z.toFixed(1)}`,
            point: { x: point.x, y: point.y, z: point.z },
            kind: hitIsRoof
              ? 'roof'
              : point.y > traversal.position.y + 20
                ? 'facade'
                : 'ledge',
            lineOfSight: true,
            weight: index === 0 ? 1.2 : 0.86,
          });
        }
        renderer.domElement.dataset.lastAnchorCandidateCount = String(
          candidates.length,
        );
        renderer.domElement.dataset.lastAnchorCandidate = candidates[0]
          ? [
              candidates[0].point.x,
              candidates[0].point.y,
              candidates[0].point.z,
            ]
              .map((value) => value.toFixed(2))
              .join(',')
          : '';
        return candidates;
      };
      const swingHeldForAssist = () => pointerHeld || Boolean(trial?.phase);

      let pointerLockPending = false;
      const onPointerLockError = () => {
        pointerLockPending = false;
        renderer.domElement.title =
          'Mouse capture was unavailable. Click the game to retry.';
      };
      const onPointerDown = (event: MouseEvent) => {
        if (![0, 2].includes(event.button) || !ready) return;
        event.preventDefault();
        inputSystem.gainFocus();
        inputSystem.setButton(event.button, true);
        renderer.domElement.focus({ preventScroll: true });
        readPointer(event);
        if (event.button === 0 && traversal.zip) traversal.zip = null;
        if (event.button === 2) pointerZipActive = true;
        if (document.pointerLockElement !== renderer.domElement && !pointerLockPending) {
          pointerLockPending = true;
          try { renderer.domElement.requestPointerLock()?.catch(onPointerLockError); }
          catch { onPointerLockError(); }
        }
      };
      const onPointerMove = (event: PointerEvent) => {
        readPointer(event);
      };
      const onMouseMove = (event: MouseEvent) => {
        if (document.pointerLockElement !== renderer.domElement) return;
        cameraYaw -= (event.movementX || 0) * 0.003;
        cameraYaw = Math.atan2(Math.sin(cameraYaw), Math.cos(cameraYaw));
        cameraPitch = clamp(
          cameraPitch + (event.movementY || 0) * 0.003,
          -1.12,
          1.22,
        );
        pointerNdc.set(0, 0);
      };
      const onContextMenu = (event: MouseEvent) => event.preventDefault();
      const onPointerUp = (event: MouseEvent) => {
        if (![0, 2].includes(event.button)) return;
        readPointer(event);
        inputSystem.setButton(event.button, false);
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.code === 'Escape') {
          clearKeys();
          if (document.pointerLockElement === renderer.domElement)
            document.exitPointerLock();
          return;
        }
        if (process.env.NODE_ENV !== 'production')
          renderer.domElement.dataset.lastKey = event.code;
        const firstPress = !keys.has(event.code);
        inputSystem.gainFocus();
        inputSystem.setKey(event.code, true);
        if (
          [
            'Space',
            'KeyE',
            'KeyF',
            'ShiftLeft',
            'ArrowUp',
            'ArrowDown',
            'ArrowLeft',
            'ArrowRight',
          ].includes(event.code)
        )
          event.preventDefault();
        if (event.code === 'KeyN' && firstPress) interactPressed = true;
        if (event.code === 'KeyK' && firstPress) bossAttackPressed = true;
        if (event.code === 'KeyL' && firstPress) bossHeavyPressed = true;
        if (event.code === 'KeyI' && firstPress) bossLauncherPressed = true;
        if (event.code === 'KeyU' && firstPress) bossGrabPressed = true;
        if (event.code === 'KeyJ' && firstPress) bossDodgePressed = true;
        if (event.code === 'KeyH' && firstPress) bossWebPressed = true;
        if (event.code === 'KeyY' && firstPress) bossTauntPressed = true;
        if (event.code === 'Space' && firstPress) {
          jumpPressed = true;
        }
        if (event.code === 'KeyR' && firstPress) rollPressed = true;
        if (event.code === 'KeyG' && firstPress) glidePressed = true;
        if (
          firstPress &&
          ['KeyG', 'KeyC', 'KeyX', 'KeyZ', 'KeyL'].includes(event.code) &&
          !event.metaKey &&
          !event.ctrlKey
        )
          event.preventDefault();
        if (event.code === 'KeyF' && firstPress) trickRequest++;
        if (event.code === 'KeyQ' && firstPress) wallCrawlPressed = true;
        if (event.code === 'KeyE' && firstPress) {
          zipPressed = true;
        }
        if (event.code === 'KeyF' && firstPress) hoverTogglePressed = true;
        if (event.code === 'KeyE' && firstPress) cruiseTogglePressed = true;
        if (
          process.env.NODE_ENV !== 'production' &&
          event.code === 'KeyT' &&
          firstPress
        ) {
          const stream = districtStreams.get(currentDistrict);
          if (stream) {
            // Jump to the same verified street spawn in the neighboring tile.
            // This exercises a partition crossing without teleporting into an
            // arbitrary facade.
            const home = safeSpawn(getDistrict(currentDistrict));
            const nextTileX =
              Math.round((player.position.x - home.x) / stream.tileWidth) + 1;
            player.position.set(
              home.x + nextTileX * stream.tileWidth,
              home.y,
              home.z,
            );
            player.velocity.set(0, 0, 0);
            setTraversalKinematics(traversal, player.position, player.velocity);
            renderer.domElement.dataset.streamDebugJump = 'completed';
          }
        }
      };
      const onKeyUp = (event: KeyboardEvent) => {
        inputSystem.setKey(event.code, false);
        if (event.code === 'KeyC') chargeJumpReleased = true;
        if (event.code === 'KeyX') slingshotReleased = true;
      };
      const clearKeys = () => {
        inputSystem.loseFocus();
        bossAttackPressed = bossHeavyPressed = bossLauncherPressed = bossGrabPressed = false;
        bossDodgePressed = bossWebPressed = bossTauntPressed = interactPressed = false;
        glidePressed = false;
        chargeJumpReleased = false;
        slingshotReleased = false;
        cancelAbilities = true;
        jumpPressed = false;
        rollPressed = false;
        pointerHeld = false;
        pointerPressed = false;
        zipPressed = false;
        pointerReleased = true;
        pointerZipActive = false;
        hoverTogglePressed = false;
        cruiseTogglePressed = false;
        wallCrawlPressed = false;
      };
      const onPointerLockChange = () => {
        pointerLockPending = false;
        const locked = document.pointerLockElement === renderer.domElement;
        renderer.domElement.dataset.pointerLocked = String(locked);
        renderer.domElement.title = locked
          ? 'Esc releases the mouse'
          : 'Click to capture the mouse';
        pointerNdc.set(0, 0);
        if (!locked) clearKeys();
      };
      // Opt-in, visible development controls exercise the real input/mesh/render
      // loop. No browser-injected game state and no public production test UI.
      const trialEnabled =
        process.env.NODE_ENV !== 'production' &&
        new URLSearchParams(location.search).has('traversalTest');
      let trial: {
        elapsed: number;
        previous: THREE.Vector3;
        startY: number;
        distance: number;
        peakSpeed: number;
        peakHeight: number;
        air: number;
        attaches: number;
        contacts: number;
        penetrationChecks: number;
        penetrations: number;
        penetrationDetails: unknown[];
        nextCheck: number;
        phase: boolean;
      } | null = null;
      let wallTrial: {
        kind: 'wall' | 'roll';
        elapsed: number;
        stage: number;
        modes: Set<string>;
        clips: Set<string>;
        penetrations: number;
        frames: number;
        wallJumpSpeed: number;
      } | null = null;
      const trialPanel = trialEnabled
        ? document.createElement('section')
        : null;
      const trialOutput = document.createElement('output');
      if (trialPanel) {
        trialPanel.setAttribute('aria-label', 'Traversal verification');
        trialPanel.style.cssText =
          'position:absolute;left:16px;bottom:14px;z-index:60;background:#091b28ed;color:#bcefff;padding:12px;max-width:520px;font:14px "Comback Home";pointer-events:auto';
        trialOutput.style.cssText =
          'font:14px "Comback Home";max-height:100px;display:block;overflow:auto;word-break:break-word';
        for (const street of [true, false]) {
          const button = document.createElement('button');
          button.textContent = street
            ? 'Run street swing trial'
            : 'Run rooftop swing trial';
          button.style.cssText =
            'padding:8px;margin:3px;border:1px solid #48cfea;background:#12384a;color:white';
          button.onclick = () => {
            if (!ready || getSuit(activeSuitId).traversal !== 'spider') return;
            const world = repeatingWorlds.get(currentDistrict);
            if (!world) return;
            let spawn = safeSpawn(getDistrict(currentDistrict));
            if (street) {
              const config = getDistrict(currentDistrict),
                hint = config.spawn ?? [config.position[0], config.position[2]];
              let best: THREE.Vector3 | null = null,
                bestScore = -Infinity;
              const stride = Math.min(12, config.targetWidth / 16);
              for (let x = -5; x <= 5; x++)
                for (let z = -5; z <= 5; z++) {
                  const support = world.supportAt(
                    { x: hint[0] + x * stride, y: 3, z: hint[1] + z * stride },
                    0,
                    6,
                  );
                  if (!support || support.normal.y < 0.9) continue;
                  const point = support.point.clone();
                  point.y = capsuleSupportHeight(support);
                  if (!world.isCapsuleClear(point)) continue;
                  const eye = point.clone().add(new THREE.Vector3(0, 1.3, 0));
                  const open = Math.max(
                    ...[0, Math.PI / 2, Math.PI, -Math.PI / 2].map(
                      (yaw) =>
                        world.raycast(
                          eye,
                          { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) },
                          60,
                        )?.distance ?? 60,
                    ),
                  );
                  const score = open - Math.hypot(x, z) * 0.7;
                  if (score > bestScore) {
                    best = point;
                    bestScore = score;
                  }
                }
              if (!best) {
                trialOutput.textContent =
                  'No capsule-clear street start found; trial not run.';
                return;
              }
              spawn = best;
            }
            clearKeys();
            inputSystem.gainFocus();
            anchorSearchAt = -10;
            player.position.copy(spawn);
            player.velocity.set(0, 0, 0);
            player.grounded = true;
            Object.assign(traversal, createTraversalState(spawn));
            traversal.grounded = true;
            cameraYaw = spawnViewYaw(spawn, 0);
            cameraPitch = 0.08;
            traversal.heading = cameraYaw;
            camera.position
              .copy(spawn)
              .add(
                new THREE.Vector3(
                  Math.sin(cameraYaw) * 7,
                  3.2,
                  Math.cos(cameraYaw) * 7,
                ),
              );
            meshWallContact = null;
            inputSystem.gainFocus();
            inputSystem.setKey('KeyW', true);
            trial = {
              elapsed: 0,
              previous: spawn.clone(),
              startY: spawn.y,
              distance: 0,
              peakSpeed: 0,
              peakHeight: 0,
              air: 0,
              attaches: 0,
              contacts: 0,
              penetrationChecks: 0,
              penetrations: 0,
              penetrationDetails: [],
              nextCheck: 0,
              phase: false,
            };
            trialOutput.textContent =
              'Running real-map swing/release trial (16 seconds)…';
          };
          trialPanel.appendChild(button);
        }
        const wallButton = document.createElement('button');
        wallButton.textContent = 'Run wall / aerial sequence';
        wallButton.onclick = () => {
          const world = repeatingWorlds.get(currentDistrict);
          if (!ready || !world) return;
          const scenario = findWallScenario(world);
          if (!scenario) {
            trialOutput.textContent = 'No broad clear facade found.';
            return;
          }
          clearKeys();
          trial = null;
          Object.assign(
            traversal,
            createTraversalState(scenario.position, scenario.velocity),
          );
          player.position.copy(scenario.position);
          player.velocity.copy(scenario.velocity);
          player.grounded = false;
          cameraYaw = Math.atan2(scenario.normal.x, scenario.normal.z);
          cameraPitch = 0.08;
          traversal.heading = cameraYaw;
          camera.position
            .copy(scenario.position)
            .addScaledVector(scenario.normal, 7)
            .add(new THREE.Vector3(0, 3, 0));
          meshWallContact = null;
          inputSystem.gainFocus();
          inputSystem.setKey('KeyW', true);
          wallTrial = {
            kind: 'wall',
            elapsed: 0,
            stage: 0,
            modes: new Set(),
            clips: new Set(),
            penetrations: 0,
            frames: 0,
            wallJumpSpeed: 0,
          };
        };
        trialPanel.appendChild(wallButton);
        const rollButton = document.createElement('button');
        rollButton.textContent = 'Run landing roll sequence';
        rollButton.onclick = () => {
          const world = repeatingWorlds.get(currentDistrict);
          if (!ready || !world) return;
          const scenario = findRollScenario(world);
          if (!scenario) {
            trialOutput.textContent = 'No supported roll corridor found.';
            return;
          }
          clearKeys();
          trial = null;
          Object.assign(
            traversal,
            createTraversalState(scenario.position, scenario.velocity),
          );
          player.position.copy(scenario.position);
          player.velocity.copy(scenario.velocity);
          player.grounded = false;
          cameraYaw = Math.atan2(-scenario.velocity.x, -scenario.velocity.z);
          cameraPitch = 0.08;
          traversal.heading = cameraYaw;
          camera.position
            .copy(scenario.position)
            .add(
              new THREE.Vector3(
                Math.sin(cameraYaw) * 7,
                3,
                Math.cos(cameraYaw) * 7,
              ),
            );
          meshWallContact = null;
          wallTrial = {
            kind: 'roll',
            elapsed: 0,
            stage: 0,
            modes: new Set(),
            clips: new Set(),
            penetrations: 0,
            frames: 0,
            wallJumpSpeed: 0,
          };
        };
        trialPanel.appendChild(rollButton);

        const renderCheck = document.createElement('button');
        renderCheck.textContent = 'Verify blur color';
        renderCheck.onclick = () => { const report=verifyBlurColors(renderer); renderer.domElement.dataset.blurColorCheck=JSON.stringify(report); trialOutput.textContent=JSON.stringify(report); };
        trialPanel.appendChild(renderCheck);
        const cancel = document.createElement('button');
        cancel.textContent = 'Stop trial';
        cancel.onclick = () => {
          trial = null;
          wallTrial = null;
          clearKeys();
          trialOutput.textContent = 'Stopped';
        };
        trialPanel.appendChild(cancel);
        trialPanel.appendChild(document.createElement('br'));
        trialPanel.appendChild(trialOutput);
        mount.appendChild(trialPanel);
      }
      renderer.domElement.addEventListener('mousedown', onPointerDown);
      renderer.domElement.addEventListener('pointermove', onPointerMove);
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('pointerlockchange', onPointerLockChange);
      document.addEventListener('pointerlockerror', onPointerLockError);
      renderer.domElement.addEventListener('contextmenu', onContextMenu);
      window.addEventListener('mouseup', onPointerUp);
      window.addEventListener('keydown', onKeyDown, { passive: false });
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', clearKeys);

      const verifiedActivityPoints = () => {
        const world = repeatingWorlds.get(currentDistrict);
        if (!world) return [];
        const points: {x:number;y:number;z:number}[] = [];
        for (const distance of [60, 145, 230]) {
          let found = false;
          for (let angle = 0; angle < Math.PI * 2 && !found; angle += Math.PI / 6) {
            const p = new THREE.Vector3(player.position.x + Math.cos(angle) * distance, 600, player.position.z + Math.sin(angle) * distance);
            const hit = world.raycast(p, {x:0,y:-1,z:0}, 800, .85);
            if (!hit) continue;
            const target = hit.point.clone();target.y = capsuleSupportHeight(hit);
            if (world.isCapsuleClear(target, .46, 2.05, false)) {points.push({x:target.x,y:target.y,z:target.z});found=true;}
          }
        }
        return points;
      };
      activityActionRef.current = (action) => {
        if (action === 'stop') { bossLoadingGeneration++;bosses.stop();missions.stop();activityMessage = ''; return; }
        if (action === 'retry') {
          if (bosses.snapshot()) {
            bosses.retry();
            if (bossCheckpointPlayer) {
              const entry = bossCheckpointPlayer.clone();
              player.position.copy(entry);player.velocity.set(0,0,0);
              Object.assign(traversal,createTraversalState(entry));traversal.grounded=true;
              meshWallContact=null;inputSystem.resetActions();
            }
            activityMessage='Fight restarted · K strike · J dodge · H restrain';
          } else missions.retry(tricks.score);
          return;
        }
        if (['hulk','venom','ironman'].includes(action)) {
          if (race && ['countdown','racing'].includes(race.phase)) {activityMessage='Finish or leave the race first';return;}
          missions.stop();bosses.stop();
          const id=action as BossId,world=repeatingWorlds.get(currentDistrict);
          if(!world)return;
          let arena:THREE.Vector3|null=null;
          const height=BOSS_DEFINITIONS[id].height;
          for(const distance of [0,12,24,36]) {
            for(let angle=0;angle<Math.PI*2;angle+=Math.PI/6) {
              const candidate={x:player.position.x+Math.cos(angle)*distance,y:player.position.y+8,z:player.position.z+Math.sin(angle)*distance};
              const hit=world.supportAt(candidate,2,55);
              if(!hit)continue;
              const center=hit.point.clone();center.y=capsuleSupportHeight(hit);
              if(!world.isCapsuleClear(center,.55,2.05,false)||Math.abs(center.y-player.position.y)>20)continue;
              let clear=true;
              for(let probe=0;probe<8;probe++){
                const probeAngle=probe*Math.PI/4;
                const sample={x:center.x+Math.cos(probeAngle)*7,y:center.y+5,z:center.z+Math.sin(probeAngle)*7};
                const floor=world.supportAt(sample,2,18);
                if(!floor){clear=false;break;}
                const point=floor.point.clone();point.y=capsuleSupportHeight(floor,.8);
                if(Math.abs(point.y-center.y)>1||!world.isCapsuleClear(point,1.15,height,false)){clear=false;break;}
              }
              if(clear){arena=center;break;}
            }
            if(arena)break;
          }
          if(!arena){activityMessage='Move to an open street or rooftop to begin the fight';return;}
          const fightForward=camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
          const bossProbe={x:arena.x+fightForward.x*7,y:arena.y+5,z:arena.z+fightForward.z*7};
          const bossFloor=world.supportAt(bossProbe,2,18);
          if(!bossFloor){activityMessage='Move to a wider rooftop or street to begin the fight';return;}
          const spawn=bossFloor.point.clone();spawn.y=capsuleSupportHeight(bossFloor,.8);
          bossCheckpointPlayer=arena.clone();
          const generation=++bossLoadingGeneration;
          activityMessage=`Loading ${BOSS_DEFINITIONS[id].name} encounter…`;
          void bossVisuals.load(id).then(()=>{
            if(disposed||generation!==bossLoadingGeneration)return;
            player.position.copy(arena!);player.velocity.set(0,0,0);
            Object.assign(traversal,createTraversalState(arena!));traversal.grounded=true;
            meshWallContact=null;inputSystem.resetActions();
            cameraYaw=Math.atan2(-fightForward.x,-fightForward.z);
            camera.position.copy(arena!).addScaledVector(fightForward,-7).add(new THREE.Vector3(0,3,0));
            bosses.start(id,spawn,bossWorld);
            activityMessage='K strike · J dodge · Hold H to restrain · keep moving';
          }).catch(error=>{if(!disposed&&generation===bossLoadingGeneration)activityMessage=`Encounter unavailable: ${error instanceof Error?error.message:String(error)}`;});
          return;
        }
        if (['courier','rescue','style'].includes(action)) {
          if (race && ['countdown','racing'].includes(race.phase)) {activityMessage = 'Finish or leave the race first';return;}
          bossLoadingGeneration++;bosses.stop();
          const points = verifiedActivityPoints();
          if(points.length<3){activityMessage='Move toward the city to find a clear route';return;}
          missions.start(createCityMission(action as 'courier'|'rescue'|'style', points),tricks.score);
          activityMessage='Follow the cyan objective beacon';
        }
      };

      const setupRace = () => {
        race = new RaceSession(multiplayer?.id ?? crypto.randomUUID(), {
          send: (packet) => multiplayer?.publishRace(packet),
          teleport: (point) => {
            inputSystem.resetActions();
            meshWallContact = null;
            player.position.fromArray(point);
            player.velocity.set(0, 0, 0);
            player.grounded = true;
            Object.assign(traversal, createTraversalState(player.position));
            traversal.grounded = true;
            cameraYaw = spawnViewYaw(player.position, 0);
            traversal.heading = cameraYaw;
            camera.position
              .copy(player.position)
              .add(
                new THREE.Vector3(
                  Math.sin(cameraYaw) * 7,
                  3,
                  Math.cos(cameraYaw) * 7,
                ),
              );
            prepareRaceCourse();
          },
          started: () => {
            if (avatar) recorder = new GhostRecorder(avatar);
            raceMessage = 'GO · pass each cyan gate';
          },
          finished: (course, time) => {
            recorder?.capture(time);
            const best = readBestRun(course.id);
            const metadata = {score:race?.styleScore??0, splits:race?.splits??[]};
            if (isBetterRaceRun(course,time,metadata.score,best)) {
              const saved = storeBest(course, time, metadata);
              raceBest = time;
              raceMessage = saved
                ? 'NEW PERSONAL BEST'
                : 'PB set · browser storage unavailable';
              if (recorder)
                ghostSave = saveGhost(recorder.record(course, time, metadata)).catch(() => {
                  raceMessage = 'PB saved · ghost storage unavailable';
                });
            } else raceMessage = 'FINISH · challenge your ghost';
            recorder = null;
          },
        });
        raceActionRef.current = (action) => {
          if (!race) return;
          if (action.startsWith('mode-')) { selectedRaceMode = action.slice(5) as RaceMode; return; }
          if (action === 'restart') { raceCourseId=''; race.restart(raceNow()); prepareRaceCourse(); recorder = null; raceVisuals.setProgress(race.activeGateIds,race.completedGateIds); return; }
          if (action === 'accept') {
            bossLoadingGeneration++;bosses.stop();missions.stop();
            race.accept(raceNow());
            raceMessage = 'Accepted · waiting for launch';
          } else if (action === 'decline') {
            race.decline(raceNow());
            raceVisuals.clear();
            removeGhost();
          } else if (action === 'cancel') {
            race.cancel(raceNow());
            recorder = null;
            removeGhost();
            raceVisuals.clear();
            raceCourseId = '';
          } else {
            const world = repeatingWorlds.get(currentDistrict);
            if (!world) return;
            let previous = null;
            try {
              const value = JSON.parse(
                localStorage.getItem('2099-last-course') ?? 'null',
              );
              if (validRaceCourse(value) && value.gates?.length && value.mapId === currentDistrict) previous = value;
            } catch {
              /* storage is optional */
            }
            const peers = multiplayerStatus === 'online' ? onlinePeerCount : 0;
            const origin = safeSpawn(
              getDistrict(currentDistrict),
            ).toArray() as RacePoint;
            let course: RaceCourse;
            try { course =
              previous && action === 'pb'
                ? previous
                : createRaceCourse(
                    origin,
                    world.width,
                    world.depth,
                    action === 'daily' ? dailyRaceSeed(currentDistrict) : crypto.getRandomValues(new Uint32Array(1))[0],
                    action === 'daily' ? -1 : lastRaceSide >= 0 ? lastRaceSide : (previous?.side ?? -1),
                    {sample:createRaceGeometrySampler(world),mode:selectedRaceMode,mapId:currentDistrict},
                  );
            } catch { raceMessage='No clear course here · move to another rooftop and retry';activityMessage=raceMessage;return; }
            bossLoadingGeneration++;bosses.stop();missions.stop();
            if (race.invite(course, raceNow(), peers, crypto.randomUUID())) {
              lastRaceSide = course.side;
              raceCourseId = '';
              raceMessage = peers
                ? 'Inviting the lobby · accept to join'
                : 'Solo time trial';
              prepareRaceCourse();
            }
          }
        };
      };

      travelRef.current = (id: DistrictId) => {
        race?.cancel(raceNow());raceVisuals.clear();removeGhost();ghostRecord=null;recorder=null;raceCourseId='';
        bossLoadingGeneration++;bosses.stop();missions.stop();activityMessage='';
        const district = getDistrict(id);
        void loadDistrict(district)
          .then(() => {
            if (disposed) return;
            currentDistrict = id;
            for (const [districtId, stream] of districtStreams) {
              const visible = districtId === id;
              stream.horizon.root.traverse((object) =>
                object.layers.set(visible ? 0 : 31),
              );
              for (const tile of stream.tiles.values())
                tile.root.traverse((object) =>
                  object.layers.set(visible ? 0 : 31),
                );
            }
            cameraPitch = district.spawnPitch ?? 0.08;
            player.position.copy(safeSpawn(district));
            cameraYaw = spawnViewYaw(player.position, district.spawnYaw ?? 0);
            traversal.heading = cameraYaw;
            player.facing = cameraYaw;
            player.velocity.set(0, 0, 0);
            player.grounded = true;
            avatar?.root.position.copy(player.position);
            setTraversalKinematics(traversal, player.position, player.velocity);
            traversal.grounded = true;
            traversal.mode = 'idle';
            traversal.advanced = createTraversalState().advanced;
            traversal.swing = null;
            traversal.zip = null;
            traversal.wall = null;
            traversal.wallCrawlActive = false;
            traversal.mantle = null;
            traversal.swingNeedsRelease = false;
            ironFlightMode = 'grounded';
            anchorSearchAt = -10;
            cachedAnchors = [];
            meshWallContact = null;
            wallCameraBlend = 0;
            camera.up.set(0, 1, 0);
            const travelOffset = new THREE.Vector3(
              Math.sin(cameraYaw) * 10,
              4.4,
              Math.cos(cameraYaw) * 10,
            );
            camera.position.copy(player.position).add(travelOffset);
            camera.lookAt(
              player.position.clone().add(new THREE.Vector3(0, 1.4, 0)),
            );
            renderer.domElement.dataset.spawnMode = 'highest-rooftop';
            renderer.domElement.dataset.rooftopSpawn = player.position
              .toArray()
              .map((value) => value.toFixed(2))
              .join(',');
            clearRemoteAvatars();
            onlinePeerCount = 0;
            if (multiplayer) void multiplayer.join(id, activeSuitId);
            callbacksRef.current.onDistrictChange(id);
            callbacksRef.current.onStatus(`${district.name} ready`, 100);
          })
          .catch(() => undefined);
      };

      const updateAvatar = (
        delta: number,
        elapsed: number,
        context: TraversalContext,
      ) => {
        if (!avatar) return;
        avatar.wallPose.reset(avatar.surfaceFrame);
        avatar.root.position.copy(player.position);
        const combatSnapshot = bosses.snapshot();
        const combatDirection = combatSnapshot
          ? new THREE.Vector3().copy(combatSnapshot.position).sub(player.position)
          : null;
        const combatYaw = combatDirection && combatDirection.lengthSq() > .01
          ? Math.atan2(-combatDirection.x, -combatDirection.z)
          : context.animation.bodyYaw;
        avatar.root.rotation.y = dampYaw(
          avatar.root.rotation.y,
          combatSnapshot?.status === 'active' ? combatYaw : context.animation.bodyYaw,
          13,
          delta,
        );
        avatar.root.rotation.z = damp(
          avatar.root.rotation.z,
          context.animation.bodyRoll,
          8,
          delta,
        );
        const activeSuit = getSuit(activeSuitId);
        const isIronMan = activeSuit.traversal === 'ironman';
        const ironPitch =
          ironFlightMode === 'cruise'
            ? -1.1 * avatar.animator.cruiseBlend
            : ironFlightMode === 'freefall'
              ? context.animation.bodyPitch
              : 0;
        avatar.root.rotation.x = damp(
          avatar.root.rotation.x,
          player.grounded
            ? 0
            : isIronMan
              ? ironPitch
              : context.animation.bodyPitch,
          8,
          delta,
        );
        const mode = context.animation.state;
        const pose: ProceduralPose = isIronMan
          ? ironFlightMode === 'cruise'
            ? 'fly'
            : ironFlightMode === 'hover'
              ? 'hover'
              : mode === 'run'
                ? 'run'
                : player.grounded
                  ? 'idle'
                  : player.velocity.y < -1
                    ? 'fall'
                    : 'jump'
          : mode === 'glide'
            ? 'fly'
            : mode === 'slingshot' || mode === 'chargeJump'
              ? 'perch'
              : mode === 'cornerTether'
                ? 'zip'
                : mode === 'swing'
                  ? 'swing'
                  : mode === 'webZip' || mode === 'pointLaunch'
                    ? 'zip'
                    : mode === 'wallRun'
                      ? 'wall'
                      : mode === 'wallCrawl'
                        ? 'crawl'
                        : mode === 'mantle'
                          ? 'perch'
                          : mode === 'dive'
                            ? 'dive'
                            : mode === 'run'
                              ? 'run'
                              : player.grounded &&
                                  (mode === 'idle' || mode === 'perch') &&
                                  player.position.y >
                                    groundYAt(player.position) + 4
                                ? 'perch'
                                : mode === 'idle' ||
                                    mode === 'land' ||
                                    mode === 'perch'
                                  ? 'idle'
                                  : player.velocity.y < -1
                                    ? 'fall'
                                    : 'jump';
        renderer.domElement.dataset.animationState = mode;
        avatarPose = pose;
        const anchor =
          context.webAnchor ??
          (traversal.zip?.targetId === 'air-zip-no-anchor'
            ? null
            : (traversal.zip?.surfacePoint ?? traversal.zip?.target));
        avatar.animator.update(delta, {
          pose,
          mode: traversal.mantle?.lowObstacle
            ? 'vault'
            : pose === 'perch' &&
                player.grounded &&
                !['slingshot', 'chargeJump', 'mantle'].includes(mode)
              ? 'perch'
              : mode,
          charge: traversal.advanced?.sling
            ? traversal.advanced.sling.seconds / 1.1
            : 0,
          actionSequence: traversal.actionSequence,
          combat: bosses.snapshot()?.player,
          timeToLanding: landingPrediction.time,
          trickClearance: landingPrediction.clear,
          trickRequest,
          moveForward: keys.has('KeyW') ? 1 : keys.has('KeyS') ? -1 : 0,
          moveStrafe: keys.has('KeyD') ? 1 : keys.has('KeyA') ? -1 : 0,
          grounded: player.grounded,
          speed:
            mode === 'wallCrawl' || mode === 'wallRun'
              ? player.velocity.length()
              : context.horizontalSpeed,
          verticalSpeed: player.velocity.y,
          tension: context.webTension,
          crawlDirection: player.velocity.y < -0.1 ? -1 : 1,
          boost: isIronMan && ironFlightMode === 'cruise' && pointerHeld,
          anchor: anchor
            ? new THREE.Vector3(anchor.x, anchor.y, anchor.z)
            : null,
        });
        if (
          ((mode === 'wallCrawl' && traversal.wall?.feetTouching) ||
            (mode === 'wallRun' &&
              traversal.wall &&
              hasWallRunSupport(traversal.wall))) &&
          traversal.wall
        )
          avatar.wallPose.apply(
            avatar.surfaceFrame,
            avatar.animator.bones,
            traversal.wall,
            { mode, velocity: player.velocity },
          );
        renderer.domElement.dataset.wallCrawlActive = String(
          traversal.wallCrawlActive,
        );
        renderer.domElement.dataset.wallFootGap =
          mode === 'wallCrawl' || mode === 'wallRun'
            ? avatar.wallPose.footGap.toFixed(3)
            : '';
        renderer.domElement.dataset.wallBodyClearance =
          mode === 'wallCrawl' || mode === 'wallRun'
            ? avatar.wallPose.bodyClearance.toFixed(3)
            : '';
        renderer.domElement.dataset.activeAnimation =
          avatar.animator.activeClip;
        renderer.domElement.dataset.soleError =
          avatar.animator.contactError.toFixed(4);
        const repulsorActive =
          isIronMan &&
          (ironFlightMode === 'hover' || ironFlightMode === 'cruise');
        avatar.repulsors?.update(
          repulsorActive,
          context.speed,
          pointerHeld,
          elapsed,
        );
        renderer.domElement.dataset.ironFlightMode = isIronMan
          ? ironFlightMode
          : '';
      };

      const tick = (timestamp = performance.now()) => {
        if (disposed) return;
        frameId = requestAnimationFrame(tick);
        const rawFrameMs = Math.max(0, timestamp - lastFrameTime);
        const visualDelta = Math.min(Math.max(rawFrameMs / 1000, 0), 0.1);
        visualTime += visualDelta;
        const paused = callbacksRef.current.paused === true;
        const requestedSky = callbacksRef.current.sky ?? 'golden';
        const effectiveSky =
          currentDistrict === 'cyberpunk-city'
            ? 'blizzard'
            : requestedSky;
        lastFrameTime = timestamp;
        if (paused) {
          if (!wasPaused) {
            wasPaused = true;
            clearKeys();
            if (document.pointerLockElement === renderer.domElement)
              document.exitPointerLock();
            renderer.domElement.dataset.paused = 'true';
          }
          const requestedNight = callbacksRef.current.night ?? false;
          const visualPresetChanged =
            pausedVisualSky !== effectiveSky ||
            pausedVisualNight !== requestedNight;
          pausedVisualSky = effectiveSky;
          pausedVisualNight = requestedNight;
          const atmosphereDelta = visualPresetChanged ? 4 : visualDelta;
          atmosphere.update(
            visualTime,
            player.position,
            requestedNight,
            atmosphereDelta,
            effectiveSky,
          );
          weather.update(
            visualTime,
            player.position,
            effectiveSky,
            requestedNight,
            atmosphereDelta,
          );
          sun.intensity = THREE.MathUtils.lerp(2.1, 0.3, atmosphere.night);
          skyFill.intensity = THREE.MathUtils.lerp(1.55, 0.85, atmosphere.night);
          rim.intensity = THREE.MathUtils.lerp(0.7, 1.4, atmosphere.night);
          speedBlur.render(renderer, scene, camera);
          return;
        }
        if (wasPaused) {
          wasPaused = false;
          pausedVisualSky = null;
          pausedVisualNight = null;
          inputSystem.gainFocus();
          renderer.domElement.dataset.paused = 'false';
        }
        if (ready && document.visibilityState === 'visible') telemetry.record('frame', rawFrameMs);
        const rawDelta = Math.min(
          Math.max(rawFrameMs / 1000, 0),
          0.1,
        );
        const delta = rawDelta * (bosses.snapshot()?.timeScale ?? 1);
        elapsedTime += delta;
        atmosphere.update(
          visualTime,
          player.position,
          callbacksRef.current.night ?? false,
          delta,
          effectiveSky,
        );
        weather.update(
          visualTime,
          player.position,
          effectiveSky,
          callbacksRef.current.night ?? false,
          delta,
        );
        sun.intensity = THREE.MathUtils.lerp(2.1, 0.3, atmosphere.night);
        skyFill.intensity = THREE.MathUtils.lerp(1.55, 0.85, atmosphere.night);
        rim.intensity = THREE.MathUtils.lerp(0.7, 1.4, atmosphere.night);
        if (!ready) {
          renderer.render(scene, camera);
          return;
        }
        if (trial) {
          trial.elapsed += delta;
          const held = trial.elapsed % 3.35 < 3;
          if (held && !trial.phase) {
            inputSystem.setButton(0, true);
          }
          if (!held && trial.phase) {
            inputSystem.setButton(0, false);
          }
          trial.phase = held;
        }
        // The race teleport clears stale movement once. During the countdown,
        // suppress traversal without erasing a fresh press every render frame;
        // a held web input can therefore become active on the first race tick.

        if (wallTrial) {
          wallTrial.elapsed += delta;
          if (
            wallTrial.kind === 'wall' &&
            wallTrial.elapsed > 1 &&
            wallTrial.stage === 0
          ) {
            wallCrawlPressed = true;
            wallTrial.stage = 1;
          }
          if (
            wallTrial.kind === 'wall' &&
            wallTrial.elapsed > 2.2 &&
            wallTrial.stage === 1
          ) {
            jumpPressed = true;
            wallTrial.stage = 2;
            keys.delete('KeyW');
          }
          if (
            wallTrial.kind === 'wall' &&
            wallTrial.elapsed > 2.65 &&
            wallTrial.stage === 2
          ) {
            jumpPressed = true;
            wallTrial.stage = 3;
          }
          if (
            wallTrial.kind === 'wall' &&
            wallTrial.elapsed > 3.4 &&
            wallTrial.stage === 3
          ) {
            trickRequest++;
            wallTrial.stage = 4;
          }
        }
        // Advance countdown BEFORE sampling, so held buttons activate on GO itself.
        race?.tick(raceNow(), player.position.toArray() as RacePoint, {styleScore:tricks.score});
        const actions = sampleRaceInput(inputSystem, race?.phase, ready && bosses.snapshot()?.status !== 'dead');
        const bossAtInput = bosses.snapshot();
        const raceInputLocked = !actions.enabled || bossAtInput?.cinematic === 'intro';
        renderer.domElement.dataset.inputRacePhase = race?.phase ?? 'free';
        renderer.domElement.dataset.rawSwingHeld=String(inputSystem.raw.buttons.has(0));
        renderer.domElement.dataset.actionSwingHeld=String(actions.swing.held);
        renderer.domElement.dataset.actionSwingPressed=String(actions.swing.pressed);
        if(actions.swing.pressed) renderer.domElement.dataset.swingInputAt=String(performance.now());
        pointerHeld = actions.swing.held;
        pointerPressed = actions.swing.pressed;
        pointerReleased = actions.swing.released;
        zipPressed = actions.zip.pressed || actions.pointLaunch.pressed;
        jumpPressed ||= actions.jump.pressed;
        rollPressed ||= actions.roll.pressed;
        glidePressed ||= actions.glide.pressed;
        wallCrawlPressed ||= actions.wallCrawl.pressed;
        chargeJumpReleased ||= actions.chargeJump.released;
        slingshotReleased ||= actions.slingshot.released;
        cancelAbilities ||= actions.cancelAbilities;
        hoverTogglePressed ||= actions.trick.pressed;
        cruiseTogglePressed ||= actions.pointLaunch.pressed;
        const forward = bossAtInput?.status === 'active' && bossAtInput.cinematic !== 'intro'
          ? camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize()
          : new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
        const right = new THREE.Vector3(-forward.z, 0, forward.x);
        const wish = new THREE.Vector3();
        if (!raceInputLocked) {
          if (keys.has('KeyW')) wish.add(forward);
          if (keys.has('KeyS')) wish.sub(forward);
          if (keys.has('KeyD')) wish.add(right);
          if (keys.has('KeyA')) wish.sub(right);
        }
        if (wish.lengthSq() > 1) wish.normalize();
        const hero = getSuit(activeSuitId);
        const cameraAim = camera.getWorldDirection(new THREE.Vector3());
        if (pointerHeld || pointerZipActive) {
          raycaster.setFromCamera(pointerNdc, camera);
          cameraAim.copy(raycaster.ray.direction);
        }
        const pointerSwingHeld =
          !raceInputLocked &&
          pointerHeld;
        const swingHeld = hero.traversal === 'spider' && pointerSwingHeld;
        const targetNdc =
          pointerHeld || pointerPressed || pointerZipActive
            ? pointerNdc
            : new THREE.Vector2(0, 0.08);
        const needsAnchor =
          hero.traversal === 'spider' &&
          !raceInputLocked &&
          ((!traversal.swing &&
            !traversal.zip &&
            swingHeld &&
            !traversal.swingNeedsRelease &&
            (!traversal.advanced?.gliding || pointerPressed)) ||
            zipPressed);
        const anchorStart = performance.now();
        const anchorCandidates = needsAnchor
          ? collectAnchorCandidates(targetNdc)
          : [];
        if (needsAnchor) telemetry.record('anchor', performance.now() - anchorStart);
        if (
          needsAnchor &&
          swingHeld &&
          !zipPressed &&
          SPIDER_TRAVERSAL_FEEL.allowSkyFallback &&
          !anchorCandidates.length
        ) {
          // User-requested screen-edge fallback. A real hit always wins. Keep the
          // distant virtual endpoint stable for this attachment, even over sky.
          const aim = cameraAim.clone();
          aim.y = Math.max(0.3, aim.y);
          aim.normalize();
          anchorCandidates.push({
            id: 'sky-fallback',
            point: player.position.clone().addScaledVector(aim, 78),
            kind: 'facade',
            lineOfSight: true,
          });
        }

        if (hero.traversal === 'ironman') {
          traversal.swing = null;
          traversal.zip = null;
          ironFlightMode = updateIronFlight(
            ironFlightMode,
            traversal,
            {
              hoverToggle: hoverTogglePressed,
              cruiseToggle: cruiseTogglePressed,
              ascend: !raceInputLocked && keys.has('Space'),
              ascendPressed: !raceInputLocked && jumpPressed,
              descend: !raceInputLocked && keys.has('ShiftLeft'),
              boost: !raceInputLocked && pointerHeld,
              aim: cameraAim,
            },
            delta,
          );
        }

        const streamingStart = performance.now();
        updateWorldStreaming(currentDistrict, player.position);
        telemetry.record('streaming', performance.now() - streamingStart);
        const activeColliders = nearbyColliders(
          player.position,
          Math.max(42, player.velocity.length() * 0.12),
        );
        const ironPowered =
          hero.traversal === 'ironman' &&
          (ironFlightMode === 'hover' || ironFlightMode === 'cruise');
        const localGroundY = groundYAt(traversal.position);

        const traversalOverrides: Partial<TraversalConfig> =
          hero.traversal === 'ironman'
            ? {
                gravity: ironPowered ? 0 : 29,
                groundAcceleration: 40,
                airAcceleration: ironPowered ? 30 : 10,
                runSpeed: 11,
                maximumSpeed: 92,
              }
            : pointerZipActive
              ? {
                  ...SPIDER_TRAVERSAL_FEEL,
                  // A click grapple is the traversal equivalent of Spider-Man's web
                  // zip: a brief, decisive pull rather than another rope-swing state.
                  zipAcceleration: 190,
                  zipDamping: 2.35,
                  zipMaximumSpeed: 96,
                  maximumSpeed: SPIDER_TRAVERSAL_FEEL.maximumSpeed,
                  anchorMaximumDistance: 150,
                }
              : {
                  ...SPIDER_TRAVERSAL_FEEL,
                  zipAcceleration: 126,
                  zipDamping: 3.6,
                  zipMaximumSpeed: 66,
                };
        traversalOverrides.cameraMotionScale = reducedMotion ? 0 : 1;
        const frameInput: TraversalInput = {
          ...toTraversalInput(actions, forward, cameraAim),
          move: wish,
          jumpPressed: hero.traversal === 'spider' && !raceInputLocked && jumpPressed,
          rollPressed: !raceInputLocked && rollPressed,
          glidePressed: !raceInputLocked && glidePressed,
          wallCrawlPressed: !raceInputLocked && wallCrawlPressed,
          swingHeld,
          swingPressed: hero.traversal === 'spider' && pointerPressed && !traversal.swingNeedsRelease,
          swingReleased: hero.traversal === 'spider' && pointerReleased,
          zipPressed: hero.traversal === 'spider' && zipPressed,
          diveHeld: hero.traversal === 'spider' && actions.dive.held,
          cancelAbilities,
        };
        if (bossAtInput) frameInput.loopHeld = false;
        const exactWorld = repeatingWorlds.get(currentDistrict);
        const bossResult = bosses.step(delta,{
          position:traversal.position,velocity:traversal.velocity,grounded:traversal.grounded,traversalMode:traversal.mode,
          attackPressed:!raceInputLocked&&bossAttackPressed,
          heavyPressed:!raceInputLocked&&bossHeavyPressed,
          launcherPressed:!raceInputLocked&&bossLauncherPressed,
          grabPressed:!raceInputLocked&&bossGrabPressed,
          dodgePressed:!raceInputLocked&&bossDodgePressed,
          blockHeld:!raceInputLocked&&keys.has('KeyO'),
          webPressed:!raceInputLocked&&bossWebPressed,
          webHeld:!raceInputLocked&&keys.has('KeyH'),
          tauntPressed:!raceInputLocked&&bossTauntPressed,
        },bossWorld);
        bossAttackPressed=bossHeavyPressed=bossLauncherPressed=bossGrabPressed=false;
        bossDodgePressed=bossWebPressed=bossTauntPressed=false;
        traversal.velocity.x+=bossResult.playerImpulse.x;
        traversal.velocity.y+=bossResult.playerImpulse.y;
        traversal.velocity.z+=bossResult.playerImpulse.z;
        if(bossResult.events.some(event=>event.type==='death')) {
          traversal.velocity={x:0,y:0,z:0};traversal.swing=null;traversal.zip=null;inputSystem.resetActions();
        }
        bossVisuals.update(
          bosses.snapshot(),
          delta,
          avatar?.animator.webHands([new THREE.Vector3(), new THREE.Vector3()]) ?? [
            player.position.clone().add(new THREE.Vector3(-.25, 1.3, 0)),
            player.position.clone().add(new THREE.Vector3(.25, 1.3, 0)),
          ],
        );
        renderer.domElement.dataset.boss=JSON.stringify(bosses.snapshot());
        if (
          exactWorld &&
          traversal.grounded &&
          !traversal.mantle &&
          !traversal.swing &&
          !traversal.zip &&
          !keys.has('KeyC') &&
          !keys.has('KeyX')
        ) {
          const target = probeLowObstacle(exactWorld, traversal.position, wish);
          if (target) {
            traversal.mantle = { target, elapsed: 0, lowObstacle: true };
            traversal.wall = null;
            traversal.wallRunActive = false;
            traversal.wallCrawlActive = false;
            traversal.grounded = false;
            traversal.actionSequence = (traversal.actionSequence ?? 0) + 1;
          }
        }

        if (exactWorld && (keys.has('KeyX') || keys.has('KeyZ'))) {
          if (elapsedTime >= featureProbeAfter) {
            featureProbeAfter = elapsedTime + 0.08;
            featureQuery = probeAdvancedWorld(
              exactWorld,
              traversal.position,
              traversal.velocity,
              forward,
              keys.has('KeyX'),
              keys.has('KeyZ')
                ? keys.has('KeyD')
                  ? 1
                  : keys.has('KeyA')
                    ? -1
                    : 0
                : 0,
            );
          }
        } else {
          featureQuery = { slingshotAnchors: null, cornerTarget: null };
          featureProbeAfter = 0;
        }
        let predictiveAssistAcceleration: {x:number;y:number;z:number} | undefined;
        if (hero.traversal === 'spider' && exactWorld) {
          const assisted = stepSwingAssistance(
            swingAssistance,
            {
              position: traversal.position,
              velocity: traversal.velocity,
              dt: delta,
              swinging: Boolean(
                traversal.swing && swingHeld && !traversal.advanced?.loop,
              ),
              diving: keys.has('ShiftLeft'),
              desiredDirection: wish.lengthSq() > 0.01 ? wish : forward,
            },
            (origin, direction, maximum) =>
              exactWorld.raycast(origin, direction, maximum),
          );
          predictiveAssistAcceleration = {
            x: (assisted.velocity.x - traversal.velocity.x) / Math.max(delta, .001),
            y: (assisted.velocity.y - traversal.velocity.y) / Math.max(delta, .001),
            z: (assisted.velocity.z - traversal.velocity.z) / Math.max(delta, .001),
          };
          renderer.domElement.dataset.swingAssistance = assisted.active
            ? 'steering'
            : 'clear';
          renderer.domElement.dataset.assistanceProbes = String(
            assisted.probeCount,
          );
        }
        if (exactWorld && wallCrawlPressed && !meshWallContact) {
          // Q only attaches within physical capsule-to-facade reach, never at a
          // remote aimed building. Short probes also allow attaching at rest.
          for (const normal of [
            forward.clone().negate(),
            right,
            right.clone().negate(),
            forward,
          ]) {
            meshWallContact = probeWallFeet(
              traversal.position,
              normal,
              raycastWorld,
            );
            if (meshWallContact) break;
          }
        }
        if (
          exactWorld &&
          (traversal.wallCrawlActive || traversal.wallRunActive) &&
          traversal.wall &&
          frameInput.wallClimb! > 0 &&
          !jumpPressed &&
          (traversal.wallRunActive || !swingHeld || traversal.swingNeedsRelease) &&
          !zipPressed
        ) {
          const target = findMantleTarget(
            traversal.position,
            traversal.wall.normal,
            raycastWorld,
            (point) => exactWorld.isCapsuleClear(point),
          );
          if (target) {
            traversal.mantle = { target, elapsed: 0 };
            traversal.wallCrawlActive = false;
            traversal.wallRunActive = false;
          }
        }
        const windAssist = sampleWindAssist(traversal, raceVisuals.lanes, delta);
        windActive = windAssist.active;
        // Every substep resolves the actual mesh before the next force update.
        const physicsStart = performance.now();
        let collisionMs = 0;
        const simulationSteps = Math.max(1, Math.ceil(delta / (1 / 120)));
        const simulationDelta = delta / simulationSteps;
        const frameEvents: TraversalEvent[] = [];
        let frameContext = refreshTraversalContext(
          traversal,
          frameInput,
          traversalOverrides,
        );
        for (
          let simulationIndex = 0;
          simulationIndex < simulationSteps;
          simulationIndex++
        ) {
          const physicsInput: TraversalInput =
            simulationIndex === 0
              ? frameInput
              : {
                  ...frameInput,
                  jumpPressed: false,
                  rollPressed: false,
                  trickPressed: false,
                  swingPressed: false,
                  swingReleased: false,
                  zipPressed: false,
                  zipReleased: false,
                  wallCrawlPressed: false,
                  glidePressed: false,
                  chargeJumpReleased: false,
                  slingshotReleased: false,
                };
          const beforeMotion = new THREE.Vector3().copy(traversal.position);
          const wasGrounded = traversal.grounded;
          const incomingVelocity = new THREE.Vector3().copy(traversal.velocity);
          const result = stepTraversalInPlace(
            traversal,
            physicsInput,
            {
              ...featureQuery,
              predictiveAssistAcceleration,
              windAcceleration: windAssist.acceleration ?? undefined,
              externalCollision: Boolean(exactWorld),
              hasLineOfSight: exactWorld
                ? (origin, target) => {
                    const direction = new THREE.Vector3()
                      .copy(target)
                      .sub(origin);
                    const maximum = direction.length() - 0.1;
                    return (
                      maximum > 0 &&
                      !raycastWorld(
                        new THREE.Vector3().copy(origin),
                        direction.normalize(),
                        maximum,
                      )
                    );
                  }
                : undefined,
              groundY: exactWorld ? -10000 : localGroundY,
              canRoll: exactWorld
                ? (point, velocity) =>
                    hasRollCorridor(exactWorld, point, velocity)
                : undefined,
              sampleGround: exactWorld
                ? (point, stepUp, maximumDrop) =>
                    meshSupportAt(point, stepUp, maximumDrop ?? 0.1)?.point.y ??
                    null
                : undefined,
              wallContact: exactWorld ? meshWallContact : undefined,
              colliders: exactWorld ? [] : activeColliders,
              anchorColliders: exactWorld
                ? []
                : nearbyColliders(player.position, 110),
              anchorCandidates,
              zipTargets: pointerZipActive
                ? anchorCandidates.slice(0, 1)
                : anchorCandidates,
            },
            simulationDelta,
            traversalOverrides,
          );

          if (exactWorld) {
            // Carry the post-force velocity into the impact redirect, not last frame's velocity.
            incomingVelocity.copy(traversal.velocity);
            const collisionStart = performance.now();
            const hit = exactWorld.sweepCapsule(
              beforeMotion,
              traversal.position,
              traversal.velocity,
            );
            collisionMs += performance.now() - collisionStart;
            const position = hit.position;
            const velocity = hit.velocity;
            meshWallContact = null;
            const blocked =
              Boolean(hit.wallNormal) || (hit.blocked && !hit.grounded);
            if (hit.wallNormal)
              meshWallContact = {
                point: position.clone(),
                normal: hit.wallNormal,
                feetTouching: hit.feetTouching,
                colliderId: 'rendered-facade',
              };
            // A feet-level probe maintains Q contact at collision skin distance.
            const previousWall = traversal.wall;
            const contactNormal =
              meshWallContact?.normal ?? previousWall?.normal;
            if (contactNormal)
              meshWallContact = probeWallFeet(
                position,
                contactNormal,
                raycastWorld,
              );
            const support =
              velocity.y <= 0.1 ? meshSupportAt(position, 0.015, 0.51) : null;
            const supportY = support ? capsuleSupportHeight(support) : null;
            traversal.grounded = Boolean(
              supportY !== null && Math.abs(position.y - supportY) < 0.045,
            );
            if (supportY !== null && traversal.grounded) {
              const beforeSnap = position.y;
              position.y = supportY;
              if (exactWorld.isCapsuleClear(position, 0.46, 2.05, false))
                velocity.y = Math.max(0, velocity.y);
              else {
                position.y = beforeSnap;
                traversal.grounded = false;
              }
            }
            const willStreetSkim = Boolean(
              traversal.swing &&
              physicsInput.swingHeld &&
              !physicsInput.diveHeld &&
              Math.hypot(velocity.x, velocity.z) >= 7.5 &&
              (traversal.swing.groundSkimSeconds ?? 0) < 0.48,
            );
            if (!wasGrounded && traversal.grounded && !willStreetSkim) {
              traversal.landingSeconds = 0.25;
              traversal.landingImpact = Math.max(0, -incomingVelocity.y);
              const landingState = { ...traversal, position, velocity };
              applyLandingRoll(
                landingState,
                physicsInput,
                traversal.landingImpact,
                (p, v) => hasRollCorridor(exactWorld, p, v),
              );
              traversal.rollSeconds = landingState.rollSeconds;
              traversal.groundJump = false;
              velocity.copy(landingState.velocity);
              result.events.push({
                type: 'land',
                position: { ...traversal.position },
                strength: traversal.landingImpact / 30,
              });
            }
            if (traversal.grounded) traversal.airSeconds = 0;
            setTraversalKinematics(traversal, position, velocity);
            if (meshWallContact) {
              traversal.wall = {
                ...previousWall,
                ...meshWallContact,
                feetTouching: meshWallContact.feetTouching === true,
                contactSeconds: previousWall?.contactSeconds ?? 0,
                graceSeconds: SPIDER_TRAVERSAL_FEEL.wallContactGrace,
              };
            } else if (traversal.wall) {
              // The physics tick owns the grace clock. A render/probe miss must not reset it.
              traversal.wall.feetTouching = false;
            }
            if (!meshWallContact?.feetTouching) {
              traversal.wallCrawlActive = false;
              if (!hasWallRunSupport(traversal.wall)) {
                if (traversal.wallRunActive && swingHeld)
                  traversal.swingNeedsRelease = false;
                traversal.wallRunActive = false;
                traversal.wall = null;
              }
            } else
              acceptTraversalWallContact(
                traversal,
                meshWallContact,
                incomingVelocity,
                physicsInput,
                traversalOverrides,
              );
            const swing = traversal.swing;
            if (swing) {
              const anchor = new THREE.Vector3().copy(swing.visualAnchor ?? swing.anchor);
              const line = anchor
                .clone()
                .sub(position.clone().add(new THREE.Vector3(0, 1.3, 0)));
              const obstruction = raycastWorld(
                position.clone().add(new THREE.Vector3(0, 1.3, 0)),
                line.clone().normalize(),
                Math.max(0, line.length() - 0.1),
              );
              const excess =
                position.distanceTo(
                  new THREE.Vector3().copy(swing.simulationPivot ?? swing.pivot ?? swing.anchor),
                ) - swing.ropeLength;
              const ropeTolerance = Math.max(0.25, swing.ropeLength * 0.01);
              const incompatibleContact = blocked && excess > ropeTolerance;
              if (!obstruction && !traversal.grounded && !incompatibleContact)
                resolveSwingContinuation(traversal, {}, physicsInput, traversalOverrides);
              if (obstruction || traversal.grounded || incompatibleContact) {
                const transition = resolveSwingContinuation(traversal, {
                  obstruction: obstruction ? { point: obstruction.point, normal: obstruction.normal, id: 'mesh-corner' } : null,
                  constraintBlocked: incompatibleContact,
                  contact: meshWallContact,
                  candidates: anchorCandidates.length ? anchorCandidates : collectAnchorCandidates(pointerNdc),
                  hasLineOfSight: (origin, target) => {
                    const ray = new THREE.Vector3().copy(target).sub(origin);
                    const distance = ray.length();
                    return !raycastWorld(new THREE.Vector3().copy(origin), ray.normalize(), Math.max(0, distance - .15));
                  },
                  dt: simulationDelta,
                }, physicsInput, traversalOverrides, result.events);
                renderer.domElement.dataset.swingTransition = transition;
                if (transition === 'detach') renderer.domElement.dataset.swingDetachReason = 'no-valid-continuation';
              } else if (
                excess > 0 &&
                excess <= 0.5 &&
                swing.ropeLength + excess <= swing.maximumLength
              ) {
                // Pay out only measured numerical/contact clearance; never pull the
                // body back across a facade to satisfy the old rope projection.
                swing.ropeLength += excess;
              }
            }
            if (traversal.zip && !traversal.zip.airDash && blocked) {
              const toTarget = new THREE.Vector3()
                .copy(traversal.zip.target)
                .sub(position);
              if (
                (meshWallContact &&
                  velocity.dot(toTarget.clone().normalize()) < 0.5) ||
                (traversal.grounded && toTarget.length() < 1.2)
              ) {
                traversal.zip = null;
                pointerZipActive = false;
              }
            }
            if (blocked) buildingCorrectionCount++;
            commitAdvancedMotion(
              traversal,
              physicsInput,
              traversalOverrides,
              simulationDelta,
              result.events,
            );
            result.context = refreshTraversalContext(
              traversal,
              physicsInput,
              traversalOverrides,
            );
            renderer.domElement.dataset.meshContacts = String(
              buildingCorrectionCount,
            );
            renderer.domElement.dataset.spawnSurfaceVerified = String(
              Boolean(support),
            );
          } else if (
            enforceBuildingSolidity(
              traversal.position,
              traversal.velocity,
              activeColliders,
            )
          ) {
            buildingCorrectionCount += 1;
            renderer.domElement.dataset.buildingCorrectionCount = String(
              buildingCorrectionCount,
            );
          }

          frameEvents.push(...result.events);
          frameContext = result.context;
        }
        const result = {
          state: traversal,
          context: frameContext,
          events: frameEvents,
        };

        player.position.set(
          traversal.position.x,
          traversal.position.y,
          traversal.position.z,
        );
        player.velocity.set(
          traversal.velocity.x,
          traversal.velocity.y,
          traversal.velocity.z,
        );
        telemetry.record('physics', performance.now() - physicsStart - collisionMs);
        telemetry.record('collision', collisionMs);
        player.grounded = traversal.grounded;
        if (trial) {
          trial.distance += player.position.distanceTo(trial.previous);
          trial.previous.copy(player.position);
          trial.peakSpeed = Math.max(trial.peakSpeed, player.velocity.length());
          trial.peakHeight = Math.max(
            trial.peakHeight,
            player.position.y - trial.startY,
          );
          if (!player.grounded) trial.air += delta;
          trial.attaches += result.events.filter(
            (event) => event.type === 'web-attached',
          ).length;
          if (meshWallContact) trial.contacts++;
          if (trial.elapsed >= trial.nextCheck && exactWorld) {
            trial.nextCheck = trial.elapsed + 0.2;
            trial.penetrationChecks++;
            if (
              !exactWorld.isCapsuleClear(player.position, 0.46, 2.05, false)
            ) {
              trial.penetrations++;
              if (trial.penetrationDetails.length < 4) {
                const support = exactWorld.supportAt(
                  player.position,
                  0.02,
                  0.6,
                );
                trial.penetrationDetails.push({
                  position: player.position.toArray(),
                  velocity: player.velocity.toArray(),
                  surfaceClear: exactWorld.isCapsuleClear(
                    player.position,
                    0.46,
                    2.05,
                    false,
                  ),
                  support: support
                    ? {
                        point: support.point.toArray(),
                        normal: support.normal.toArray(),
                      }
                    : null,
                });
              }
            }
          }
          const report = {
            map: currentDistrict,
            seconds: +trial.elapsed.toFixed(1),
            distance: +trial.distance.toFixed(1),
            peakSpeed: +trial.peakSpeed.toFixed(1),
            peakHeight: +trial.peakHeight.toFixed(1),
            airbornePercent: Math.round((100 * trial.air) / trial.elapsed),
            attachments: trial.attaches,
            contactFrames: trial.contacts,
            penetrationChecks: trial.penetrationChecks,
            penetrations: trial.penetrations,
            penetrationDetails: trial.penetrationDetails,
          };
          trialOutput.textContent = `${trial.elapsed < 16 ? 'Running' : 'Complete'}: ${JSON.stringify(report)}`;
          if (trial.elapsed >= 16) {
            trial = null;
            clearKeys();
          }
        }
        if (hero.traversal === 'ironman' && player.grounded)
          ironFlightMode = 'grounded';
        player.facing = result.context.animation.bodyYaw;
        for (const traversalEvent of result.events) {
          if (process.env.NODE_ENV !== 'production') {
            renderer.domElement.dataset.lastTraversalEvent =
              traversalEvent.type;
            if (traversalEvent.type === 'jump')
              renderer.domElement.dataset.jumpCount = String(
                Number(renderer.domElement.dataset.jumpCount ?? 0) + 1,
              );
          }
          if (traversalEvent.type === 'web-attached' && traversal.swing) {
            callbacksRef.current.onSwingAttached();
            const anchor = traversal.swing.anchor;
            renderer.domElement.dataset.lastSwingAnchor = [
              anchor.x,
              anchor.y,
              anchor.z,
            ]
              .map((value) => value.toFixed(2))
              .join(',');
            renderer.domElement.dataset.lastSwingSource = 'pointer';
          }
          if (traversalEvent.type === 'zip-started' && traversal.zip) {
            grappleLineUntil = elapsedTime + (pointerZipActive ? 0.16 : 0.28);
            renderer.domElement.dataset.lastGrappleTarget = [
              traversal.zip.target.x,
              traversal.zip.target.y,
              traversal.zip.target.z,
            ]
              .map((value) => value.toFixed(2))
              .join(',');
            renderer.domElement.dataset.lastGrappleSource = pointerZipActive
              ? 'click'
              : 'keyboard';
          }
        }
        if (pointerZipActive && !traversal.zip) pointerZipActive = false;
        jumpPressed = false;
        rollPressed = false;
        wallCrawlPressed = false;
        zipPressed = false;
        pointerPressed = false;
        pointerReleased = false;
        glidePressed = false;
        chargeJumpReleased = false;
        slingshotReleased = false;
        cancelAbilities = false;
        hoverTogglePressed = false;
        cruiseTogglePressed = false;

        if (player.position.y < -20) {
          const home = getDistrict(currentDistrict);
          player.position.copy(safeSpawn(home));
          player.velocity.set(0, 0, 0);
          player.grounded = true;
          avatar?.root.position.copy(player.position);
          setTraversalKinematics(traversal, player.position, player.velocity);
          traversal.grounded = true;
          traversal.mode = 'idle';
          traversal.advanced = createTraversalState().advanced;
          traversal.swing = null;
          traversal.zip = null;
          traversal.wall = null;
          traversal.wallCrawlActive = false;
          traversal.mantle = null;
          meshWallContact = null;
          result.context = refreshTraversalContext(
            traversal,
            frameInput,
            traversalOverrides,
          );
        }
        if (exactWorld && !player.grounded && elapsedTime >= predictionAfter) {
          predictionAfter = elapsedTime + 0.12;
          const predicted = predictTraversalLanding(
            exactWorld,
            player.position,
            player.velocity,
          );
          const envelope = player.position
            .clone()
            .add(new THREE.Vector3(0, 0.2, 0));
          landingPrediction = {
            time: predicted.time,
            clear:
              predicted.clear &&
              exactWorld.isCapsuleClear(envelope, 1.15, 3.1, false),
          };
        } else if (player.grounded)
          landingPrediction = { time: 0, clear: false };
        const animationStart = performance.now();
        updateAvatar(delta, elapsedTime, result.context);
        telemetry.record('animation', performance.now() - animationStart);
        if (exactWorld && elapsedTime >= trickProbeAt && player.velocity.length() > 20) {
          trickProbeAt = elapsedTime + .12;
          const direction = player.velocity.clone().setY(0).normalize();
          const side = new THREE.Vector3(-direction.z, 0, direction.x);
          const chest = player.position.clone().add(new THREE.Vector3(0, 1.1, 0));
          trickClearance = {
            left: raycastWorld(chest, side, 8)?.distance ?? 8,
            right: raycastWorld(chest, side.clone().negate(), 8)?.distance ?? 8,
          };
        }
        const trickAwards = tricks.update({
          dt: delta, state: traversal, events: result.events,
          groundY: localGroundY, contact: Boolean(meshWallContact),
          impactSpeed: Math.max(0, lastTrickSpeed - player.velocity.length()),
          clearance: trickClearance, animation: avatar?.animator.animationSample,
        });
        lastTrickSpeed = player.velocity.length();
        trickQueue.push(...trickAwards);
        if (trickQueue.length > 5) trickQueue.splice(0, trickQueue.length - 5);
        if (trickQueue.length && elapsedTime - hudAnnouncementAt > 1.1) {
          hudAnnouncement = trickQueue.shift()!;
          hudAnnouncementAt = elapsedTime;
        }
        const missionView = missions.step(delta,{position:traversal.position,interact:interactPressed,score:tricks.score,alive:player.position.y>-20});
        interactPressed = false;
        missionVisuals.update(missionView, elapsedTime);
        renderer.domElement.dataset.mission = missionView ? JSON.stringify(missionView) : '';
        renderer.domElement.dataset.trickScore = String(tricks.score);
        renderer.domElement.dataset.trickChain = String(tricks.chain);
        renderer.domElement.dataset.flowMultiplier = tricks.multiplier.toFixed(1);
        if (race) {
          const point = player.position.toArray() as RacePoint;
          race.tick(raceNow(), point, {mode:traversal.mode,speed:player.velocity.length(),verticalSpeed:player.velocity.y,events:result.events.map(e=>e.type),styleScore:tricks.score,wind:windActive});
          prepareRaceCourse();
          if (race.phase === 'racing') recorder?.capture(race.time);
          if (ghostRig && ghostRecord) {
            ghostRig.root.visible =
              race.phase === 'racing' && race.time <= ghostRecord.time;
            if (ghostRig.root.visible)
              poseGhost(ghostRig, ghostRecord, race.time);
          }
          raceVisuals.setProgress(race.activeGateIds,race.completedGateIds);
          raceVisuals.update(point, elapsedTime);
          if (elapsedTime >= raceHudAt) {
            raceHudAt = elapsedTime + 0.1;
            const finish = race.currentGate?.position ?? race.course?.finish;
            const toGoal = finish
              ? new THREE.Vector3()
                  .fromArray(finish)
                  .sub(player.position)
                  .setY(0)
                  .normalize()
              : null;
            const heading = player.velocity.clone().setY(0).normalize();
            const guidance =
              toGoal && player.velocity.length() > 3
                ? heading.dot(toGoal) > 0.6
                  ? 'ON COURSE'
                  : new THREE.Vector3().crossVectors(heading, toGoal).y > 0
                    ? 'TURN LEFT'
                    : 'TURN RIGHT'
                : raceMessage;
            callbacksRef.current.onRaceView?.({
              phase: race.phase,
              target: race.currentGate?.position,
              route: race.course ? raceRoutePoints(race.course,race.activeGateIds) : [],
              gateIndex: race.splits.length,
              gateCount: race.gateCount,
              gateType: race.currentGate?.type,
              missedGate: race.missedGate,
              splits: race.splits,
              splitDelta: race.splitDelta,
              medal: race.medal,
              styleScore: race.styleScore,
              mode: ['countdown','racing','inviting'].includes(race.phase) ? race.course?.mode ?? selectedRaceMode : selectedRaceMode,
              time: race.time,
              countdown: Math.max(
                0,
                Math.ceil(
                  ((race.phase === 'inviting' || race.phase === 'invited'
                    ? race.until
                    : race.startAt) -
                    raceNow()) /
                    1000,
                ),
              ),
              best: raceBest,
              distance: finish ? Math.round(raceDistance(point, finish)) : 0,
              participants: Math.max(1, race.participants.size),
              course: race.course,
              results: [...race.results]
                .map(([id, time]) => ({ id, time, score: race?.scores.get(id) ?? 0 }))
                .sort((a, b) => raceResultValue(race?.course?.mode??'speed',a.time,a.score)-raceResultValue(race?.course?.mode??'speed',b.time,b.score)),
              ghost: Boolean(ghostRecord),
              wind: windActive,
              message: race.phase === 'racing' ? guidance : raceMessage,
            });
            callbacksRef.current.onMapPlayers?.([
              { id: race.id, position: point, self: true },
              ...Array.from(remoteStates.values()).map((p) => ({
                id: p.playerId,
                position: p.position,
                self: false,
              })),
            ]);
            renderer.domElement.dataset.racePhase = race.phase;
            renderer.domElement.dataset.raceId = race.raceId;
            renderer.domElement.dataset.raceFinish = finish?.join(',') ?? '';
            renderer.domElement.dataset.ghostLoaded = String(
              Boolean(ghostRecord),
            );
            renderer.domElement.dataset.windActive = String(windActive);
          }
        }
        if (wallTrial && exactWorld) {
          wallTrial.frames++;
          wallTrial.modes.add(traversal.mode);
          wallTrial.clips.add(avatar?.animator.activeClip ?? 'missing');
          if (!exactWorld.isCapsuleClear(player.position, 0.46, 2.05, false))
            wallTrial.penetrations++;
          if (traversal.mode === 'wallJump')
            wallTrial.wallJumpSpeed = Math.max(
              wallTrial.wallJumpSpeed,
              player.velocity.length(),
            );
          trialOutput.textContent = `${wallTrial.elapsed < 7 ? 'Running' : 'Complete'}: ${JSON.stringify({ seconds: +wallTrial.elapsed.toFixed(2), modes: [...wallTrial.modes], clips: [...wallTrial.clips], frames: wallTrial.frames, penetrations: wallTrial.penetrations, wallJumpSpeed: +wallTrial.wallJumpSpeed.toFixed(2) })}`;
          if (wallTrial.elapsed >= 7) {
            wallTrial = null;
            clearKeys();
          }
        }
        updateRemoteAvatars(delta);
        if (multiplayer && elapsedTime - lastNetworkBroadcast >= 0.125) {
          lastNetworkBroadcast = elapsedTime;
          multiplayer.publish({
            suitId: activeSuitId,
            position: [player.position.x, player.position.y, player.position.z],
            velocity: [player.velocity.x, player.velocity.y, player.velocity.z],
            yaw: player.facing,
            mode:
              hero.traversal === 'ironman' && !player.grounded
                ? `iron-${ironFlightMode === 'cruise' && pointerHeld ? 'boost' : ironFlightMode}`
                : avatarPose === 'perch'
                  ? 'perch'
                  : result.context.animation.state,
            sequence: ++networkSequence,
            sentAt: Date.now(),
          });
        }

        const grappleLineVisible = Boolean(
          traversal.zip &&
          traversal.zip.targetId !== 'air-zip-no-anchor' &&
          elapsedTime < grappleLineUntil,
        );
        const webVisible = Boolean(traversal.swing || grappleLineVisible);
        webLine.visible = webVisible && !webStrand;
        if (webVisible) {
          const hand = avatar
            ? avatar.animator.webHand(new THREE.Vector3())
            : player.position.clone().add(new THREE.Vector3(0, 1.58, 0));
          const webTarget =
            traversal.swing?.anchor ??
            traversal.zip?.surfacePoint ??
            traversal.zip?.target;
          if (webTarget) {
            if (webStrand)
              webStrand.update(
                hand,
                webTargetPoint.set(webTarget.x, webTarget.y, webTarget.z),
                true,
                result.context.webTension,
              );
            else
              webPositions.set([
              hand.x,
              hand.y,
              hand.z,
              webTarget.x,
              webTarget.y,
              webTarget.z,
            ]);
            (
              webGeometry.getAttribute('position') as THREE.BufferAttribute
            ).needsUpdate = true;
          }
        } else
          webStrand?.update(player.position, player.position, false);
        const handOrigins = avatar
          ? ['leftHand', 'rightHand'].map(
              (role) =>
                avatar?.animator.bones
                  .find((b) => b.role === role)
                  ?.bone.getWorldPosition(new THREE.Vector3()) ??
                player.position.clone(),
            )
          : [player.position, player.position];
        extraTethers.update(handOrigins, traversal.advanced);
        const ability = traversal.advanced;
        renderer.domElement.dataset.swingPhase = ability?.phase ?? 'air';
        renderer.domElement.dataset.glideActive = String(
          Boolean(ability?.gliding),
        );
        renderer.domElement.dataset.flowChain = String(ability?.flow ?? 0);
        const speed = result.context.speed;
        // Camera yaw is the player's swing heading. Following velocity here
        // feeds anchor-induced drift back into input and overrides mouse aim.
        const perched = avatarPose === 'perch' && player.grounded;
        const ironCamera = hero.traversal === 'ironman';
        const baseDistance = perched
          ? 5.2
          : ironCamera
            ? 5.4 + Math.min(speed / 72, 1) * 1.8
            : Math.min(14, result.context.camera.followDistance);
        const experimentalCamera = callbacksRef.current.experimentalCamera === true;
        const cameraZoom = clamp(callbacksRef.current.cameraZoom ?? 1, 1, 10);
        const cameraZoomBlend = experimentalCamera ? (cameraZoom - 1) / 9 : 0;
        const distance = Math.max(3.15, baseDistance * THREE.MathUtils.lerp(1, .42, cameraZoomBlend));
        const horizontalDistance = Math.cos(cameraPitch) * distance;
        const wallNormal = result.context.wallNormal
          ? new THREE.Vector3(
              result.context.wallNormal.x,
              result.context.wallNormal.y,
              result.context.wallNormal.z,
            ).normalize()
          : null;
        let wallTopClearance = Infinity;
        if (wallNormal) {
          for (const collider of activeColliders) {
            const nearX =
              player.position.x > collider.min.x - 0.75 &&
              player.position.x < collider.max.x + 0.75;
            const nearZ =
              player.position.z > collider.min.z - 0.75 &&
              player.position.z < collider.max.z + 0.75;
            if (
              !nearX ||
              !nearZ ||
              player.position.y < collider.min.y - 0.2 ||
              player.position.y > collider.max.y + 0.2
            )
              continue;
            wallTopClearance = Math.min(
              wallTopClearance,
              collider.max.y - player.position.y,
            );
          }
        }
        const wallCameraRequested =
          (traversal.mode === 'wallCrawl' || traversal.mode === 'wallRun') &&
          (traversal.wallCrawlActive || Boolean(traversal.wallRunActive)) &&
          Boolean(wallNormal);
        if (wallCameraRequested && wallNormal && !wallCameraWasRequested) {
          wallCameraNormal.copy(wallNormal);
          wallCameraYawAnchor = cameraYaw;
        }
        wallCameraWasRequested = wallCameraRequested;
        wallCameraBlend = damp(
          wallCameraBlend,
          wallCameraRequested ? 1 : 0,
          wallCameraRequested ? 5.5 : 11,
          delta,
        );
        if (wallNormal)
          wallCameraNormal
            .lerp(wallNormal, 1 - Math.exp(-10 * delta))
            .normalize();
        const target = experimentalCamera
          ? player.position.clone().add(new THREE.Vector3(0, 1.15, 0))
          : player.position
              .clone()
              .add(
                new THREE.Vector3(
                  result.context.camera.lookAhead.x * (ironCamera ? 0.08 : 0.28),
                  1.35 +
                    result.context.camera.lookAhead.y *
                      (reducedMotion ? 0.16 : 0.38),
                  result.context.camera.lookAhead.z * (ironCamera ? 0.08 : 0.28),
                ),
              );
        if (perched && avatar) {
          // Collision-check the sightline to the actual crouched body, not to a
          // standing-height point above it. Otherwise a parapet can hide the
          // entire crouch while the old camera ray passes harmlessly overhead.
          const head = avatar.animator.bones.find(
            (entry) => entry.role === 'head',
          )?.bone;
          if (head) {
            avatar.root.updateMatrixWorld(true);
            head.getWorldPosition(target);
          } else target.copy(player.position).add(new THREE.Vector3(0, 0.7, 0));
        }
        const desired = player.position
          .clone()
          .add(
            new THREE.Vector3(
              Math.sin(cameraYaw) * horizontalDistance,
              result.context.camera.heightOffset +
                Math.sin(cameraPitch) * distance,
              Math.cos(cameraYaw) * horizontalDistance,
            ),
          );
        if (wallCameraBlend > 0.001) {
          const wallTarget = player.position
            .clone()
            .add(new THREE.Vector3(0, 1.2, 0));
          const wallDesired = player.position
            .clone()
            .add(
              wallCameraOffset(
                wallCameraNormal,
                cameraYaw - wallCameraYawAnchor,
                cameraPitch,
              ),
            );
          target.lerp(wallTarget, wallCameraBlend);
          desired.lerp(wallDesired, wallCameraBlend);
        }
        const combatCamera = bosses.snapshot();
        const combatPlayerFocus = player.position
          .clone()
          .add(new THREE.Vector3(0, 1.35, 0));
        const bossFocus = combatCamera
          ? new THREE.Vector3().copy(combatCamera.position).add(
              new THREE.Vector3(
                0,
                BOSS_DEFINITIONS[combatCamera.id].height * .48,
                0,
              ),
            )
          : null;
        const combatSeparation = bossFocus
          ? bossFocus.distanceTo(combatPlayerFocus)
          : Infinity;
        const combatSight = bossFocus
          ? bossFocus.clone().sub(combatPlayerFocus)
          : new THREE.Vector3();
        const combatVisible = !bossFocus || !exactWorld || combatSeparation < 1 ||
          !raycastWorld(combatPlayerFocus, combatSight.clone().normalize(), combatSeparation - .65);
        combatCameraBlend = damp(
          combatCameraBlend,
          combatCamera?.status === 'active' && combatSeparation < 58 && combatVisible ? 1 : 0,
          combatCamera?.cinematic ? 5.5 : 7,
          delta,
        );
        if (bossFocus && combatCameraBlend > .001) {
          const toBoss = bossFocus.clone().sub(combatPlayerFocus).normalize();
          const shoulder = new THREE.Vector3(-toBoss.z, 0, toBoss.x);
          const combatTarget = combatCamera?.cinematic
            ? bossFocus.clone()
            : combatPlayerFocus.clone().addScaledVector(toBoss, Math.min(1.4, combatSeparation * .1));
          const combatDesired = combatCamera?.cinematic
            ? bossFocus.clone().addScaledVector(toBoss, -8).addScaledVector(shoulder, 3).add(new THREE.Vector3(0, 2.8, 0))
            : combatPlayerFocus.clone().addScaledVector(toBoss, -6.4).addScaledVector(shoulder, 1.55).add(new THREE.Vector3(0, 2.35, 0));
          if (exactWorld) {
            constrainCameraBoom(combatPlayerFocus, combatTarget, raycastWorld, .3);
            constrainCameraBoom(combatTarget, combatDesired, raycastWorld, .42);
          }
          target.lerp(combatTarget, combatCameraBlend);
          desired.lerp(combatDesired, combatCameraBlend);
        }
        if (exactWorld) {
          // Look-ahead itself can cross a facade. Keep the focus on the player's
          // side before testing the boom, otherwise a legal exterior player can
          // acquire an interior target and collapse the camera into the suit.
          const center = player.position
            .clone()
            .add(new THREE.Vector3(0, perched ? 0.85 : 1.25, 0));
          constrainCameraBoom(center, target, raycastWorld, 0.18);
          constrainCameraBoom(target, desired, raycastWorld);
          if (desired.distanceTo(target) < 2.4) {
            target.copy(center);
            let best = desired.clone(),
              bestScore = -Infinity;
            const fallbackDistance = Math.max(2.8, distance);
            for (const turn of [
              0,
              0.55,
              -0.55,
              1.1,
              -1.1,
              1.65,
              -1.65,
              Math.PI,
            ]) {
              const yaw = cameraYaw + turn;
              const candidate = center
                .clone()
                .add(
                  new THREE.Vector3(
                    Math.sin(yaw) * fallbackDistance,
                    Math.max(1.55, fallbackDistance * .37),
                    Math.cos(yaw) * fallbackDistance,
                  ),
                );
              constrainCameraBoom(center, candidate, raycastWorld);
              const clearance = candidate.distanceTo(center);
              const score = Math.min(fallbackDistance, clearance) - Math.abs(turn) * 0.45;
              if (score > bestScore) {
                bestScore = score;
                best = candidate;
              }
            }
            desired.copy(best);
          }
        } else cameraAgainstWorld(target, desired, activeColliders);
        const boom = desired.clone().sub(target),
          allowedDistance = boom.length();
        cameraBoomDistance =
          allowedDistance < cameraBoomDistance
            ? allowedDistance
            : Math.min(allowedDistance, cameraBoomDistance + delta * 5);
        desired
          .copy(target)
          .addScaledVector(boom.normalize(), cameraBoomDistance);
        camera.position.lerp(desired, 1 - Math.exp(-14 * delta));
        if (exactWorld)
          constrainCameraBoom(target, camera.position, raycastWorld);
        if (
          camera.position.distanceTo(target) < 1.8 &&
          desired.distanceTo(target) > 2.4
        )
          camera.position.copy(desired);
        const traversalFov = ironCamera
          ? Math.min(68, result.context.camera.fov)
          : result.context.camera.fov;
        const cameraFov = experimentalCamera && combatCameraBlend <= .01
          ? THREE.MathUtils.lerp(traversalFov, Math.max(48, traversalFov - 10), cameraZoomBlend)
          : traversalFov;
        camera.fov = damp(
          camera.fov,
          combatCameraBlend > .01
            ? combatCamera?.cinematic
              ? 52
              : 59 + Math.min(5, combatSeparation / 20)
            : cameraFov,
          7,
          delta,
        );
        camera.updateProjectionMatrix();
        cameraRoll = damp(
          cameraRoll,
          reducedMotion
            ? 0
            : Math.max(-0.065, Math.min(0.065, result.context.camera.roll)) *
                (1 - wallCameraBlend) * (1 - combatCameraBlend),
          5,
          delta,
        );
        camera.up.set(0, 1, 0);
        camera.lookAt(target);
        camera.rotateZ(cameraRoll);
        speedBlur.update(
          delta,
          speed,
          result.events.some((event) =>
            [
              'jump',
              'double-jump',
              'point-launch',
              'web-released',
              'slingshot-launch',
              'loop-completed',
            ].includes(event.type),
          ),
          reducedMotion,
          traversal.mode === 'glide',
        );
        renderer.domElement.dataset.motionBlur = speedBlur.strength.toFixed(4);
        sun.position.set(
          player.position.x - 180,
          player.position.y + 360,
          player.position.z + 170,
        );

        hudAccumulator += delta;
        fpsAccumulator += rawDelta;
        fpsFrames += 1;
        if (fpsAccumulator > 0.7) {
          measuredFps = Math.round(fpsFrames / fpsAccumulator);
          fpsFrames = 0;
          fpsAccumulator = 0;

        }
        if (hudAccumulator > 0.15) {
          const groundY = groundYAt(player.position);
          const slingCharge = traversal.advanced?.sling
            ? Math.min(
                1,
                traversal.advanced.sling.seconds /
                  ADVANCED_TUNING.slingChargeSeconds,
              )
            : 0;
          const jumpCharge = Math.min(
            1,
            (traversal.advanced?.chargeJump ?? 0) /
              ADVANCED_TUNING.chargeJumpSeconds,
          );
          const swingCharge = traversal.swing
            ? Math.min(1, traversal.swing.attachedSeconds / 1.35)
            : 0;
          const charge = Math.max(slingCharge, jumpCharge, swingCharge);
          const calloutPoint = player.position
            .clone()
            .add(new THREE.Vector3(0, 1.45, 0))
            .project(camera);
          const horizontalMotion = player.velocity.clone();
          horizontalMotion.y = 0;
          if (horizontalMotion.lengthSq() < 1) {
            horizontalMotion.set(
              Math.sin(player.facing),
              0,
              Math.cos(player.facing),
            );
          } else horizontalMotion.normalize();
          const projectedMotion = player.position
            .clone()
            .add(new THREE.Vector3(0, 1.45, 0))
            .addScaledVector(horizontalMotion, 4)
            .project(camera);
          const calloutX = THREE.MathUtils.clamp(
            (calloutPoint.x * 0.5 + 0.5) * 100,
            14,
            86,
          );
          const calloutY = THREE.MathUtils.clamp(
            (1 - (calloutPoint.y * 0.5 + 0.5)) * 100,
            28,
            76,
          );
          const motionToRight = projectedMotion.x > calloutPoint.x + 0.015;
          const calloutSide =
            calloutX < 35
              ? 'right'
              : calloutX > 65
                ? 'left'
                : motionToRight
                  ? 'left'
                  : 'right';
          callbacksRef.current.onHud({
            boss: bosses.snapshot(), mission: missions.view(), activityMessage, trickScore: tricks.score, flowMultiplier: tricks.multiplier,
            speed: Math.round(speed * 3.6),
            altitude: Math.max(0, Math.round(player.position.y - groundY)),
            fps: measuredFps,
            swinging: Boolean(traversal.swing),
            mode: traversal.mode,
            charge,
            chargeLabel:
              slingCharge > 0
                ? 'SLINGSHOT CHARGE'
                : jumpCharge > 0
                  ? 'CHARGE JUMP'
                  : swingCharge > 0
                    ? 'WEB TENSION'
                    : '',
            announcement:
              elapsedTime - hudAnnouncementAt < 2.6 ? hudAnnouncement : null,
            callout: { x: calloutX, y: calloutY, side: calloutSide },
          });
          renderer.domElement.dataset.playerPosition = [
            player.position.x,
            player.position.y,
            player.position.z,
          ]
            .map((value) => value.toFixed(2))
            .join(',');
          renderer.domElement.dataset.grounded = String(player.grounded);
          renderer.domElement.dataset.groundY = groundY.toFixed(3);
          renderer.domElement.dataset.walkableSurfaceCount = String(
            walkableSurfaces.size,
          );
          renderer.domElement.dataset.traversalMode = traversal.mode;
          renderer.domElement.dataset.colliderCount = String(
            worldColliders.length + indexedColliderCount,
          );
          renderer.domElement.dataset.anchorTargetCount = String(
            anchorTargets.size + indexedColliderCount,
          );
          renderer.domElement.dataset.ropeLength =
            traversal.swing?.ropeLength.toFixed(2) ?? '';
          renderer.domElement.dataset.swingTension =
            traversal.swing?.tension.toFixed(2) ?? '';
          renderer.domElement.dataset.grappling = String(
            Boolean(pointerZipActive && traversal.zip),
          );
          renderer.domElement.dataset.grappleLineVisible =
            String(grappleLineVisible);
          renderer.domElement.dataset.wallContact = traversal.wall
            ? `${traversal.wall.normal.x.toFixed(2)},${traversal.wall.normal.y.toFixed(2)},${traversal.wall.normal.z.toFixed(2)}`
            : '';
          renderer.domElement.dataset.wallCameraBlend =
            wallCameraBlend.toFixed(2);
          renderer.domElement.dataset.wallCameraYawDelta = (
            cameraYaw - wallCameraYawAnchor
          ).toFixed(2);
          renderer.domElement.dataset.wallTopClearance = Number.isFinite(
            wallTopClearance,
          )
            ? wallTopClearance.toFixed(2)
            : '';
          renderer.domElement.dataset.cameraDistance = camera.position
            .distanceTo(player.position)
            .toFixed(2);
          renderer.domElement.dataset.cameraMode = experimentalCamera ? 'experimental' : 'default';
          renderer.domElement.dataset.cameraZoom = cameraZoom.toFixed(0);
          renderer.domElement.dataset.cameraPosition = camera.position
            .toArray()
            .map((n) => n.toFixed(2))
            .join(',');
          hudAccumulator = 0;
        }
        if (quality.update(delta, rawFrameMs, document.visibilityState === 'visible')) {
          const q = quality.settings;
          for (const stream of districtStreams.values()) stream.horizon.detailScale = q.farDetail;
          weather.setDensity(q.weatherDensity);
          raceVisuals.setParticleDensity(q.particleDensity);
          speedBlur.setResolutionScale(q.postprocessScale);
          renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25) * q.resolutionScale);
          resize();
          renderer.domElement.dataset.qualityTier = String(q.level);
        }
        const renderStart = performance.now();
        renderer.info.autoReset = false;
        renderer.info.reset();
        speedBlur.render(renderer, scene, camera);
        telemetry.record('render', performance.now() - renderStart);
        telemetry.setRenderCounters({drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries});
        if (elapsedTime >= telemetryAt) {
          telemetryAt = elapsedTime + 1;
          renderer.domElement.dataset.telemetry = JSON.stringify(telemetry.snapshot());
        }
      };

      const setup = async () => {
        try {
          callbacksRef.current.onStatus('Booting SpiderMan city', 2);
          camera.position
            .copy(initialSpawn)
            .add(new THREE.Vector3(0, 3.68, 10));
          camera.lookAt(initialSpawn.x, 1.4, initialSpawn.z);
          tick();
          await Promise.all([
            loadAvatar(),
            loadWebVisual(),
            loadDistrict(initialDistrict),
          ]);
          if (disposed) return;
          player.position.copy(safeSpawn(initialDistrict));
          cameraYaw = spawnViewYaw(
            player.position,
            initialDistrict.spawnYaw ?? 0,
          );
          traversal.heading = cameraYaw;
          player.facing = cameraYaw;
          player.velocity.set(0, 0, 0);
          player.grounded = true;
          avatar?.root.position.copy(player.position);
          setTraversalKinematics(traversal, player.position, player.velocity);
          traversal.grounded = true;
          traversal.mode = 'idle';
          traversal.advanced = createTraversalState().advanced;
          const setupOffset = new THREE.Vector3(
            Math.sin(cameraYaw) * 10,
            4.4,
            Math.cos(cameraYaw) * 10,
          );
          camera.position.copy(player.position).add(setupOffset);
          camera.up.set(0, 1, 0);
          camera.lookAt(
            player.position.clone().add(new THREE.Vector3(0, 1.4, 0)),
          );
          ready = true;
          if (!trialEnabled) connectMultiplayer();
          setupRace();
          const windWorld = repeatingWorlds.get(currentDistrict);
          if (windWorld) {
            raceVisuals.setCourse(
              createRaceCourse(
                player.position.toArray() as RacePoint,
                windWorld.width,
                windWorld.depth,
                0,
              ),
              windWorld,
            );
            raceVisuals.clear();
          }
          callbacksRef.current.onDistrictChange(initialDistrict.id);
          callbacksRef.current.onStatus(
            `${initialDistrict.name} route online`,
            100,
          );
          callbacksRef.current.onReady();
        } catch (error) {
          if (disposed) return;
          console.error('[game] unable to start SpiderMan city', error);
          callbacksRef.current.onStatus(
            'Could not verify safe city surfaces. Reload to retry.',
            100,
          );
          ready = false;
        }
      };
      void setup();

      return () => {
        disposed = true;
        weather.dispose();
        missionVisuals.dispose();
        bossVisuals.dispose();
        bossLoadingGeneration++;
        activityActionRef.current = () => undefined;
        for (const stream of districtStreams.values()) stream.horizon.dispose();
        trialPanel?.remove();
        webStrand?.dispose();
        webGeometry.dispose();
        (webLine.material as THREE.Material).dispose();
        extraTethers.dispose();
        cancelAnimationFrame(frameId);
        resizeObserver.disconnect();
        renderer.domElement.removeEventListener('mousedown', onPointerDown);
        renderer.domElement.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('pointerlockchange', onPointerLockChange);
        document.removeEventListener('pointerlockerror', onPointerLockError);
        if (document.pointerLockElement === renderer.domElement)
          document.exitPointerLock();
        renderer.domElement.removeEventListener('contextmenu', onContextMenu);
        window.removeEventListener('mouseup', onPointerUp);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', clearKeys);
        void multiplayer?.dispose();
        clearRemoteAvatars();
        scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.geometry.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((material) => material.dispose());
        });
        raceVisuals.dispose();
        removeGhost();
        raceActionRef.current = () => undefined;
        switchSuitRef.current = () => undefined;
        speedBlur.dispose();
        renderer.dispose();
        renderer.domElement.remove();
        travelRef.current = () => undefined;
      };
    }, []);

    return <div ref={mountRef} className="game-mount" />;
  },
);

export default SpiderGame;
