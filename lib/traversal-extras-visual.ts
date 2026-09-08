/** Procedural presentation only. These membranes are not Insomniac assets or
 * a substitute for authored 2099 wing animations. Never changes physics. */
import * as THREE from 'three';
import type { RigBone } from './three-assets';
import type { AdvancedRuntime } from './traversal-advanced';
/** Joint-following, scalloped membranes with ribs; deployment unfolds over .3s. */
export class WebWingVisual {
  readonly mesh: THREE.Mesh;
  private readonly ribs: THREE.LineSegments;
  private readonly wind: THREE.LineSegments;
  private readonly positions = new Float32Array(2 * 9 * 7 * 3);
  private readonly linePositions: Float32Array;
  private readonly windPositions = new Float32Array(32 * 6);
  private readonly lineIndices: number[] = [];
  private inverse = new THREE.Matrix4();
  private amount = 0;
  private time = 0;
  private readonly model: THREE.Object3D;
  private readonly bones: readonly RigBone[];
  constructor(model: THREE.Object3D, bones: readonly RigBone[]) {
    this.model = model; this.bones = bones;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const indices: number[] = [];
    for (let side = 0; side < 2; side++) for (let row = 0; row < 9; row++) for (let col = 0; col < 7; col++) {
      const i = side * 63 + row * 7 + col;
      if (row < 8 && col < 6) indices.push(i, i + 7, i + 1, i + 1, i + 7, i + 8);
      if (row < 8 && (col === 6 || col === 3)) this.lineIndices.push(i, i + 7);
      if (col < 6 && row % 2 === 0) this.lineIndices.push(i, i + 1);
    }
    geometry.setIndex(indices);
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({color: 0xe7e6d9, side: THREE.DoubleSide, transparent: true, opacity: .55, depthWrite: false}));
    this.mesh.name = 'Deploying web-wing membranes'; this.mesh.frustumCulled = false; this.mesh.visible = false;
    this.linePositions = new Float32Array(this.lineIndices.length * 3);
    const ribs = new THREE.BufferGeometry(); ribs.setAttribute('position', new THREE.BufferAttribute(this.linePositions, 3));
    this.ribs = new THREE.LineSegments(ribs, new THREE.LineBasicMaterial({color: 0x283852, transparent: true, opacity: .85}));
    this.ribs.frustumCulled = false; this.ribs.visible = false;
    const wind = new THREE.BufferGeometry(); wind.setAttribute('position', new THREE.BufferAttribute(this.windPositions, 3));
    this.wind = new THREE.LineSegments(wind, new THREE.LineBasicMaterial({color: 0xdff5ff, transparent: true, opacity: .4, depthWrite: false}));
    this.wind.frustumCulled = false; this.wind.visible = false;
    model.add(this.mesh, this.ribs, this.wind);
  }
  update(active: boolean, delta = 1 / 60, speed = 0): void {
    this.time += delta;
    this.amount = THREE.MathUtils.damp(this.amount, active ? 1 : 0, active ? 10 : 18, delta);
    this.mesh.visible = this.ribs.visible = this.amount > .015;
    this.wind.visible = active && speed > 18;
    if (!this.mesh.visible) return;
    this.model.updateWorldMatrix(true, true); this.inverse.copy(this.model.matrixWorld).invert();
    const joint = (role: string) => this.bones.find(b => b.role === role)?.bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(this.inverse);
    for (const [side, label] of ['left', 'right'].entries()) {
      const arm = joint(`${label}Arm`), wrist = joint(`${label}Hand`), hip = joint(`${label}UpLeg`);
      if (!arm || !wrist || !hip) { this.mesh.visible = this.ribs.visible = false; return; }
      const pit = arm.clone().lerp(hip, .14);
      for (let row = 0; row < 9; row++) {
        const t = row / 8;
        const edge = wrist.clone().lerp(hip, t);
        // Concave trailing edge between wrist and waist, with scalloped web bays.
        edge.lerp(pit, Math.sin(Math.PI * t) * .25 + Math.sin(t * Math.PI * 4) ** 2 * .07);
        for (let col = 0; col < 7; col++) {
          const radial = col / 6;
          const point = pit.clone().lerp(edge, radial * this.amount);
          point.z += Math.sin(this.time * 9 + row * .8) * .7 * Math.sin(Math.PI * radial) * this.amount;
          point.toArray(this.positions, (side * 63 + row * 7 + col) * 3);
        }
      }
    }
    for (let i = 0; i < this.lineIndices.length; i++) this.linePositions.set(this.positions.subarray(this.lineIndices[i] * 3, this.lineIndices[i] * 3 + 3), i * 3);
    this.mesh.geometry.getAttribute('position').needsUpdate = true;
    this.ribs.geometry.getAttribute('position').needsUpdate = true;
    // Local rig units are converted from metres using its world scale.
    const scale = this.model.getWorldScale(new THREE.Vector3()).length() / Math.sqrt(3);
    const hip = joint('hips') ?? new THREE.Vector3();
    for (let i = 0; i < 32; i++) {
      const angle = i * 2.39996, radius = (1.4 + (i % 5) * .55) / scale;
      const z = (((i * .618 + this.time * speed / 25) % 1) * 16 - 8) / scale;
      const x = hip.x + Math.cos(angle) * radius, y = hip.y + Math.sin(angle) * radius;
      this.windPositions.set([x, y, hip.z + z, x, y, hip.z + z + Math.min(2, speed / 30) / scale], i * 6);
    }
    this.wind.geometry.getAttribute('position').needsUpdate = true;
  }
}
export class TraversalTetherVisual {
  readonly lines: THREE.LineSegments;
  private positions = new Float32Array(12);
  constructor(scene: THREE.Scene) {
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(this.positions,3));
    this.lines=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0xe6fbff,transparent:true,opacity:.9}));
    this.lines.name='Slingshot and corner webs';this.lines.visible=false;this.lines.frustumCulled=false;scene.add(this.lines);
  }
  update(hands: readonly {x:number;y:number;z:number}[], advanced?: AdvancedRuntime): void {
    const anchors=advanced?.sling?.anchors??(advanced?.corner?[advanced.corner.anchor]:[]);
    this.lines.visible=anchors.length>0;
    if(!anchors.length)return;
    for(let i=0;i<2;i++){
      const a=anchors[Math.min(i,anchors.length-1)];
      const hand=hands[i] ?? hands[0];
      this.positions.set([hand.x,hand.y,hand.z,a.x,a.y,a.z],i*6);
    }
    this.lines.geometry.getAttribute('position').needsUpdate=true;
  }
  dispose():void {
    this.lines.removeFromParent();this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
  }
}
