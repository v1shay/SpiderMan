'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { DISTRICTS, getDistrict, getSuit, type DistrictConfig, type DistrictId, type SuitId } from '@/lib/game-config';

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
  bones: { bone: THREE.Bone; baseX: number; baseY: number; baseZ: number; role: string }[];
};

type SwingState = { anchor: THREE.Vector3; ropeLength: number; source: 'mouse' | 'space' };

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
      uniforms: { topColor: { value: new THREE.Color('#071c36') }, bottomColor: { value: new THREE.Color('#bf3750') } },
      vertexShader: 'varying vec3 vWorld; void main(){ vec4 world = modelMatrix * vec4(position, 1.0); vWorld = world.xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 topColor; uniform vec3 bottomColor; varying vec3 vWorld; void main(){ float h = normalize(vWorld + vec3(0.0, 260.0, 0.0)).y; float mixValue = smoothstep(-0.18, 0.48, h); gl_FragColor = vec4(mix(bottomColor, topColor, mixValue), 1.0); }',
    }),
  );
  sky.name = 'NYC Twilight Sky';
  scene.add(sky);
}

function addProceduralCity(scene: THREE.Scene) {
  const colliders: THREE.Box3[] = [];
  const anchorTargets: THREE.Object3D[] = [];
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: '#23354b', roughness: .72, metalness: .18, emissive: '#071929', emissiveIntensity: .8 });
  const gridSize = 37;
  const spacing = 92;
  const mesh = new THREE.InstancedMesh(geometry, material, gridSize * gridSize - 9);
  mesh.name = 'Streamed skyline collision grid';
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  let instance = 0;

  for (let gx = -18; gx <= 18; gx += 1) {
    for (let gz = -18; gz <= 18; gz += 1) {
      if (Math.abs(gx) <= 1 && Math.abs(gz) <= 1) continue;
      const index = (gx + 19) * 41 + (gz + 19);
      const width = 52 + seeded(index) * 20;
      const depth = 52 + seeded(index + 3) * 20;
      const height = 48 + seeded(index + 8) * 210;
      const x = gx * spacing + (seeded(index + 12) - .5) * 12;
      const z = gz * spacing + (seeded(index + 18) - .5) * 12;
      matrix.compose(new THREE.Vector3(x, height / 2, z), new THREE.Quaternion(), new THREE.Vector3(width, height, depth));
      mesh.setMatrixAt(instance, matrix);
      color.setHSL(.56 + seeded(index + 23) * .07, .32, .16 + seeded(index + 29) * .12);
      mesh.setColorAt(instance, color);
      colliders.push(new THREE.Box3(new THREE.Vector3(x - width / 2, 0, z - depth / 2), new THREE.Vector3(x + width / 2, height, z + depth / 2)));
      instance += 1;
    }
  }
  mesh.count = instance;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
  anchorTargets.push(mesh);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3600, 3600), new THREE.MeshStandardMaterial({ color: '#080d14', roughness: .94, metalness: .05 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'New York street plane';
  scene.add(ground);

  const grid = new THREE.GridHelper(1800, 42, '#204d68', '#122536');
  grid.position.y = .025;
  const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
  gridMaterials.forEach((gridMaterial) => { gridMaterial.transparent = true; gridMaterial.opacity = .34; });
  scene.add(grid);
  return { colliders, anchorTargets };
}

function prepMaterials(root: THREE.Object3D, renderer: THREE.WebGLRenderer, castShadow = false) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = castShadow;
    object.receiveShadow = true;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const standard = material as THREE.MeshStandardMaterial;
      if (standard.map) {
        standard.map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        standard.map.colorSpace = THREE.SRGBColorSpace;
      }
      if ('envMapIntensity' in standard) standard.envMapIntensity = .55;
    }
  });
}

function boneRole(name: string) {
  const normalized = name.toLowerCase().replaceAll('_', '');
  if (/left(up)?leg|leftthigh/.test(normalized)) return 'leftLeg';
  if (/right(up)?leg|rightthigh/.test(normalized)) return 'rightLeg';
  if (/leftarm|leftshoulder/.test(normalized)) return 'leftArm';
  if (/rightarm|rightshoulder/.test(normalized)) return 'rightArm';
  if (/spine1|spine01|chest/.test(normalized)) return 'spine';
  return '';
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
    scene.fog = new THREE.FogExp2('#07101b', .00055);
    addSky(scene);

    const camera = new THREE.PerspectiveCamera(68, 1, .08, 4200);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = 'game-canvas';
    renderer.domElement.setAttribute('aria-label', 'Playable 3D New York City');
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight('#8ac6ff', '#26101b', 2.1));
    const sun = new THREE.DirectionalLight('#ffd5c2', 3.25);
    sun.position.set(-260, 420, 180);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -180;
    sun.shadow.camera.right = 180;
    sun.shadow.camera.top = 180;
    sun.shadow.camera.bottom = -180;
    scene.add(sun);

    const procedural = addProceduralCity(scene);
    const anchorTargets = [...procedural.anchorTargets];
    const loadedDistricts = new Set<DistrictId>();
    const districtPromises = new Map<DistrictId, Promise<THREE.Group>>();
    const districtRoots = new Map<DistrictId, THREE.Group>();
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const keys = new Set<string>();
    const collisionProbe = new THREE.Vector3();
    const player = { position: new THREE.Vector3(0, 2, 72), velocity: new THREE.Vector3(), facing: 0, grounded: false };
    let cameraYaw = 0;
    let cameraPitch = -.05;
    let swing: SwingState | null = null;
    let avatar: AvatarRig | null = null;
    let currentDistrict: DistrictId = 'times-square';
    let hudAccumulator = 0;
    let fpsAccumulator = 0;
    let fpsFrames = 0;
    let measuredFps = 60;
    const raycaster = new THREE.Raycaster();
    raycaster.far = 320;
    let lastFrameTime = performance.now();
    let elapsedTime = 0;
    const webPositions = new Float32Array(6);
    const webGeometry = new THREE.BufferGeometry();
    webGeometry.setAttribute('position', new THREE.BufferAttribute(webPositions, 3));
    const webLine = new THREE.Line(webGeometry, new THREE.LineBasicMaterial({ color: '#dff8ff', transparent: true, opacity: .92 }));
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

    const loadModel = <T,>(url: string, label: string, start: number, end: number, reportProgress = true) => new Promise<T>((resolve, reject) => {
      loader.load(url, (gltf) => resolve(gltf as T), (event) => {
        const local = event.total > 0 ? event.loaded / event.total : Math.min(.92, event.loaded / 20_000_000);
        if (reportProgress) callbacksRef.current.onStatus(`Streaming ${label}`, start + (end - start) * clamp(local, 0, 1));
      }, reject);
    });

    const loadDistrict = (config: DistrictConfig, reportProgress = true) => {
      const existing = districtPromises.get(config.id);
      if (existing) return existing;
      const promise = (async () => {
        if (reportProgress) callbacksRef.current.onStatus(`Opening route to ${config.name}`, loadedDistricts.size ? 84 : 30);
        const gltf = await loadModel<{ scene: THREE.Group }>(config.model, config.name, loadedDistricts.size ? 84 : 30, loadedDistricts.size ? 98 : 78, reportProgress);
        if (disposed) throw new Error('Game disposed');
        const model = gltf.scene;
        prepMaterials(model, renderer, false);
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const horizontal = Math.max(size.x, size.z, .001);
        const scale = config.targetWidth / horizontal;
        model.scale.setScalar(scale);
        box.setFromObject(model);
        const scaledSize = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        model.position.set(-center.x, -box.min.y, -center.z);
        const root = new THREE.Group();
        root.name = `District: ${config.name}`;
        root.position.set(...config.position);
        root.rotation.y = config.rotation ?? 0;
        root.add(model);
        scene.add(root);
        districtRoots.set(config.id, root);

        const proxyMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
        proxyMaterial.colorWrite = false;
        const proxy = new THREE.Mesh(new THREE.BoxGeometry(config.targetWidth * .94, Math.max(60, scaledSize.y), config.targetWidth * .72), proxyMaterial);
        proxy.position.set(config.position[0], Math.max(60, scaledSize.y) / 2, config.position[2]);
        proxy.name = `Web anchor proxy: ${config.name}`;
        scene.add(proxy);
        anchorTargets.push(proxy);
        loadedDistricts.add(config.id);
        notifyLoaded();
        if (reportProgress && config.id === currentDistrict) callbacksRef.current.onStatus(`${config.name} online`, 100);
        return root;
      })().catch((error) => {
        districtPromises.delete(config.id);
        console.error(`Unable to stream ${config.name}`, error);
        if (reportProgress) callbacksRef.current.onStatus(`${config.name} unavailable — city grid remains active`, 100);
        throw error;
      });
      districtPromises.set(config.id, promise);
      return promise;
    };

    const loadAvatar = async () => {
      const suit = getSuit(props.suitId);
      callbacksRef.current.onStatus(`Syncing ${suit.name} rig`, 4);
      const gltf = await loadModel<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>(suit.model, `${suit.name} suit`, 4, 45);
      const model = gltf.scene;
      if (suit.id === 'miles') {
        model.traverse((object) => {
          if (object instanceof THREE.Mesh && !(object instanceof THREE.SkinnedMesh)) object.visible = false;
        });
      }
      prepMaterials(model, renderer, true);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const scale = 2.05 / Math.max(size.y, .001);
      model.scale.setScalar(scale);
      box.setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      model.position.set(-center.x, -box.min.y, -center.z);
      model.rotation.y = Math.PI;
      const root = new THREE.Group();
      root.name = `Player: ${suit.name}`;
      root.add(model);
      root.position.copy(player.position);
      scene.add(root);

      const mixer = gltf.animations.length ? new THREE.AnimationMixer(model) : null;
      const actions = new Map<string, THREE.AnimationAction>();
      if (mixer) gltf.animations.forEach((clip) => actions.set(clip.name.toLowerCase(), mixer.clipAction(clip)));
      const bones: AvatarRig['bones'] = [];
      model.traverse((object) => {
        if (!(object instanceof THREE.Bone)) return;
        const role = boneRole(object.name);
        if (role && !bones.some((entry) => entry.role === role)) bones.push({ bone: object, baseX: object.rotation.x, baseY: object.rotation.y, baseZ: object.rotation.z, role });
      });
      avatar = { root, model, mixer, actions, activeAction: '', bones };
    };

    const setAnimation = (name: 'idle' | 'run' | 'swing') => {
      if (!avatar?.mixer || !avatar.actions.size) return;
      const candidates = name === 'idle' ? ['stand', 'idle', 'animation'] : name === 'run' ? ['run', 'walk'] : ['hanging', 'swingstart', 'swing'];
      let key = '';
      for (const candidate of candidates) {
        key = [...avatar.actions.keys()].find((actionName) => actionName.includes(candidate)) ?? '';
        if (key) break;
      }
      if (!key || key === avatar.activeAction) return;
      const next = avatar.actions.get(key);
      const previous = avatar.actions.get(avatar.activeAction);
      previous?.fadeOut(.18);
      next?.reset().fadeIn(.18).play();
      avatar.activeAction = key;
    };

    const startSwing = (ndc: THREE.Vector2, source: SwingState['source']) => {
      if (!ready) return;
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(anchorTargets, false).find((item) => item.distance > 8 && item.point.y > player.position.y + 3);
      const direction = raycaster.ray.direction.clone();
      const fallbackDistance = clamp(70 + player.velocity.length() * 1.8, 70, 160);
      const anchor = hit?.point.clone() ?? player.position.clone().addScaledVector(direction, fallbackDistance).add(new THREE.Vector3(0, 38, 0));
      const distance = anchor.distanceTo(player.position);
      swing = { anchor, ropeLength: Math.max(12, distance * .92), source };
      player.grounded = false;
      webLine.visible = true;
      setAnimation('swing');
    };

    const stopSwing = (source?: SwingState['source']) => {
      if (!swing || (source && swing.source !== source)) return;
      swing = null;
      webLine.visible = false;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      startSwing(new THREE.Vector2(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1), 'mouse');
    };
    const onPointerUp = (event: PointerEvent) => { if (event.button === 0) stopSwing('mouse'); };
    const onKeyDown = (event: KeyboardEvent) => {
      const code = event.code;
      keys.add(code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) event.preventDefault();
      if (code === 'Space' && !event.repeat && !swing) startSwing(new THREE.Vector2(0, 0), 'space');
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
        player.position.set(district.position[0], 3, district.position[2] + district.targetWidth * .3);
        player.velocity.set(0, 0, 0);
        callbacksRef.current.onDistrictChange(id);
        callbacksRef.current.onStatus(`${district.name} ready`, 100);
      }).catch(() => undefined);
    };

    const updateAvatar = (delta: number, elapsed: number, movementAmount: number) => {
      if (!avatar) return;
      avatar.mixer?.update(delta);
      avatar.root.position.copy(player.position);
      avatar.root.rotation.y = damp(avatar.root.rotation.y, player.facing, 12, delta);
      avatar.root.rotation.z = damp(avatar.root.rotation.z, swing ? clamp(-player.velocity.x * .018, -.42, .42) : 0, 7, delta);
      avatar.root.rotation.x = damp(avatar.root.rotation.x, swing ? clamp(player.velocity.y * -.009, -.22, .24) : 0, 7, delta);
      const action = swing ? 'swing' : movementAmount > .15 ? 'run' : 'idle';
      setAnimation(action);

      if (!avatar.mixer || (action !== 'idle' && !avatar.activeAction)) {
        const stride = Math.sin(elapsed * (movementAmount > .15 ? 9 : 2.2));
        for (const entry of avatar.bones) {
          let targetX = entry.baseX;
          let targetZ = entry.baseZ;
          if (swing && (entry.role === 'leftArm' || entry.role === 'rightArm')) targetZ += entry.role === 'leftArm' ? -1.15 : 1.15;
          else if (movementAmount > .15 && entry.role === 'leftLeg') targetX += stride * .58;
          else if (movementAmount > .15 && entry.role === 'rightLeg') targetX -= stride * .58;
          else if (movementAmount > .15 && entry.role === 'leftArm') targetX -= stride * .42;
          else if (movementAmount > .15 && entry.role === 'rightArm') targetX += stride * .42;
          if (entry.role === 'spine') targetZ += swing ? .18 : stride * .03;
          entry.bone.rotation.x = damp(entry.bone.rotation.x, targetX, 13, delta);
          entry.bone.rotation.y = damp(entry.bone.rotation.y, entry.baseY, 13, delta);
          entry.bone.rotation.z = damp(entry.bone.rotation.z, targetZ, 13, delta);
        }
      }
    };

    const tick = (timestamp = performance.now()) => {
      if (disposed) return;
      frameId = requestAnimationFrame(tick);
      const delta = Math.min(Math.max((timestamp - lastFrameTime) / 1000, 0), .034);
      lastFrameTime = timestamp;
      elapsedTime += delta;
      const elapsed = elapsedTime;
      if (!ready) { renderer.render(scene, camera); return; }

      const previous = player.position.clone();
      if (keys.has('ArrowLeft')) cameraYaw += 1.45 * delta;
      if (keys.has('ArrowRight')) cameraYaw -= 1.45 * delta;
      if (keys.has('ArrowUp')) cameraPitch = clamp(cameraPitch - 1.05 * delta, -.42, .68);
      if (keys.has('ArrowDown')) cameraPitch = clamp(cameraPitch + 1.05 * delta, -.42, .68);

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
        const acceleration = wish.multiplyScalar(38 * delta);
        player.velocity.add(acceleration);
        const horizontal = new THREE.Vector2(player.velocity.x, player.velocity.z);
        if (horizontal.length() > 13) horizontal.setLength(13);
        player.velocity.x = horizontal.x;
        player.velocity.z = horizontal.y;
        const friction = wish.lengthSq() ? Math.exp(-3.8 * delta) : Math.exp(-10 * delta);
        player.velocity.x *= friction;
        player.velocity.z *= friction;
      } else if (wish.lengthSq()) {
        player.velocity.addScaledVector(wish, 11 * delta);
      }

      player.velocity.y -= 22 * delta;
      if (swing) {
        if (keys.has('Space')) swing.ropeLength = Math.max(12, swing.ropeLength - 8 * delta);
        const radial = player.position.clone().sub(swing.anchor);
        const distance = Math.max(.001, radial.length());
        radial.divideScalar(distance);
        const stretch = distance - swing.ropeLength;
        if (stretch > 0) {
          player.velocity.addScaledVector(radial, -stretch * 44 * delta);
          const outward = player.velocity.dot(radial);
          if (outward > 0) player.velocity.addScaledVector(radial, -outward * .98);
        }
        player.velocity.addScaledVector(forward, (keys.has('KeyW') ? 7.5 : 0) * delta);
      }

      player.position.addScaledVector(player.velocity, delta);
      if (player.position.y <= 0) {
        player.position.y = 0;
        player.velocity.y = Math.max(0, player.velocity.y);
        player.grounded = true;
        stopSwing();
      } else player.grounded = false;

      if (player.grounded) {
        collisionProbe.set(player.position.x, 1, player.position.z);
        for (const collider of procedural.colliders) {
          if (collider.containsPoint(collisionProbe)) {
            player.position.x = previous.x;
            player.position.z = previous.z;
            player.velocity.x *= -.08;
            player.velocity.z *= -.08;
            break;
          }
        }
      }
      if (player.position.y < -40 || Math.abs(player.position.x) > 1900 || Math.abs(player.position.z) > 1900) {
        const home = getDistrict(currentDistrict);
        player.position.set(home.position[0], 8, home.position[2] + 100);
        player.velocity.set(0, 0, 0);
        stopSwing();
      }

      if (wish.lengthSq() > 0) player.facing = Math.atan2(wish.x, wish.z);
      updateAvatar(delta, elapsed, movementAmount);

      if (swing) {
        const hand = player.position.clone().add(new THREE.Vector3(0, 1.55, 0));
        webPositions.set([hand.x, hand.y, hand.z, swing.anchor.x, swing.anchor.y, swing.anchor.z]);
        (webGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      }

      const speed = player.velocity.length();
      const distance = clamp(8.5 + speed * .075, 8.5, 14.5);
      const horizontalDistance = Math.cos(cameraPitch) * distance;
      const desired = player.position.clone().add(new THREE.Vector3(Math.sin(cameraYaw) * horizontalDistance, 3.2 + Math.sin(cameraPitch) * distance, Math.cos(cameraYaw) * horizontalDistance));
      camera.position.lerp(desired, 1 - Math.exp(-7.5 * delta));
      camera.lookAt(player.position.x, player.position.y + 1.45, player.position.z);
      sun.position.set(player.position.x - 260, player.position.y + 420, player.position.z + 180);

      for (const district of DISTRICTS) {
        if (loadedDistricts.has(district.id) || districtPromises.has(district.id)) continue;
        const dx = player.position.x - district.position[0];
        const dz = player.position.z - district.position[2];
        if (Math.hypot(dx, dz) < 380) void loadDistrict(district, false).catch(() => undefined);
      }

      hudAccumulator += delta;
      fpsAccumulator += delta;
      fpsFrames += 1;
      if (fpsAccumulator > .7) { measuredFps = Math.round(fpsFrames / fpsAccumulator); fpsFrames = 0; fpsAccumulator = 0; }
      if (hudAccumulator > .16) {
        callbacksRef.current.onHud({ speed: Math.round(speed * 7.4), altitude: Math.max(0, Math.round(player.position.y)), fps: measuredFps, swinging: Boolean(swing) });
        hudAccumulator = 0;
      }
      renderer.render(scene, camera);
    };

    const setup = async () => {
      try {
        callbacksRef.current.onStatus('Booting New York stream', 2);
        camera.position.set(9, 7, 86);
        camera.lookAt(player.position);
        tick();
        await Promise.all([loadAvatar(), loadDistrict(getDistrict('times-square'))]);
        if (disposed) return;
        player.position.set(0, 2, 82);
        ready = true;
        callbacksRef.current.onDistrictChange('times-square');
        callbacksRef.current.onStatus('New York online', 100);
        callbacksRef.current.onReady();
      } catch (error) {
        console.error('Unable to start New York', error);
        callbacksRef.current.onStatus('Asset recovery mode — procedural city online', 100);
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
        object.geometry?.dispose();
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
