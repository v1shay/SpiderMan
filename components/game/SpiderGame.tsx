'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { getDistrict, getSuit, type DistrictConfig, type DistrictId, type SuitId } from '@/lib/game-config';
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
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(9000, 32, 18),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { topColor: { value: new THREE.Color('#06162b') }, bottomColor: { value: new THREE.Color('#ca4053') } },
      vertexShader: 'varying vec3 vWorld; void main(){ vec4 world = modelMatrix * vec4(position, 1.0); vWorld = world.xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 topColor; uniform vec3 bottomColor; varying vec3 vWorld; void main(){ float h = normalize(vWorld + vec3(0.0, 180.0, 0.0)).y; gl_FragColor = vec4(mix(bottomColor, topColor, smoothstep(-0.14, 0.48, h)), 1.0); }',
    }),
  );
  sky.name = 'NYC twilight sky';
  scene.add(sky);
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

function addAuthoredMapFloor(root: THREE.Group, width: number, depth: number, name: string) {
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(width + 12, .28, depth + 12),
    new THREE.MeshBasicMaterial({ map: createAsphaltTexture(), color: '#d7dce0' }),
  );
  floor.position.y = -.16;
  floor.receiveShadow = true;
  floor.name = `${name} solid gameplay floor`;
  root.add(floor);
  return floor;
}

function addLandmarkColliders(
  scene: THREE.Scene,
  colliders: THREE.Box3[],
  anchors: THREE.Object3D[],
  config: DistrictConfig,
  width: number,
  depth: number,
  height: number,
) {
  const road = clamp(Math.min(width, depth) * .18, 18, 34);
  const blockWidth = Math.max(8, (width - road) / 2);
  const blockDepth = Math.max(8, (depth - road) / 2);
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
      anchors.push(proxy);
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
    scene.fog = new THREE.FogExp2('#07101b', .00024);
    addSky(scene);
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
      const desired = districtSpawn(district);
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
      for (let radius = 8; radius <= 240; radius += 8) {
        for (let step = 0; step < 32; step += 1) {
          const angle = step / 32 * Math.PI * 2;
          const candidate = desired.clone().add(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
          const candidateClearance = clearance(candidate);
          const score = candidateClearance - radius * .006;
          if (candidateClearance >= 0 && score > bestScore) {
            best = candidate;
            bestScore = score;
          }
        }
      }
      return best;
    };
    const anchorTargets: THREE.Object3D[] = [];
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
    let cameraYaw = 0;
    let cameraPitch = .08;
    let avatar: AvatarRig | null = null;
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

    const loadDistrict = (config: DistrictConfig, report = true) => {
      const existing = districtPromises.get(config.id);
      if (existing) return existing;
      let modelPromise = districtModelPromises.get(config.model);
      if (!modelPromise) modelPromise = (async () => {
        if (report) callbacksRef.current.onStatus(`Opening route to ${config.name}`, loadedDistricts.size ? 84 : 28);
        const gltf = await loadModel<{ scene: THREE.Group }>(config.model, config.name, loadedDistricts.size ? 84 : 28, loadedDistricts.size ? 98 : 78, report);
        if (disposed) throw new Error('Game disposed');
        const model = gltf.scene;
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
        addAuthoredMapFloor(root, size.x, size.z, config.name);
        let detailedColliderCount = 0;
        if (config.collisionData) {
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
            addSpatialCollider(spatialColliders, collider);
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
          anchorTargets.push(proxy);
        }
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const positionCount = object.geometry.getAttribute('position')?.count ?? 0;
          if (!config.collisionData && positionCount > 0 && positionCount < 180_000) anchorTargets.push(object);
          if (config.collisionData) return;
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
          detailedColliderCount += 1;
        });
        const rotatedWidth = Math.abs(Math.cos(root.rotation.y)) * size.x + Math.abs(Math.sin(root.rotation.y)) * size.z;
        const rotatedDepth = Math.abs(Math.sin(root.rotation.y)) * size.x + Math.abs(Math.cos(root.rotation.y)) * size.z;
        if (detailedColliderCount < 4) {
          addLandmarkColliders(scene, worldColliders, anchorTargets, config, rotatedWidth, rotatedDepth, size.y);
        }
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
        const meshHit = raycaster.intersectObjects(anchorTargets, true).find((item) => item.distance > 5 && item.distance < 170 && item.point.y > traversal.position.y + 3);
        let point = meshHit?.point;
        if (!point) {
          let nearestDistance = Infinity;
          for (const collider of localFacades) {
            const facadeBounds = new THREE.Box3(
              new THREE.Vector3(collider.min.x, collider.min.y, collider.min.z),
              new THREE.Vector3(collider.max.x, collider.max.y, collider.max.z),
            );
            const collisionPoint = raycaster.ray.intersectBox(facadeBounds, new THREE.Vector3());
            if (!collisionPoint || collisionPoint.y <= traversal.position.y + 3) continue;
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
        candidates.push({
          id: meshHit ? `${meshHit.object.uuid}:${meshHit.instanceId ?? 'mesh'}` : `facade:${point.x.toFixed(1)}:${point.z.toFixed(1)}`,
          point: { x: point.x, y: point.y, z: point.z },
          kind: point.y > traversal.position.y + 20 ? 'facade' : 'ledge',
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
      pointerHeld = true;
      pointerPressed = true;
      pointerReleased = false;
    };
    const onPointerMove = (event: PointerEvent) => { if (pointerHeld) readPointer(event); };
    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pointerHeld = false;
      pointerReleased = true;
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
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.delete(event.code);
      if (event.code === 'KeyE') zipReleased = true;
    };
    const clearKeys = () => {
      keys.clear();
      pointerHeld = false;
      pointerReleased = true;
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
        player.position.copy(safeSpawn(district));
        player.velocity.set(0, 0, 0);
        player.grounded = true;
        setTraversalKinematics(traversal, player.position, player.velocity);
        traversal.grounded = true;
        traversal.mode = 'idle';
        traversal.swing = null;
        traversal.zip = null;
        traversal.wall = null;
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
      const swingHeld = hero.traversal === 'spider' && (pointerHeld || keyboardSwingHeld);
      const targetNdc = pointerHeld || pointerPressed ? pointerNdc : new THREE.Vector2(0, .08);
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

      const activeColliders = nearbyColliders(player.position, Math.max(42, player.velocity.length() * .12));
      const ironPowered = hero.traversal === 'ironman' && (ironFlightMode === 'hover' || ironFlightMode === 'cruise');

      const result = stepTraversalInPlace(traversal, {
        move: wish,
        cameraForward: forward,
        aimDirection: cameraAim,
        jumpPressed: hero.traversal === 'spider' && jumpPressed,
        jumpHeld: keys.has('Space'),
        swingPressed: hero.traversal === 'spider' && (pointerPressed || keyboardSwingHeld),
        swingHeld,
        swingReleased: hero.traversal === 'spider' && pointerReleased,
        zipPressed: hero.traversal === 'spider' && zipPressed,
        zipHeld: hero.traversal === 'spider' && keys.has('KeyE'),
        zipReleased: hero.traversal === 'spider' && zipReleased,
        diveHeld: hero.traversal === 'spider' && keys.has('ShiftLeft'),
        wallCrawlHeld: hero.traversal === 'spider' && keys.has('KeyQ'),
        wallClimb: keys.has('KeyW') ? 1 : keys.has('KeyS') ? -1 : 0,
        pointerPressure,
        reel: swingHeld && keys.has('KeyW') ? -1 : keys.has('KeyS') ? 1 : 0,
      }, {
        groundY: GROUND_Y,
        colliders: activeColliders,
        anchorCandidates,
        zipTargets: anchorCandidates,
      }, delta, hero.traversal === 'ironman' ? {
        gravity: ironPowered ? .8 : 29,
        groundAcceleration: 40,
        airAcceleration: ironPowered ? 30 : 10,
        runSpeed: 11,
        maximumSpeed: 92,
      } : undefined);

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
      }
      jumpPressed = false;
      zipPressed = false;
      zipReleased = false;
      pointerPressed = false;
      pointerReleased = false;
      hoverTogglePressed = false;
      cruiseTogglePressed = false;

      const activeDistrict = getDistrict(currentDistrict);
      const worldRadius = activeDistrict.targetWidth * .62;
      const outsideWorld = Math.hypot(
        player.position.x - activeDistrict.position[0],
        player.position.z - activeDistrict.position[2],
      ) > worldRadius;
      if (player.position.y < -20 || outsideWorld) {
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

      webLine.visible = Boolean(traversal.swing);
      if (traversal.swing) {
        const hand = player.position.clone().add(new THREE.Vector3(0, 1.58, 0));
        webPositions.set([hand.x, hand.y, hand.z, traversal.swing.anchor.x, traversal.swing.anchor.y, traversal.swing.anchor.z]);
        (webGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      }
      const speed = result.context.speed;
      const distance = result.context.camera.followDistance;
      const horizontalDistance = Math.cos(cameraPitch) * distance;
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
      cameraAgainstWorld(target, desired, activeColliders);
      camera.position.lerp(desired, 1 - Math.exp(-8 * delta));
      camera.fov = damp(camera.fov, result.context.camera.fov, 7, delta);
      camera.updateProjectionMatrix();
      camera.up.set(Math.sin(result.context.camera.roll), Math.cos(result.context.camera.roll), 0).normalize();
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
        callbacksRef.current.onHud({ speed: Math.round(speed * 7.4), altitude: Math.max(0, Math.round(player.position.y - GROUND_Y)), fps: measuredFps, swinging: Boolean(traversal.swing) });
        renderer.domElement.dataset.playerPosition = [player.position.x, player.position.y, player.position.z].map((value) => value.toFixed(2)).join(',');
        renderer.domElement.dataset.grounded = String(player.grounded);
        renderer.domElement.dataset.traversalMode = traversal.mode;
        renderer.domElement.dataset.colliderCount = String(worldColliders.length + indexedColliderCount);
        renderer.domElement.dataset.anchorTargetCount = String(anchorTargets.length + indexedColliderCount);
        renderer.domElement.dataset.ropeLength = traversal.swing?.ropeLength.toFixed(2) ?? '';
        renderer.domElement.dataset.swingTension = traversal.swing?.tension.toFixed(2) ?? '';
        renderer.domElement.dataset.wallContact = traversal.wall ? `${traversal.wall.normal.x.toFixed(2)},${traversal.wall.normal.y.toFixed(2)},${traversal.wall.normal.z.toFixed(2)}` : '';
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
        ready = true;
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
