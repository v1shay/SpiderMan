import * as THREE from 'three';
import { SKY_PRESETS, type SkyPreset } from './city-weather';

/** Direction-space noise has no longitude wrap, texture edge, or skybox seam. */
export function createCityAtmosphere(scene: THREE.Scene) {
  const u = {
    time: { value: 0 },
    night: { value: 0 },
    clouds: { value: 0.45 },
    top: { value: new THREE.Color('#6b89a3') },
    horizon: { value: new THREE.Color('#ecc493') },
  };
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: u,
    vertexShader:
      'varying vec3 direction;void main(){direction=position;vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position=p.xyww;}',
    fragmentShader: `varying vec3 direction;uniform float time,night,clouds;uniform vec3 top,horizon;
 float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
 float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+1.),f.x),f.y),f.z);}
 float fbm(vec3 p){float n=0.,a=.5;for(int i=0;i<5;i++){n+=noise(p)*a;p=p*2.03+vec3(13.1,7.3,3.7);a*=.5;}return n;}
 void main(){vec3 d=normalize(direction);float h=smoothstep(-.15,.75,d.y);vec3 sky=mix(mix(horizon,vec3(.025,.04,.085),night),mix(top,vec3(.002,.006,.025),night),h);
 float sun=max(0.,dot(d,normalize(vec3(-.62,.2,-.77))));sky+=vec3(1.,.66,.36)*pow(sun,32.)*.22*(1.-night)*(1.-clouds);
 float cloud=smoothstep(.64-clouds*.3,.78-clouds*.26,fbm(d*7.+vec3(time*.003,0.,time*.001)));cloud*=smoothstep(-.03,.18,d.y);sky=mix(sky,mix(vec3(.78,.84,.9),vec3(.027,.042,.075),night),cloud*.8);
 float stars=pow(hash(floor(d*1100.)),1600.)*smoothstep(.08,.5,d.y)*night*(1.-cloud);sky+=vec3(.6,.75,1.)*stars;
 gl_FragColor=vec4(sky,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), material);
  mesh.scale.setScalar(100);
  mesh.renderOrder = -100;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return {
    update(
      elapsed: number,
      position: THREE.Vector3,
      night: boolean,
      delta: number,
      preset: SkyPreset = 'golden',
    ) {
      const selected = SKY_PRESETS[preset];
      const t = 1 - Math.exp(-delta * 2);
      u.time.value = elapsed;
      u.night.value = THREE.MathUtils.damp(
        u.night.value,
        night ? 1 : 0,
        2,
        delta,
      );
      u.top.value.lerp(new THREE.Color(selected.top), t);
      u.horizon.value.lerp(new THREE.Color(selected.horizon), t);
      u.clouds.value = THREE.MathUtils.lerp(u.clouds.value, selected.clouds, t);
      mesh.position.copy(position);
      if (scene.fog) {
        scene.fog.color.lerp(
          new THREE.Color(selected.fog).lerp(
            new THREE.Color('#18283e'),
            u.night.value,
          ),
          t,
        );
        if (scene.fog instanceof THREE.Fog) {
          scene.fog.near = preset === 'blizzard' ? 100 : 1000;
          scene.fog.far = preset === 'blizzard' ? 1100 : 2600;
        }
      }
    },
    get night() {
      return u.night.value;
    },
  };
}
