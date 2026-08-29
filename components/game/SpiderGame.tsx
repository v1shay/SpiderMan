'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { DISTRICTS, getDistrict, getSuit, type DistrictConfig, type DistrictId, type SuitId } from '@/lib/game-config';
import {
  createTraversalState,
  runTraversalPhysicsSelfTests,
  setTraversalKinematics,
  stepTraversalInPlace,
  type TraversalContext,
  type WebAnchorCandidate,
} from '@/lib/traversal-physics';
import { animateRigBones, collectRigBones, normalizeSuit, poseOnlyClips, prepareMaterials, type ProceduralPose, type RigBone } from '@/lib/three-assets';

export type GameHud = { speed: number; altitude: number; fps: number; swinging: boolean };
export type SpiderGameHandle = { travelTo: (id: DistrictId) => void };

type Props = {
  suitId: SuitId;
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

const GROUND_Y = .12;
const districtSpawn = (district: DistrictConfig) => {
  const local = new THREE.Vector3(district.spawn?.[0] ?? 0, 0, district.spawn?.[1] ?? 0)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), district.rotation ?? 0);
  return new THREE.Vector3(district.position[0] + local.x, GROUND_Y, district.position[2] + local.z);
};
const cameraCollisionBox = new THREE.Box3();
const cameraCollisionHit = new THREE.Vector3();
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const damp = (from: number, to: number, lambda: number, delta: number) => THREE.MathUtils.lerp(from, to, 1 - Math.exp(-lambda * delta));

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

function createWindowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#101b27';
    context.fillRect(0, 0, 128, 256);
    for (let row = 0; row < 14; row += 1) {
      for (let column = 0; column < 7; column += 1) {
        const lit = seeded(row * 17 + column * 31) > .43;
        context.fillStyle = lit ? (seeded(row * 41 + column) > .7 ? '#ffbd69' : '#74b7ce') : '#162938';
        context.fillRect(6 + column * 18, 7 + row * 18, 10, 9);
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

function createAsphaltTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#151a20';
    context.fillRect(0, 0, 512, 512);
    for (let index = 0; index < 9000; index += 1) {
      const shade = 20 + Math.floor(seeded(index + 900) * 28);
      context.fillStyle = `rgba(${shade},${shade + 2},${shade + 4},${.08 + seeded(index + 77) * .18})`;
      const size = 1 + Math.floor(seeded(index + 101) * 3);
      context.fillRect(seeded(index + 33) * 512, seeded(index + 61) * 512, size, size);
    }
    context.strokeStyle = 'rgba(4,7,10,.5)';
    context.lineWidth = 2;
    for (let crack = 0; crack < 14; crack += 1) {
      context.beginPath();
      context.moveTo(seeded(crack + 400) * 512, seeded(crack + 500) * 512);
      for (let segment = 0; segment < 5; segment += 1) {
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

function addCityGrid(scene: THREE.Scene) {
  const colliders: THREE.Box3[] = [];
  const anchors: THREE.Object3D[] = [];
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const windowTexture = createWindowTexture();
  const material = new THREE.MeshStandardMaterial({
    map: windowTexture,
    emissiveMap: windowTexture,
    color: '#9db0bc',
    vertexColors: true,
    roughness: .78,
    metalness: .08,
    emissive: '#8ac4d7',
    emissiveIntensity: .5,
  });
  const gridRadius = 12;
  const spacing = 86;
  const mesh = new THREE.InstancedMesh(geometry, material, (gridRadius * 2 + 1) ** 2);
  mesh.name = 'Manhattan building grid';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  let instance = 0;
  const sidewalk = new THREE.InstancedMesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: '#59616a', roughness: .92, metalness: .04 }),
    (gridRadius * 2 + 1) ** 2,
  );
  sidewalk.name = 'Raised Manhattan sidewalks';
  sidewalk.receiveShadow = true;

  for (let gx = -gridRadius; gx <= gridRadius; gx += 1) {
    for (let gz = -gridRadius; gz <= gridRadius; gz += 1) {
      const x = (gx + .5) * spacing;
      const z = (gz + .5) * spacing;
      const reserved = DISTRICTS.some((district) => Math.hypot(x - district.position[0], z - district.position[2]) < district.targetWidth * .58);
      if (reserved || (Math.abs(x) < 64 && z > -30 && z < 150)) continue;
      const index = (gx + gridRadius + 1) * 67 + gz + gridRadius;
      const width = 46 + seeded(index) * 12;
      const depth = 46 + seeded(index + 3) * 12;
      const height = 42 + seeded(index + 8) * 190;
      matrix.compose(new THREE.Vector3(x, height / 2, z), new THREE.Quaternion(), new THREE.Vector3(width, height, depth));
      mesh.setMatrixAt(instance, matrix);
      color.setHSL(.55 + seeded(index + 23) * .08, .2, .32 + seeded(index + 29) * .17);
      mesh.setColorAt(instance, color);
      colliders.push(new THREE.Box3(
        new THREE.Vector3(x - width / 2, 0, z - depth / 2),
        new THREE.Vector3(x + width / 2, height, z + depth / 2),
      ));
      matrix.compose(new THREE.Vector3(x, .14, z), new THREE.Quaternion(), new THREE.Vector3(width + 4.2, .28, depth + 4.2));
      sidewalk.setMatrixAt(instance, matrix);
      instance += 1;
    }
  }
  mesh.count = instance;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  if (instance > 0) scene.add(mesh);
  sidewalk.count = instance;
  sidewalk.instanceMatrix.needsUpdate = true;
  if (instance > 0) {
    scene.add(sidewalk);
    anchors.push(mesh);
  }

  const worldSize = Math.max(7200, ...DISTRICTS.map((district) => district.targetWidth * 1.2));

  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(worldSize, worldSize),
    new THREE.MeshStandardMaterial({ map: createAsphaltTexture(), color: '#c6ccd1', roughness: .98, metalness: .01 }),
  );
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.receiveShadow = true;
  asphalt.name = 'New York asphalt';
  scene.add(asphalt);

  // The imported city includes its own roads. Only draw the synthetic grid
  // markings when synthetic buildings were actually needed around a district.
  if (instance > 0) {
    const lineMaterial = new THREE.MeshBasicMaterial({ color: '#b79b52', transparent: true, opacity: .5 });
    const lines = new THREE.Group();
    for (let lane = -12; lane <= 12; lane += 1) {
      const coordinate = lane * spacing;
      const vertical = new THREE.Mesh(new THREE.PlaneGeometry(.22, worldSize), lineMaterial);
      vertical.rotation.x = -Math.PI / 2;
      vertical.position.set(coordinate, .018, 0);
      lines.add(vertical);
      const horizontal = new THREE.Mesh(new THREE.PlaneGeometry(worldSize, .22), lineMaterial);
      horizontal.rotation.x = -Math.PI / 2;
      horizontal.position.set(0, .019, coordinate);
      lines.add(horizontal);
    }
    lines.name = 'Manhattan street markings';
    scene.add(lines);
  }
  return { colliders, anchors };
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
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = 'game-canvas';
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute('aria-label', 'Playable 3D New York City');
    if (process.env.NODE_ENV !== 'production') {
      renderer.domElement.dataset.collisionSelfTest = String(runTraversalPhysicsSelfTests().passed);
    }
    mount.appendChild(renderer.domElement);
    scene.add(new THREE.AmbientLight('#9bc9e8', .42));
    scene.add(new THREE.HemisphereLight('#a3d4ff', '#2b1516', 1.35));
    const sun = new THREE.DirectionalLight('#ffd4bc', 1.85);
    sun.position.set(-180, 360, 170);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -150;
    sun.shadow.camera.right = 150;
    sun.shadow.camera.top = 150;
    sun.shadow.camera.bottom = -150;
    scene.add(sun);

    const city = addCityGrid(scene);
    const worldColliders = city.colliders;
    const anchorTargets = city.anchors;
    const loadedDistricts = new Set<DistrictId>();
    const districtPromises = new Map<DistrictId, Promise<THREE.Group>>();
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const keys = new Set<string>();
    const initialDistrict = getDistrict('backstreet');
    const initialSpawn = districtSpawn(initialDistrict);
    const player = { position: initialSpawn.clone(), velocity: new THREE.Vector3(), facing: 0, grounded: true };
    const traversal = createTraversalState(player.position, player.velocity);
    traversal.grounded = true;
    traversal.mode = 'idle';
    let cameraYaw = 0;
    let cameraPitch = .08;
    let avatar: AvatarRig | null = null;
    let currentDistrict: DistrictId = 'backstreet';
    let hudAccumulator = 0;
    let fpsAccumulator = 0;
    let fpsFrames = 0;
    let measuredFps = 60;
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
      const promise = (async () => {
        if (report) callbacksRef.current.onStatus(`Opening route to ${config.name}`, loadedDistricts.size ? 84 : 28);
        const gltf = await loadModel<{ scene: THREE.Group }>(config.model, config.name, loadedDistricts.size ? 84 : 28, loadedDistricts.size ? 98 : 78, report);
        if (disposed) throw new Error('Game disposed');
        const model = gltf.scene;
        prepareMaterials(model, renderer, 'environment');
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
        let detailedColliderCount = 0;
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const positionCount = object.geometry.getAttribute('position')?.count ?? 0;
          if (positionCount > 0 && positionCount < 180_000) anchorTargets.push(object);
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
        loadedDistricts.add(config.id);
        notifyLoaded();
        if (report && config.id === currentDistrict) callbacksRef.current.onStatus(`${config.name} online`, 100);
        return root;
      })().catch((error) => {
        districtPromises.delete(config.id);
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

      // Use only clips authored for this skeleton. Cross-file retargeting warped
      // Miles/PS4 hands and rest poses; the shared procedural rig drives models
      // without compatible embedded clips.
      const clips = poseOnlyClips(gltf.animations);
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
      for (let index = 0; index < samples.length; index += 1) {
        raycaster.setFromCamera(samples[index], camera);
        const hit = raycaster.intersectObjects(anchorTargets, true).find((item) => item.distance > 5 && item.distance < 170 && item.point.y > traversal.position.y + 3);
        if (!hit) continue;
        candidates.push({
          id: `${hit.object.uuid}:${hit.instanceId ?? 'mesh'}`,
          point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
          kind: hit.point.y > traversal.position.y + 20 ? 'facade' : 'ledge',
          lineOfSight: true,
          weight: index === 0 ? 1.2 : .86,
        });
      }
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
      if (['Space', 'KeyE', 'ShiftLeft', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
      if (event.code === 'Space' && firstPress) { jumpPressed = true; spacePressedAt = elapsedTime; }
      if (event.code === 'KeyE' && firstPress) { zipPressed = true; zipReleased = false; }
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
        player.position.copy(districtSpawn(district));
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
      avatar.root.rotation.x = damp(avatar.root.rotation.x, context.animation.bodyPitch, 8, delta);
      const mode = context.animation.state;
      const pose: ProceduralPose = getSuit(props.suitId).traversal === 'ironman'
        ? context.speed > 3 ? 'fly' : 'hover'
        : mode === 'swing' ? 'swing'
          : mode === 'webZip' || mode === 'pointLaunch' ? 'zip'
            : mode === 'wallRun' ? 'wall'
              : mode === 'wallCrawl' ? 'crawl'
                : mode === 'dive' ? 'dive'
                  : mode === 'run' ? 'run'
                    : mode === 'idle' || mode === 'land' || mode === 'perch' ? 'idle' : 'jump';
      renderer.domElement.dataset.animationState = mode;
      if (!setAnimation(pose)) animateRigBones(avatar.bones, pose, elapsed, delta);
      const repulsorActive = getSuit(props.suitId).traversal === 'ironman' && (!player.grounded || context.speed > 3);
      for (const glow of avatar.repulsors) {
        glow.visible = repulsorActive;
        glow.material.opacity = repulsorActive ? .62 + Math.sin(elapsed * 28) * .22 : 0;
        glow.scale.setScalar(1 + context.speed * .012);
      }
      const light = avatar.root.getObjectByName('Iron Man repulsor light') as THREE.PointLight | undefined;
      if (light) light.intensity = repulsorActive ? 5 + context.speed * .08 : 0;
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
        if (jumpPressed) {
          traversal.grounded = false;
          traversal.velocity.y = Math.max(traversal.velocity.y, 12);
        }
        if (keys.has('Space')) {
          traversal.grounded = false;
          traversal.velocity.y = damp(traversal.velocity.y, 22, 6, delta);
        } else if (keys.has('ShiftLeft')) {
          traversal.velocity.y = damp(traversal.velocity.y, -18, 6, delta);
        } else if (!traversal.grounded) {
          traversal.velocity.y = damp(traversal.velocity.y, 0, 4, delta);
        }
        if (pointerPressed || zipPressed) {
          traversal.grounded = false;
          traversal.velocity.x += cameraAim.x * 13;
          traversal.velocity.y += cameraAim.y * 9;
          traversal.velocity.z += cameraAim.z * 13;
        }
        if (pointerHeld || keys.has('KeyE')) {
          traversal.grounded = false;
          traversal.velocity.x += cameraAim.x * 46 * delta;
          traversal.velocity.y += cameraAim.y * 32 * delta;
          traversal.velocity.z += cameraAim.z * 46 * delta;
        }
      }

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
        colliders: worldColliders,
        anchorCandidates,
        zipTargets: anchorCandidates,
      }, delta, hero.traversal === 'ironman' ? {
        gravity: 1.8,
        groundAcceleration: 40,
        airAcceleration: 34,
        runSpeed: 18,
        maximumSpeed: 92,
      } : undefined);

      player.position.set(traversal.position.x, traversal.position.y, traversal.position.z);
      player.velocity.set(traversal.velocity.x, traversal.velocity.y, traversal.velocity.z);
      player.grounded = traversal.grounded;
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

      const activeDistrict = getDistrict(currentDistrict);
      const worldRadius = activeDistrict.targetWidth * .62;
      const outsideWorld = Math.hypot(
        player.position.x - activeDistrict.position[0],
        player.position.z - activeDistrict.position[2],
      ) > worldRadius;
      if (player.position.y < -20 || outsideWorld) {
        const home = getDistrict(currentDistrict);
        player.position.copy(districtSpawn(home));
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
      cameraAgainstWorld(target, desired, worldColliders);
      camera.position.lerp(desired, 1 - Math.exp(-8 * delta));
      camera.fov = damp(camera.fov, result.context.camera.fov, 7, delta);
      camera.updateProjectionMatrix();
      camera.up.set(Math.sin(result.context.camera.roll), Math.cos(result.context.camera.roll), 0).normalize();
      camera.lookAt(target);
      sun.position.set(player.position.x - 180, player.position.y + 360, player.position.z + 170);

      for (const district of DISTRICTS) {
        if (loadedDistricts.has(district.id) || districtPromises.has(district.id)) continue;
        if (Math.hypot(player.position.x - district.position[0], player.position.z - district.position[2]) < 280) void loadDistrict(district, false).catch(() => undefined);
      }
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
          renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
          renderer.domElement.dataset.performanceMode = 'latency';
          resize();
        }
      }
      if (hudAccumulator > .15) {
        callbacksRef.current.onHud({ speed: Math.round(speed * 7.4), altitude: Math.max(0, Math.round(player.position.y - GROUND_Y)), fps: measuredFps, swinging: Boolean(traversal.swing) });
        renderer.domElement.dataset.playerPosition = [player.position.x, player.position.y, player.position.z].map((value) => value.toFixed(2)).join(',');
        renderer.domElement.dataset.grounded = String(player.grounded);
        renderer.domElement.dataset.traversalMode = traversal.mode;
        renderer.domElement.dataset.colliderCount = String(worldColliders.length);
        renderer.domElement.dataset.anchorTargetCount = String(anchorTargets.length);
        renderer.domElement.dataset.ropeLength = traversal.swing?.ropeLength.toFixed(2) ?? '';
        renderer.domElement.dataset.swingTension = traversal.swing?.tension.toFixed(2) ?? '';
        renderer.domElement.dataset.wallContact = traversal.wall ? `${traversal.wall.normal.x.toFixed(2)},${traversal.wall.normal.y.toFixed(2)},${traversal.wall.normal.z.toFixed(2)}` : '';
        hudAccumulator = 0;
      }
      renderer.render(scene, camera);
    };

    const setup = async () => {
      try {
        callbacksRef.current.onStatus('Booting connected New York grid', 2);
        camera.position.copy(initialSpawn).add(new THREE.Vector3(0, 3.68, 10));
        camera.lookAt(initialSpawn.x, 1.4, initialSpawn.z);
        tick();
        await Promise.all([loadAvatar(), loadDistrict(initialDistrict)]);
        if (disposed) return;
        player.position.copy(initialSpawn);
        player.velocity.set(0, 0, 0);
        player.grounded = true;
        setTraversalKinematics(traversal, player.position, player.velocity);
        traversal.grounded = true;
        traversal.mode = 'idle';
        ready = true;
        callbacksRef.current.onDistrictChange('backstreet');
        callbacksRef.current.onStatus('Full-scale New York route online', 100);
        callbacksRef.current.onReady();
      } catch (error) {
        console.error('[game] unable to start New York', error);
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
  }, [props.suitId]);

  return <div ref={mountRef} className="game-mount" />;
});

export default SpiderGame;
