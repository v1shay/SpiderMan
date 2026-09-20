import * as THREE from 'three';
export const SKY_PRESETS = {
  clear: {
    label: 'Clear blue',
    top: '#367bd0',
    horizon: '#d1e8f5',
    fog: '#b4d2e7',
    clouds: 0.16,
  },
  golden: {
    label: 'Golden hour',
    top: '#6b89a3',
    horizon: '#ecc493',
    fog: '#caa986',
    clouds: 0.45,
  },
  dawn: {
    label: 'Rose dawn',
    top: '#6876ae',
    horizon: '#ffc6b2',
    fog: '#c5b1c8',
    clouds: 0.32,
  },
  overcast: {
    label: 'Overcast',
    top: '#8495a7',
    horizon: '#d4dee5',
    fog: '#b4c3d0',
    clouds: 0.88,
  },
  snow: {
    label: 'Snowfall',
    top: '#96bbdc',
    horizon: '#e3eff7',
    fog: '#c1d9e9',
    clouds: 0.65,
  },
  blizzard: {
    label: 'Snowstorm',
    top: '#7d9aae',
    horizon: '#d7e6ed',
    fog: '#aec9da',
    clouds: 1,
  },
} as const;
export type SkyPreset = keyof typeof SKY_PRESETS;
export const isSnowSky = (sky: SkyPreset) =>
  sky === 'snow' || sky === 'blizzard';

/** Shared uniforms keep full-detail and distant source buildings in the same weather. */
export class CityWeather {
  readonly snow = { value: 0 };
  readonly tint = { value: new THREE.Color('white') };
  private readonly flakes: THREE.Points;
  private readonly uniforms = {
    time: { value: 0 },
    center: { value: new THREE.Vector3() },
    strength: { value: 0 },
    storm: { value: 0 },
    pixelRatio: { value: 1 },
  };
  constructor(scene: THREE.Scene) {
    const p = new Float32Array(3000 * 3);
    let seed = 1999;
    for (let i = 0; i < p.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      p[i] = seed / 4294967296;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: `uniform float time,strength,storm,pixelRatio;uniform vec3 center;varying float alpha;
       void main(){vec3 p=position*vec3(220.,140.,220.);p.x=mod(p.x+time*(2.+storm*9.),220.)-110.;p.z=mod(p.z+sin(time*.15+position.x*20.)*4.,220.)-110.;p.y=mod(p.y-time*(3.+position.z*3.+storm*5.),140.)-50.;vec4 mv=modelViewMatrix*vec4(p+center,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp((90.+position.z*120.)/max(1.,-mv.z),1.5,6.)*pixelRatio;alpha=strength*(1.-smoothstep(65.,110.,length(p.xz)));}`,
      fragmentShader:
        `varying float alpha;void main(){float r=length(gl_PointCoord-.5);float a=(1.-smoothstep(.12,.5,r))*alpha;if(a<.02)discard;gl_FragColor=vec4(.91,.96,1.,a);#include <tonemapping_fragment>\n#include <colorspace_fragment>
}`.replace(';#include', ';\n#include'),
    });
    this.flakes = new THREE.Points(geometry, material);
    this.flakes.frustumCulled = false;
    this.flakes.visible = false;
    scene.add(this.flakes);
  }
  setDensity(fraction: number) { this.flakes.geometry.setDrawRange(0, Math.round(3000 * THREE.MathUtils.clamp(fraction, .2, 1))); }
  apply(root: THREE.Object3D) {
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.userData.cityWeather) return;
        m.userData.cityWeather = true;
        m.onBeforeCompile = (
          shader: THREE.WebGLProgramParametersWithUniforms,
        ) => {
          shader.uniforms.citySnow = this.snow;
          shader.uniforms.cityTint = this.tint;
          shader.vertexShader =
            'varying vec3 snowWorldNormal;varying vec3 snowWorldPosition;\n' +
            shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
        vec3 snowN=normal;vec4 snowP=vec4(position,1.);
        #ifdef USE_INSTANCING
        snowN=mat3(instanceMatrix)*snowN;snowP=instanceMatrix*snowP;
        #endif
        snowWorldNormal=normalize(mat3(modelMatrix)*snowN);snowWorldPosition=(modelMatrix*snowP).xyz;`,
          );
          shader.fragmentShader =
            'uniform float citySnow;uniform vec3 cityTint;varying vec3 snowWorldNormal;varying vec3 snowWorldPosition;\n' +
            shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <color_fragment>',
            `#include <color_fragment>
       float grain=fract(sin(dot(floor(snowWorldPosition.xz*7.),vec2(12.9898,78.233)))*43758.5453);
       float cover=smoothstep(.48,.83,normalize(snowWorldNormal).y)*citySnow;
       diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.83,.91,.97)*( .93+grain*.07),cover)*cityTint;`,
          );
        };
        m.customProgramCacheKey = () => 'city-weather-v1';
        m.needsUpdate = true;
      }
    });
  }
  update(
    time: number,
    center: THREE.Vector3,
    sky: SkyPreset,
    night: boolean,
    delta: number,
  ) {
    this.snow.value = THREE.MathUtils.damp(
      this.snow.value,
      isSnowSky(sky) ? 1 : 0,
      2,
      delta,
    );
    const target = new THREE.Color(
      night ? '#4d628c' : isSnowSky(sky) ? '#d8e8f5' : '#ffffff',
    );
    this.tint.value.lerp(target, 1 - Math.exp(-delta * 2));
    this.uniforms.time.value = time;
    this.uniforms.center.value.copy(center);
    this.uniforms.strength.value =
      this.snow.value * (sky === 'blizzard' ? 0.9 : 0.6);
    this.uniforms.storm.value = sky === 'blizzard' ? 1 : 0;
    this.flakes.visible = this.snow.value > 0.01;
  }
  dispose() {
    this.flakes.removeFromParent();
    this.flakes.geometry.dispose();
    (this.flakes.material as THREE.Material).dispose();
  }
}
