'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SUITS, type SuitId } from '@/lib/game-config';
import { animateRigBones, collectRigBones, normalizeSuit, poseOnlyClips, prepareMaterials, type RigBone } from '@/lib/three-assets';

type Props = {
  selected: SuitId;
  onSelect: (id: SuitId) => void;
  onStatus: (message: string, progress: number) => void;
};

type DisplaySuit = {
  id: SuitId;
  holder: THREE.Group;
  baseZ: number;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  light: THREE.PointLight;
  mixer: THREE.AnimationMixer | null;
  bones: RigBone[];
  rigPreset?: 't-pose';
  label: HTMLButtonElement;
};

export default function SuitShowroom({ selected, onSelect, onStatus }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selected);
  const onSelectRef = useRef(onSelect);
  const onStatusRef = useRef(onStatus);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onStatusRef.current = onStatus; }, [onStatus]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;
    let frameId = 0;
    let hovered: SuitId | null = null;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#01040a');
    scene.fog = new THREE.Fog('#01040a', 13, 42);
    const camera = new THREE.PerspectiveCamera(52, 1, .05, 140);
    camera.position.set(10.7, 2.82, 0);
    camera.lookAt(2.65, 1.08, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .96;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = 'showroom-canvas';
    renderer.domElement.setAttribute('aria-label', 'Interactive Avengers Tower helipad suit selection');
    mount.appendChild(renderer.domElement);
    const labels = document.createElement('div');
    labels.className = 'showroom-labels';
    mount.appendChild(labels);

    scene.add(new THREE.HemisphereLight('#79bde8', '#16080e', 1.55));
    const key = new THREE.SpotLight('#c6eaff', 34, 42, Math.PI / 4, .52, 1.35);
    key.position.set(10, 8, 6);
    key.target.position.set(3, 1, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key, key.target);
    const redRim = new THREE.SpotLight('#ff244a', 26, 38, Math.PI / 4, .58, 1.4);
    redRim.position.set(-2, 7, -6);
    redRim.target.position.set(3, 1, 0);
    scene.add(redRim, redRim.target);

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const displays: DisplaySuit[] = [];
    const clickableMeshes: THREE.Object3D[] = [];
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2(5, 5);
    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
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
        onStatusRef.current('Opening Avengers Tower helipad', 3);
        const tower = await load<{ scene: THREE.Group }>('/assets/showroom/avengers-tower.glb', (ratio) => onStatusRef.current('Opening Avengers Tower helipad', 3 + ratio * 24));
        if (disposed) return;
        const towerRoot = tower.scene;
        prepareMaterials(towerRoot, renderer, 'environment');
        // The downloaded asset's named Plataforma_01 helipad surface sits at
        // source Y 2.345. Scale and offset it to world Y 0 for the lineup.
        const towerScale = 9.5;
        towerRoot.scale.setScalar(towerScale);
        towerRoot.position.set(-3.04, -2.345 * towerScale, 0);
        scene.add(towerRoot);

        await Promise.all(SUITS.map(async (suit, index) => {
          const start = 30 + (index / SUITS.length) * 62;
          const gltf = await load<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>(suit.model, (ratio) => {
            onStatusRef.current(`Rigging ${suit.name}`, start + ratio * (58 / SUITS.length));
          });
          if (disposed) return;
          prepareMaterials(gltf.scene, renderer, 'character');
          normalizeSuit(gltf.scene, suit, 2.1);
          const holder = new THREE.Group();
          const baseZ = (index - (SUITS.length - 1) / 2) * .8;
          holder.position.set(3.1 - Math.abs(baseZ) * .025, .035, baseZ);
          holder.rotation.y = Math.PI * 1.5;
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
          ring.position.set(holder.position.x, .04, baseZ);
          scene.add(ring);
          const light = new THREE.PointLight('#52cfff', 4, 5, 1.8);
          light.position.set(holder.position.x + .25, 2.35, baseZ);
          scene.add(light);

          const label = document.createElement('button');
          label.type = 'button';
          label.className = 'showroom-suit-label';
          label.textContent = suit.id === 'miguel' ? '2099' : suit.id === 'miles' ? 'Miles' : suit.id === 'ps4' ? 'PS4' : suit.name;
          label.setAttribute('aria-label', `Select ${suit.name}`);
          label.addEventListener('click', () => onSelectRef.current(suit.id));
          labels.appendChild(label);

          let mixer: THREE.AnimationMixer | null = null;
          const idle = poseOnlyClips(gltf.animations).find((clip) => /stand|idle/i.test(clip.name));
          if (idle) {
            mixer = new THREE.AnimationMixer(gltf.scene);
            mixer.clipAction(idle).play();
          }
          displays.push({ id: suit.id, holder, baseZ, ring, light, mixer, bones: collectRigBones(gltf.scene), rigPreset: suit.rigPreset, label });
        }));
        if (!disposed) onStatusRef.current('All seven heroes online', 100);
      } catch (error) {
        console.error('[showroom] unable to assemble warehouse', error);
        onStatusRef.current('Tower recovery lighting active', 100);
      }
    };
    void setup();

    const readPointer = (event: PointerEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(clickableMeshes, false)[0];
      hovered = (hit?.object.userData.suitId as SuitId | undefined) ?? null;
      renderer.domElement.style.cursor = hovered ? 'pointer' : 'crosshair';
    };
    const choosePointer = () => { if (hovered) onSelectRef.current(hovered); };
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
        display.mixer?.update(delta);
        if (!display.mixer) animateRigBones(display.bones, 'idle', elapsed + display.baseZ, delta, display.rigPreset);
        const active = display.id === selectedRef.current;
        const hot = active || display.id === hovered;
        const scale = active ? 1.045 : display.id === hovered ? 1.02 : .94;
        display.holder.scale.lerp(new THREE.Vector3(scale, scale, scale), 1 - Math.exp(-9 * delta));
        display.holder.position.x = THREE.MathUtils.damp(display.holder.position.x, active ? 3.58 : 3.1 - Math.abs(display.baseZ) * .025, 8, delta);
        display.holder.position.z = THREE.MathUtils.damp(display.holder.position.z, display.baseZ, 8, delta);
        display.ring.material.color.set(active ? '#ff2747' : hot ? '#6de8ff' : '#244d60');
        display.ring.material.opacity = active ? .95 : hot ? .72 : .35;
        display.ring.scale.setScalar(active ? 1.18 + Math.sin(elapsed * 4) * .025 : 1);
        display.light.color.set(active ? '#ff2949' : '#52cfff');
        display.light.intensity = THREE.MathUtils.damp(display.light.intensity, active ? 8 : hot ? 5 : 1.2, 8, delta);
        const labelPosition = new THREE.Vector3(display.holder.position.x, 2.5, display.holder.position.z).project(camera);
        display.label.style.left = `${(labelPosition.x * .5 + .5) * mount.clientWidth}px`;
        display.label.style.top = `${(-labelPosition.y * .5 + .5) * mount.clientHeight}px`;
        display.label.classList.toggle('is-selected', active);
        display.label.classList.toggle('is-hovered', display.id === hovered);
      }
      camera.position.z = THREE.MathUtils.damp(camera.position.z, pointer.x * .3, 3, delta);
      camera.lookAt(2.65, 1.08, camera.position.z * .16);
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
