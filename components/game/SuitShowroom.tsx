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
  onConfirm: () => void;
  onStatus: (message: string, progress: number) => void;
};

type DisplaySuit = {
  id: SuitId;
  holder: THREE.Group;
  baseX: number;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  light: THREE.PointLight;
  mixer: THREE.AnimationMixer | null;
  bones: RigBone[];
  label: HTMLButtonElement;
};

export default function SuitShowroom({ selected, onSelect, onConfirm, onStatus }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selected);
  const onSelectRef = useRef(onSelect);
  const onConfirmRef = useRef(onConfirm);
  const onStatusRef = useRef(onStatus);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onConfirmRef.current = onConfirm; }, [onConfirm]);
  useEffect(() => { onStatusRef.current = onStatus; }, [onStatus]);

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
    // Stand inside the authored warehouse shell, past its front facade.
    camera.position.set(0, 2.55, -.5);
    camera.lookAt(0, 1.35, -5.2);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .96;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = 'showroom-canvas';
    renderer.domElement.setAttribute('aria-label', 'Interactive abandoned warehouse suit selection');
    mount.appendChild(renderer.domElement);
    const labels = document.createElement('div');
    labels.className = 'showroom-labels';
    mount.appendChild(labels);

    scene.add(new THREE.HemisphereLight('#759bc7', '#170909', 1.1));
    const key = new THREE.SpotLight('#badfff', 28, 38, Math.PI / 4, .58, 1.4);
    key.position.set(-7, 7, 1);
    key.target.position.set(0, 1, -5.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key, key.target);
    const redRim = new THREE.SpotLight('#ff244a', 20, 34, Math.PI / 4, .6, 1.4);
    redRim.position.set(8, 6, -1);
    redRim.target.position.set(0, 1, -5.2);
    scene.add(redRim, redRim.target);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(38, 25),
      new THREE.MeshStandardMaterial({ color: '#111318', roughness: .86, metalness: .12 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = .018;
    floor.receiveShadow = true;
    scene.add(floor);

    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const displays: DisplaySuit[] = [];
    const clickableMeshes: THREE.Object3D[] = [];
    const spacing = 1.12;
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
        onStatusRef.current('Opening abandoned warehouse', 3);
        const warehouse = await load<{ scene: THREE.Group }>('/assets/warehouse.glb', (ratio) => onStatusRef.current('Opening abandoned warehouse', 3 + ratio * 24));
        if (disposed) return;
        const warehouseRoot = warehouse.scene;
        prepareMaterials(warehouseRoot, renderer, 'environment');
        warehouseRoot.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          const names = `${object.name} ${materials.map((material) => material.name).join(' ')}`;
          if (/beziercurve|icosphere|cardboard|cable|gravas|^plane_0\b|\bfloor\b/i.test(names)) object.visible = false;
        });
        // Exact placement measured from the source file's authored floor Plane_0.
        // This avoids debris-skewed bounding boxes and leaves the lineup inside.
        warehouseRoot.scale.setScalar(1.65965882);
        warehouseRoot.position.set(-4.351744, 4.867527, 8.737152);
        scene.add(warehouseRoot);

        await Promise.all(SUITS.map(async (suit, index) => {
          const start = 30 + (index / SUITS.length) * 62;
          const gltf = await load<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>(suit.model, (ratio) => {
            onStatusRef.current(`Rigging ${suit.name}`, start + ratio * (58 / SUITS.length));
          });
          if (disposed) return;
          prepareMaterials(gltf.scene, renderer, 'character');
          normalizeSuit(gltf.scene, suit, 2.1);
          const holder = new THREE.Group();
          const baseX = (index - (SUITS.length - 1) / 2) * spacing;
          holder.position.set(baseX, .02, -5.2 - Math.abs(index - (SUITS.length - 1) / 2) * .025);
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
          label.setAttribute('aria-label', `Select ${suit.name}; double-click to enter`);
          label.addEventListener('click', () => onSelectRef.current(suit.id));
          label.addEventListener('dblclick', () => onConfirmRef.current());
          labels.appendChild(label);

          let mixer: THREE.AnimationMixer | null = null;
          const idle = poseOnlyClips(gltf.animations).find((clip) => /stand|idle/i.test(clip.name));
          if (idle) {
            mixer = new THREE.AnimationMixer(gltf.scene);
            mixer.clipAction(idle).play();
          }
          displays.push({ id: suit.id, holder, baseX, ring, light, mixer, bones: collectRigBones(gltf.scene), label });
        }));
        if (!disposed) onStatusRef.current('All eight heroes online', 100);
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
      renderer.domElement.style.cursor = hovered ? 'pointer' : 'crosshair';
    };
    const choosePointer = () => { if (hovered) onSelectRef.current(hovered); };
    const confirmPointer = () => { if (hovered && hovered === selectedRef.current) onConfirmRef.current(); };
    renderer.domElement.addEventListener('pointermove', readPointer);
    renderer.domElement.addEventListener('pointerdown', choosePointer);
    renderer.domElement.addEventListener('dblclick', confirmPointer);

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
        if (!display.mixer) animateRigBones(display.bones, 'idle', elapsed + display.baseX, delta);
        const active = display.id === selectedRef.current;
        const hot = active || display.id === hovered;
        const scale = active ? 1.045 : display.id === hovered ? 1.02 : .94;
        display.holder.scale.lerp(new THREE.Vector3(scale, scale, scale), 1 - Math.exp(-9 * delta));
        display.holder.position.x = THREE.MathUtils.damp(display.holder.position.x, display.baseX, 8, delta);
        display.holder.position.z = THREE.MathUtils.damp(display.holder.position.z, active ? -4.82 : -5.2 - Math.abs(display.baseX / spacing) * .025, 8, delta);
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
      camera.position.x = THREE.MathUtils.damp(camera.position.x, pointer.x * .32, 3, delta);
      camera.lookAt(camera.position.x * .18, 1.35, -5.2);
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointermove', readPointer);
      renderer.domElement.removeEventListener('pointerdown', choosePointer);
      renderer.domElement.removeEventListener('dblclick', confirmPointer);
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
