'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { supportLegacyMaterials, calibrate2099Materials } from '@/lib/gltf-materials';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SUITS, type SuitId } from '@/lib/game-config';
import { isSuitUnlocked, type PlayerProgress } from '@/lib/progression';
import { applySuitRestPose, normalizeSuit, suitAnimationClips, prepareMaterials, retargetMixamoClips } from '@/lib/three-assets';
import { AvatarAnimator } from '@/lib/avatar-animation';

type Props = {
  selected: SuitId;
  engaged: boolean;
  progress: PlayerProgress;
  onSelect: (id: SuitId) => void;
  onEngage: () => void;
  onStatus: (message: string, progress: number) => void;
};

const LOBBY_SUIT = SUITS.find((suit) => suit.id === 'miguel')!;
const LOBBY_SUITS = [LOBBY_SUIT] as const;

type DisplaySuit = {
  id: SuitId;
  holder: THREE.Group;
  baseX: number;
  labelY: number;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  light: THREE.PointLight;
  animator: AvatarAnimator;
  label: HTMLButtonElement;
  swingProgress: HTMLDivElement;
  swingBar: HTMLProgressElement;
  swingCaption: HTMLSpanElement;
};

export default function SuitShowroom({ selected, engaged, progress, onSelect, onEngage, onStatus }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selected);
  const onSelectRef = useRef(onSelect);
  const onEngageRef = useRef(onEngage);
  const onStatusRef = useRef(onStatus);
  const progressRef = useRef(progress);
  const engagedRef = useRef(engaged);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { engagedRef.current = engaged; }, [engaged]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onEngageRef.current = onEngage; }, [onEngage]);
  useEffect(() => { onStatusRef.current = onStatus; }, [onStatus]);
  useEffect(() => { progressRef.current = progress; }, [progress]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;
    let frameId = 0;
    let hovered: SuitId | null = null;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#05070a');
    scene.fog = new THREE.Fog('#05070a', 11, 32);
    const camera = new THREE.PerspectiveCamera(67, 1, .05, 120);
    camera.position.set(0, 2.55, -.5);
    camera.lookAt(0, 1.35, -4.4);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .96;
    renderer.shadowMap.enabled = true;
    renderer.localClippingEnabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = 'showroom-canvas';
    renderer.domElement.setAttribute('aria-label', 'Interactive Spider-Man 2099 selection');
    mount.appendChild(renderer.domElement);
    const labels = document.createElement('div');
    labels.className = 'showroom-labels';
    mount.appendChild(labels);

    scene.add(new THREE.HemisphereLight('#759bc7', '#170909', 1.1));
    const key = new THREE.SpotLight('#badfff', 28, 38, Math.PI / 4, .58, 1.4);
    key.position.set(-7, 7, 1);
    key.target.position.set(0, 1, -4.4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key, key.target);
    const redRim = new THREE.SpotLight('#ff244a', 20, 34, Math.PI / 4, .6, 1.4);
    redRim.position.set(8, 6, -1);
    redRim.target.position.set(0, 1, -4.4);
    scene.add(redRim, redRim.target);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(38, 25),
      new THREE.MeshStandardMaterial({ color: '#111318', roughness: .86, metalness: .12 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = .018;
    floor.receiveShadow = true;
    scene.add(floor);

    const loader = supportLegacyMaterials(new GLTFLoader());
    loader.setMeshoptDecoder(MeshoptDecoder);
    const displays: DisplaySuit[] = [];
    const clickableMeshes: THREE.Object3D[] = [];
    const spacing = 1.12;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2(0, 0);
    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      const halfLineup = (LOBBY_SUITS.length - 1) * spacing * .5 + 1.15;
      const fitDistance = halfLineup / (Math.tan(THREE.MathUtils.degToRad(camera.fov * .5)) * camera.aspect * .88);
      camera.position.z = -4.4 + Math.max(5.6, fitDistance);
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    const load = <T,>(url: string, onProgress?: (ratio: number) => void) => new Promise<T>((resolve, reject) => {
      loader.load(url, (value) => resolve(value as T), (event) => {
        if (onProgress) onProgress(event.total > 0 ? event.loaded / event.total : 0);
      }, reject);
    });

    const setup = async () => {
      try {
        onStatusRef.current('Opening abandoned warehouse', 3);
        const warehouse = await load<{ scene: THREE.Group }>('/assets/warehouse.glb', (ratio) => onStatusRef.current('Opening abandoned warehouse', 3 + ratio * 24));
        if (disposed) return;
        const warehouseRoot = warehouse.scene;
        prepareMaterials(warehouseRoot, renderer, 'environment');
        // The source merges foreground chairs/cables into its structural mesh.
        // Clear only the camera-facing showroom foreground, preserving the
        // warehouse backdrop and avoiding destructive edits to that GLB.
        const foregroundCut = new THREE.Plane(new THREE.Vector3(0, 0, -1), -2.5);
        warehouseRoot.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) material.clippingPlanes = [foregroundCut];
          const names = `${object.name} ${materials.map((material) => material.name).join(' ')}`;
          if (/beziercurve|icosphere|cardboard|cable|gravas|^plane_0\b|\bfloor\b/i.test(names)) object.visible = false;
        });
        warehouseRoot.scale.setScalar(1.65965882);
        warehouseRoot.position.set(-4.351744, 4.867527, 8.737152);
        scene.add(warehouseRoot);

        const libraryPromise = load<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>(LOBBY_SUIT.animationSource!);
        await Promise.all(LOBBY_SUITS.map(async (suit, index) => {
          const start = 30 + (index / LOBBY_SUITS.length) * 62;
          const gltf = await load<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>(suit.model, (ratio) => {
            onStatusRef.current(`Rigging ${suit.name}`, start + ratio * (58 / LOBBY_SUITS.length));
          });
          if (disposed) return;
          prepareMaterials(gltf.scene, renderer, 'character');
          calibrate2099Materials(gltf.scene);
          const authored = suitAnimationClips(gltf.animations, suit);
          applySuitRestPose(gltf.scene, suit, authored);
          if (suit.animationSource && suit.animationSource !== suit.model) {
            const library = await libraryPromise;
            if (disposed) return;
            authored.push(...retargetMixamoClips(library.animations, library.scene, gltf.scene));
          }
          normalizeSuit(gltf.scene, suit, 2.1);
          const holder = new THREE.Group();
          const baseX = (index - (LOBBY_SUITS.length - 1) / 2) * spacing;
          holder.position.set(baseX, .02, -4.4);
          holder.rotation.y = Math.PI;
          holder.add(gltf.scene);
          holder.userData.suitId = suit.id;
          scene.add(holder);
          holder.traverse((object) => {
            if (object instanceof THREE.Mesh) {
              object.userData.suitId = suit.id;
              clickableMeshes.push(object);
            }
          });

          const ringMaterial = new THREE.MeshBasicMaterial({ color: '#244d60', transparent: true, opacity: .42, side: THREE.DoubleSide });
          const ring = new THREE.Mesh(new THREE.RingGeometry(.62, .72, 48), ringMaterial);
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(baseX, .025, holder.position.z);
          scene.add(ring);
          const light = new THREE.PointLight('#52cfff', 4, 5, 1.8);
          light.position.set(baseX, 2.35, holder.position.z + .35);
          scene.add(light);

          const label = document.createElement('button');
          label.type = 'button';
          label.className = 'showroom-suit-label';
          label.textContent = suit.name;
          label.setAttribute('aria-label', `Select ${suit.name}`);
          const swingProgress = document.createElement('div');
          swingProgress.className = 'showroom-swing-progress';
          swingProgress.hidden = true;
          const swingBar = document.createElement('progress');
          swingBar.max = suit.unlockSwings ?? 50;
          swingBar.value = Math.min(swingBar.max, progressRef.current.swingAttachments);
          swingBar.setAttribute('aria-label', `${suit.name} swing unlock progress`);
          const swingCaption = document.createElement('span');
          swingCaption.setAttribute('aria-hidden', 'true');
          swingProgress.appendChild(swingCaption);
          swingProgress.appendChild(swingBar);
          labels.appendChild(swingProgress);

          const animator = new AvatarAnimator(gltf.scene, suit, authored);
          label.addEventListener('click', () => {
            if (!isSuitUnlocked(suit, progressRef.current)) return;
            animator.playRandomLobbyEmote();
            onSelectRef.current(suit.id);
            onEngageRef.current();
          });
          labels.appendChild(label);
          displays.push({ id: suit.id, holder, baseX, labelY: index % 2 ? .16 : 0, ring, light, animator, label, swingProgress, swingBar, swingCaption });
        }));
        if (!disposed) onStatusRef.current('Spider-Man 2099 online', 100);
      } catch (error) {
        console.error('[showroom] unable to assemble warehouse', error);
        onStatusRef.current('Warehouse recovery lighting active', 100);
      }
    };
    void setup();

    const readPointer = (event: PointerEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(clickableMeshes, false)[0];
      hovered = (hit?.object.userData.suitId as SuitId | undefined) ?? null;
      const hoveredSuit = LOBBY_SUITS.find((suit) => suit.id === hovered);
      renderer.domElement.style.cursor = hoveredSuit && !isSuitUnlocked(hoveredSuit, progressRef.current) ? 'not-allowed' : hovered ? 'pointer' : 'crosshair';
    };
    const choosePointer = () => {
      const suit = LOBBY_SUITS.find((item) => item.id === hovered);
      const display = displays.find((item) => item.id === hovered);
      if (!suit || !display || !isSuitUnlocked(suit, progressRef.current)) return;
      display.animator.playRandomLobbyEmote();
      onSelectRef.current(suit.id);
      onEngageRef.current();
    };
    renderer.domElement.addEventListener('pointermove', readPointer);
    renderer.domElement.addEventListener('pointerdown', choosePointer);

    let lastFrame = performance.now();
    let elapsed = 0;
    const tick = (timestamp = performance.now()) => {
      if (disposed) return;
      frameId = requestAnimationFrame(tick);
      const delta = Math.min(Math.max((timestamp - lastFrame) / 1000, 0), .034);
      lastFrame = timestamp;
      elapsed += delta;
      for (const display of displays) {
        const suit = LOBBY_SUITS.find((item) => item.id === display.id)!;
        const unlocked = isSuitUnlocked(suit, progressRef.current);
        const active = display.id === selectedRef.current;
        const focused = engagedRef.current && active;
        display.animator.update(delta, { pose: 'idle', grounded: true, lobby: unlocked && focused });
        display.label.dataset.animation = display.animator.activeClip;
        display.label.dataset.soleError = display.animator.contactError.toFixed(4);
        const hot = active || display.id === hovered;
        const scale = focused ? 1.28 : display.id === hovered ? 1.1 : 1.04;
        display.holder.scale.lerp(new THREE.Vector3(scale, scale, scale), 1 - Math.exp(-9 * delta));
        const targetX = focused ? -1.65 : display.baseX;
        display.holder.position.x = THREE.MathUtils.damp(display.holder.position.x, targetX, 6, delta);
        display.holder.position.z = THREE.MathUtils.damp(display.holder.position.z, focused ? -3.75 : -4.25, 6, delta);
        display.ring.position.x = THREE.MathUtils.damp(display.ring.position.x, targetX, 6, delta);
        display.ring.position.z = THREE.MathUtils.damp(display.ring.position.z, display.holder.position.z, 6, delta);
        display.light.position.x = THREE.MathUtils.damp(display.light.position.x, targetX, 6, delta);
        display.ring.material.color.set(active ? '#ff2747' : hot ? '#6de8ff' : '#244d60');
        display.ring.material.opacity = active ? .95 : hot ? .72 : .35;
        display.ring.scale.setScalar(active ? 1.18 + Math.sin(elapsed * 4) * .025 : 1);
        display.light.color.set(active ? '#ff2949' : '#52cfff');
        display.light.intensity = THREE.MathUtils.damp(display.light.intensity, active ? 8 : hot ? 5 : 1.2, 8, delta);
        const labelPosition = new THREE.Vector3(display.holder.position.x, 2.5 + display.labelY, display.holder.position.z).project(camera);
        display.label.style.left = `${(labelPosition.x * .5 + .5) * mount.clientWidth}px`;
        display.label.style.top = `${(-labelPosition.y * .5 + .5) * mount.clientHeight}px`;
        display.label.textContent = suit.name;
        display.label.disabled = !unlocked;
        display.label.setAttribute('aria-disabled', String(!unlocked));
        display.label.classList.toggle('is-locked', !unlocked);
        display.label.classList.toggle('is-selected', active);
        display.label.classList.toggle('is-hovered', display.id === hovered);
        display.swingProgress.style.left = display.label.style.left;
        display.swingProgress.style.top = display.label.style.top;
        display.swingProgress.hidden = !suit.unlockSwings;
        const completed = Math.min(suit.unlockSwings ?? 50, progressRef.current.swingAttachments);
        display.swingBar.value = completed;
        display.swingCaption.textContent = `${completed} / ${suit.unlockSwings ?? 50} swings`;
      }
      const focused = engagedRef.current;
      camera.position.x = THREE.MathUtils.damp(camera.position.x, (focused ? .08 : 0) + pointer.x * .18, 3, delta);
      camera.position.z = THREE.MathUtils.damp(camera.position.z, focused ? .25 : 1.2, 4.5, delta);
      camera.lookAt(focused ? -.72 : camera.position.x * .18, 1.35, focused ? -3.75 : -4.4);
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointermove', readPointer);
      renderer.domElement.removeEventListener('pointerdown', choosePointer);
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
      labels.remove();
    };
  }, []);

  return <div ref={mountRef} className="showroom-mount" />;
}
