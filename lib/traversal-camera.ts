import * as THREE from 'three';

type Cast = (origin: THREE.Vector3, direction: THREE.Vector3, maximum: number) => { distance: number } | null;

/** Finite-width collision boom; protects the near plane as well as its center. */
export function constrainCameraBoom(target: THREE.Vector3, desired: THREE.Vector3, cast: Cast, radius = .3) {
  const sight = desired.clone().sub(target), distance = sight.length();
  if (distance < .01) return desired;
  sight.divideScalar(distance);
  const side = new THREE.Vector3().crossVectors(sight, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(side, sight).normalize();
  let available = distance;
  for (const [x, y] of [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const origin = target.clone().addScaledVector(side, x * radius).addScaledVector(up, y * radius);
    const hit = cast(origin, sight, distance + radius);
    if (hit) available = Math.min(available, Math.max(.1, hit.distance - radius));
  }
  return desired.copy(target).addScaledVector(sight, available);
}

/** Port of the reference's TraversalSpeedBlur shader. A clear center protects
 * the character and HUD; bounded acceleration pulses clear during steady air. */
export class TraversalSpeedBlur {
  private target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material = new THREE.ShaderMaterial({
    uniforms: { source: { value: this.target.texture }, strength: { value: 0 } },
    depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }',
    fragmentShader: `uniform sampler2D source; uniform float strength; varying vec2 vUv;
      void main(){
        vec2 offset=vUv-vec2(.5,.46);
        vec2 radial=offset*strength*smoothstep(.14,.55,length(offset));
        vec4 color=texture2D(source,vUv)*.28;
        color+=texture2D(source,vUv-radial)*.20;
        color+=texture2D(source,vUv-radial*2.)*.17;
        color+=texture2D(source,vUv-radial*3.)*.14;
        color+=texture2D(source,vUv-radial*4.)*.11;
        color+=texture2D(source,vUv-radial*5.)*.10;
        gl_FragColor=color;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  private quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
  private pulse = 0;
  private previousSpeed = 0;
  private width = 1;
  private height = 1;
  private resolutionScale = .85;
  constructor() { this.scene.add(this.quad); }
  get strength() { return this.material.uniforms.strength.value as number; }
  update(delta: number, speed: number, burst: boolean, reducedMotion = false, gliding = false) {
    const acceleration = (speed - this.previousSpeed) / Math.max(delta, .001);
    this.previousSpeed = speed;
    if (burst || acceleration > 65) this.pulse = .24;
    this.pulse = Math.max(0, this.pulse - delta);
    this.material.uniforms.strength.value = reducedMotion ? 0 : Math.max(.018 * Math.sin(Math.PI * this.pulse / .24), gliding ? THREE.MathUtils.clamp((speed - 15) / 85, 0, 1) * .008 : 0);
  }
  resize(width: number, height: number) {
    this.width = Math.max(1, Math.round(width)); this.height = Math.max(1, Math.round(height));
    this.target.setSize(Math.max(1, Math.round(this.width * this.resolutionScale)), Math.max(1, Math.round(this.height * this.resolutionScale)));
  }
  setResolutionScale(scale: number) {
    const next = Number.isFinite(scale) ? THREE.MathUtils.clamp(scale, .5, 1) : .85;
    if (next === this.resolutionScale) return;
    this.resolutionScale = next;
    this.resize(this.width, this.height);
  }
  get targetSize() { return { width: this.target.width, height: this.target.height }; }
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const previousTarget = renderer.getRenderTarget();
    // Idle renders once at native canvas resolution: no offscreen copy or resampling.
    if (this.strength < .0001) { renderer.render(scene, camera); return; }
    // Three renders linear HDR into the target without tone mapping. The final
    // shader applies the same tone mapping and output conversion as direct render.
    // The atmosphere includes both chunks, so the sky follows this same color path.
    try {
      renderer.setRenderTarget(this.target); renderer.render(scene, camera);
      renderer.setRenderTarget(previousTarget); renderer.render(this.scene, this.camera);
    } finally { renderer.setRenderTarget(previousTarget); }
  }
  dispose() { this.target.dispose(); this.quad.geometry.dispose(); this.material.dispose(); }
}
