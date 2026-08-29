'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { DISTRICTS, getDistrict, getSuit, type DistrictConfig, type DistrictId, type SuitId } from '@/lib/game-config';
import { animateRigBones, collectRigBones, normalizeSuit, poseOnlyClips, prepareMaterials, retargetMixamoClips, type RigBone } from '@/lib/three-assets';

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

type AnimationState = 'idle' | 'run' | 'jump' | 'swing';
type AvatarRig = {
  root: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  actions: Map<string, THREE.AnimationAction>;
  activeAction: string;
  bones: RigBone[];
};
type SwingState = { anchor: THREE.Vector3; ropeLength: number; source: 'mouse' | 'space' };

const GROUND_Y = .12;
const PLAYER_HEIGHT = 1.86;
const PLAYER_RADIUS = .48;
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
    new THREE.SphereGeometry(2600, 32, 18),
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
      instance += 1;
    }
  }
  mesh.count = instance;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
  anchors.push(mesh);

  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(2300, 2300),
    new THREE.MeshStandardMaterial({ color: '#11151a', roughness: .96, metalness: .02 }),
  );
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.receiveShadow = true;
  asphalt.name = 'New York asphalt';
  scene.add(asphalt);

  const lineMaterial = new THREE.MeshBasicMaterial({ color: '#b79b52', transparent: true, opacity: .5 });
  const lines = new THREE.Group();
  for (let lane = -12; lane <= 12; lane += 1) {
    const coordinate = lane * spacing;
    const vertical = new THREE.Mesh(new THREE.PlaneGeometry(.22, 2300), lineMaterial);
    vertical.rotation.x = -Math.PI / 2;
    vertical.position.set(coordinate, .018, 0);
    lines.add(vertical);
    const horizontal = new THREE.Mesh(new THREE.PlaneGeometry(2300, .22), lineMaterial);
    horizontal.rotation.x = -Math.PI / 2;
    horizontal.position.set(0, .019, coordinate);
    lines.add(horizontal);
  }
  lines.name = 'Manhattan street markings';
  scene.add(lines);
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

function resolvePlayerCollisions(position: THREE.Vector3, previous: THREE.Vector3, velocity: THREE.Vector3, colliders: readonly THREE.Box3[]) {
  let landed = false;
  for (const box of colliders) {
    if (position.x < box.min.x - PLAYER_RADIUS || position.x > box.max.x + PLAYER_RADIUS || position.z < box.min.z - PLAYER_RADIUS || position.z > box.max.z + PLAYER_RADIUS) continue;
    if (position.y + PLAYER_HEIGHT <= box.min.y || position.y >= box.max.y + .28) continue;
    if (previous.y >= box.max.y - .08 && position.y <= box.max.y + .2 && velocity.y <= 0) {
      position.y = box.max.y;
      velocity.y = 0;
      landed = true;
      continue;
    }
    const left = position.x - (box.min.x - PLAYER_RADIUS);
    const right = box.max.x + PLAYER_RADIUS - position.x;
    const front = position.z - (box.min.z - PLAYER_RADIUS);
    const back = box.max.z + PLAYER_RADIUS - position.z;
    const smallest = Math.min(left, right, front, back);
    if (smallest === left) { position.x = box.min.x - PLAYER_RADIUS; velocity.x = Math.min(0, velocity.x); }
    else if (smallest === right) { position.x = box.max.x + PLAYER_RADIUS; velocity.x = Math.max(0, velocity.x); }
    else if (smallest === front) { position.z = box.min.z - PLAYER_RADIUS; velocity.z = Math.min(0, velocity.z); }
    else { position.z = box.max.z + PLAYER_RADIUS; velocity.z = Math.max(0, velocity.z); }
  }
  if (position.y <= GROUND_Y) {
    position.y = GROUND_Y;
    velocity.y = Math.max(0, velocity.y);
    landed = true;
  }
  return landed;
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
    scene.fog = new THREE.FogExp2('#07101b', .00072);
    addSky(scene);
    const camera = new THREE.PerspectiveCamera(66, 1, .08, 4200);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = 'game-canvas';
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute('aria-label', 'Playable 3D New York City');
    if (process.env.NODE_ENV !== 'production') {
      const testPosition = new THREE.Vector3(5, GROUND_Y, 5);
      const testVelocity = new THREE.Vector3(1, 0, 0);
      resolvePlayerCollisions(testPosition, new THREE.Vector3(-1, GROUND_Y, 5), testVelocity, [new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 10, 10))]);
      renderer.domElement.dataset.collisionSelfTest = String(testPosition.x <= -PLAYER_RADIUS && testVelocity.x === 0);
    }
    mount.appendChild(renderer.domElement);
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
    const player = { position: new THREE.Vector3(0, GROUND_Y, 40), velocity: new THREE.Vector3(), facing: 0, grounded: true };
    let cameraYaw = 0;
    let cameraPitch = .08;
    let swing: SwingState | null = null;
    let avatar: AvatarRig | null = null;
    let currentDistrict: DistrictId = 'times-square';
    let hudAccumulator = 0;
    let fpsAccumulator = 0;
    let fpsFrames = 0;
    let measuredFps = 60;
    let performanceScaled = false;
    let lastFrameTime = performance.now();
    let elapsedTime = 0;
    let jumpStartedAt = -10;
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
        prepareMaterials(model, renderer, 'baked');
        model.updateWorldMatrix(true, true);
        let box = new THREE.Box3().setFromObject(model);
        const sourceSize = box.getSize(new THREE.Vector3());
        const horizontal = Math.max(sourceSize.x, sourceSize.z, .001);
        model.scale.setScalar(config.targetWidth / horizontal);
        model.updateWorldMatrix(true, true);
        box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        model.position.set(-center.x, -box.min.y, -center.z);
        const root = new THREE.Group();
        root.name = `District: ${config.name}`;
        root.position.set(...config.position);
        root.rotation.y = config.rotation ?? 0;
        root.add(model);
        scene.add(root);
        const rotatedWidth = Math.abs(Math.cos(root.rotation.y)) * size.x + Math.abs(Math.sin(root.rotation.y)) * size.z;
        const rotatedDepth = Math.abs(Math.sin(root.rotation.y)) * size.x + Math.abs(Math.cos(root.rotation.y)) * size.z;
        addLandmarkColliders(scene, worldColliders, anchorTargets, config, rotatedWidth, rotatedDepth, size.y);
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

      let clips = poseOnlyClips(gltf.animations);
      if (suit.id !== 'advanced') {
        const source = await loadModel<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>('/assets/suits/advanced.glb', 'motion library', 42, 52);
        clips = [...clips, ...retargetMixamoClips(source.animations, gltf.scene)];
      }
      const mixer = clips.length ? new THREE.AnimationMixer(gltf.scene) : null;
      const actions = new Map<string, THREE.AnimationAction>();
      if (mixer) {
        for (const clip of clips) {
          const key = clip.name.toLowerCase();
          if (!actions.has(key)) actions.set(key, mixer.clipAction(clip));
        }
      }
      avatar = { root, model: gltf.scene, mixer, actions, activeAction: '', bones: collectRigBones(gltf.scene) };
      renderer.domElement.dataset.suit = suit.id;
      renderer.domElement.dataset.animationClips = [...actions.keys()].join('|');
      renderer.domElement.dataset.rigRoles = [...new Set(avatar.bones.map((entry) => entry.role))].join('|');
      console.info('[avatar] ready', { suit: suit.id, clips: [...actions.keys()], bones: avatar.bones.map((entry) => entry.role) });
    };

    const resolveAction = (state: AnimationState) => {
      if (!avatar?.mixer) return '';
      const candidates = state === 'idle'
        ? ['stand', 'idle', 'animation']
        : state === 'run'
          ? ['run', 'bully walking', 'crouched walking', 'walk']
          : state === 'jump'
            ? ['jumpup', 'jump', 'brace drop', 'flying knee']
            : ['hanging', 'swingstart', 'swing to land', 'swing'];
      for (const candidate of candidates) {
        const key = [...avatar.actions.keys()].find((name) => name.includes(candidate));
        if (key) return key;
      }
      return '';
    };

    const setAnimation = (state: AnimationState) => {
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

    const startSwing = (ndc: THREE.Vector2, source: SwingState['source']) => {
      if (!ready) return;
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(anchorTargets, false).find((item) => item.distance > 7 && item.point.y > player.position.y + 4);
      const direction = raycaster.ray.direction.clone();
      const fallbackDistance = clamp(62 + player.velocity.length() * 1.9, 62, 165);
      const anchor = hit?.point.clone() ?? player.position.clone().addScaledVector(direction, fallbackDistance);
      anchor.y = Math.max(player.position.y + 20, anchor.y + 18);
      const distance = anchor.distanceTo(player.position);
      swing = { anchor, ropeLength: Math.max(12, distance * .9), source };
      renderer.domElement.dataset.lastSwingAnchor = [anchor.x, anchor.y, anchor.z].map((value) => value.toFixed(2)).join(',');
      renderer.domElement.dataset.lastSwingSource = source;
      player.grounded = false;
      player.velocity.y = Math.max(player.velocity.y, 1.4);
      webLine.visible = true;
    };

    const stopSwing = (source?: SwingState['source']) => {
      if (!swing || (source && swing.source !== source)) return;
      swing = null;
      webLine.visible = false;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      renderer.domElement.focus({ preventScroll: true });
      const bounds = renderer.domElement.getBoundingClientRect();
      startSwing(new THREE.Vector2(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1), 'mouse');
    };
    const onPointerUp = (event: PointerEvent) => { if (event.button === 0) stopSwing('mouse'); };
    const onKeyDown = (event: KeyboardEvent) => {
      keys.add(event.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
      if (event.code === 'Space' && !event.repeat) {
        if (player.grounded) {
          player.velocity.y = 10.8;
          player.grounded = false;
          jumpStartedAt = elapsedTime;
        } else if (!swing) startSwing(new THREE.Vector2(0, 0), 'space');
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.delete(event.code);
      if (event.code === 'Space') stopSwing('space');
    };
    const clearKeys = () => { keys.clear(); stopSwing(); };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearKeys);

    travelRef.current = (id: DistrictId) => {
      const district = getDistrict(id);
      void loadDistrict(district).then(() => {
        if (disposed) return;
        stopSwing();
        currentDistrict = id;
        player.position.set(district.position[0], GROUND_Y, district.position[2] + district.targetWidth * .9);
        player.velocity.set(0, 0, 0);
        player.grounded = true;
        callbacksRef.current.onDistrictChange(id);
        callbacksRef.current.onStatus(`${district.name} ready`, 100);
      }).catch(() => undefined);
    };

    const updateAvatar = (delta: number, elapsed: number, movementAmount: number) => {
      if (!avatar) return;
      avatar.mixer?.update(delta);
      avatar.root.position.copy(player.position);
      avatar.root.rotation.y = damp(avatar.root.rotation.y, player.facing, 13, delta);
      avatar.root.rotation.z = damp(avatar.root.rotation.z, swing ? clamp(-player.velocity.x * .016, -.38, .38) : 0, 7, delta);
      avatar.root.rotation.x = damp(avatar.root.rotation.x, swing ? clamp(player.velocity.y * -.008, -.2, .22) : 0, 7, delta);
      const state: AnimationState = swing ? 'swing' : !player.grounded ? 'jump' : movementAmount > .15 ? 'run' : 'idle';
      renderer.domElement.dataset.animationState = state;
      if (!setAnimation(state)) animateRigBones(avatar.bones, state, elapsed, delta);
    };

    const tick = (timestamp = performance.now()) => {
      if (disposed) return;
      frameId = requestAnimationFrame(tick);
      const delta = Math.min(Math.max((timestamp - lastFrameTime) / 1000, 0), .034);
      lastFrameTime = timestamp;
      elapsedTime += delta;
      if (!ready) { renderer.render(scene, camera); return; }
      const previous = player.position.clone();
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
      const movementAmount = wish.length();

      if (player.grounded) {
        player.velocity.addScaledVector(wish, 46 * delta);
        const horizontal = new THREE.Vector2(player.velocity.x, player.velocity.z);
        if (horizontal.length() > 14.5) horizontal.setLength(14.5);
        player.velocity.x = horizontal.x;
        player.velocity.z = horizontal.y;
        const friction = wish.lengthSq() ? Math.exp(-3.4 * delta) : Math.exp(-11 * delta);
        player.velocity.x *= friction;
        player.velocity.z *= friction;
      } else if (wish.lengthSq()) {
        player.velocity.addScaledVector(wish, 12 * delta);
      }
      player.velocity.y -= 23 * delta;
      if (keys.has('Space') && !player.grounded && !swing && elapsedTime - jumpStartedAt > .14) startSwing(new THREE.Vector2(0, 0), 'space');
      if (swing) {
        if (keys.has('Space')) swing.ropeLength = Math.max(11, swing.ropeLength - 9 * delta);
        const radial = player.position.clone().sub(swing.anchor);
        const distance = Math.max(.001, radial.length());
        radial.divideScalar(distance);
        const stretch = distance - swing.ropeLength;
        if (stretch > 0) {
          player.velocity.addScaledVector(radial, -stretch * 48 * delta);
          const outward = player.velocity.dot(radial);
          if (outward > 0) player.velocity.addScaledVector(radial, -outward * .99);
        }
        if (keys.has('KeyW')) player.velocity.addScaledVector(forward, 8.5 * delta);
      }
      player.position.addScaledVector(player.velocity, delta);
      if (player.velocity.length() > 54) player.velocity.setLength(54);
      player.grounded = resolvePlayerCollisions(player.position, previous, player.velocity, worldColliders);
      if (player.grounded && swing) stopSwing();
      if (player.position.y < -20 || Math.abs(player.position.x) > 1250 || Math.abs(player.position.z) > 1250) {
        const home = getDistrict(currentDistrict);
        player.position.set(home.position[0], GROUND_Y, home.position[2] + home.targetWidth * .9);
        player.velocity.set(0, 0, 0);
        player.grounded = true;
        stopSwing();
      }
      if (wish.lengthSq() > 0) player.facing = Math.atan2(-wish.x, -wish.z);
      updateAvatar(delta, elapsedTime, movementAmount);

      if (swing) {
        const hand = player.position.clone().add(new THREE.Vector3(0, 1.58, 0));
        webPositions.set([hand.x, hand.y, hand.z, swing.anchor.x, swing.anchor.y, swing.anchor.z]);
        (webGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      }
      const speed = player.velocity.length();
      const distance = clamp(6.6 + speed * .055, 6.6, 11.8);
      const horizontalDistance = Math.cos(cameraPitch) * distance;
      const target = player.position.clone().add(new THREE.Vector3(0, 1.35, 0));
      const desired = player.position.clone().add(new THREE.Vector3(
        Math.sin(cameraYaw) * horizontalDistance,
        2.7 + Math.sin(cameraPitch) * distance,
        Math.cos(cameraYaw) * horizontalDistance,
      ));
      cameraAgainstWorld(target, desired, worldColliders);
      camera.position.lerp(desired, 1 - Math.exp(-8 * delta));
      camera.lookAt(target);
      sun.position.set(player.position.x - 180, player.position.y + 360, player.position.z + 170);

      for (const district of DISTRICTS) {
        if (loadedDistricts.has(district.id) || districtPromises.has(district.id)) continue;
        if (Math.hypot(player.position.x - district.position[0], player.position.z - district.position[2]) < 410) void loadDistrict(district, false).catch(() => undefined);
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
        callbacksRef.current.onHud({ speed: Math.round(speed * 7.4), altitude: Math.max(0, Math.round(player.position.y - GROUND_Y)), fps: measuredFps, swinging: Boolean(swing) });
        renderer.domElement.dataset.playerPosition = [player.position.x, player.position.y, player.position.z].map((value) => value.toFixed(2)).join(',');
        renderer.domElement.dataset.grounded = String(player.grounded);
        hudAccumulator = 0;
      }
      renderer.render(scene, camera);
    };

    const setup = async () => {
      try {
        callbacksRef.current.onStatus('Booting connected New York grid', 2);
        camera.position.set(0, 3.8, 50);
        camera.lookAt(0, 1.4, 40);
        tick();
        await Promise.all([loadAvatar(), loadDistrict(getDistrict('times-square'))]);
        if (disposed) return;
        player.position.set(0, GROUND_Y, 40);
        player.velocity.set(0, 0, 0);
        player.grounded = true;
        ready = true;
        callbacksRef.current.onDistrictChange('times-square');
        callbacksRef.current.onStatus('Times Square route online', 100);
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
