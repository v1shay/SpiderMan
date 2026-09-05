import * as THREE from 'three';

/** Golden-hour haze and cool city night, in linear light throughout. */
export function createCityAtmosphere(scene: THREE.Scene) {
  const u = { time: { value: 0 }, night: { value: 0 },
    dayTop: { value: new THREE.Color('#6b89a3') }, dayHorizon: { value: new THREE.Color('#ecc493') },
    nightTop: { value: new THREE.Color('#050b24') }, nightHorizon: { value: new THREE.Color('#584062') } };
  const material = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: u,
    vertexShader: 'varying vec3 vDirection;void main(){vDirection=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec3 vDirection;uniform float time,night;uniform vec3 dayTop,dayHorizon,nightTop,nightHorizon;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
      float fbm(vec2 p){float f=0.,a=.5;for(int i=0;i<5;i++){f+=a*noise(p);p=p*2.03+vec2(13.1,7.3);a*=.5;}return f;}
      void main(){vec3 d=normalize(vDirection);float h=smoothstep(-.14,.38,d.y);
        vec3 sky=mix(mix(dayHorizon,nightHorizon,night),mix(dayTop,nightTop,night),h);
        vec3 sunDir=normalize(vec3(-.62,.12,-.77));float sun=max(0.,dot(d,sunDir));
        sky+=vec3(1.,.52,.18)*pow(sun,18.)*.34*(1.-night);
        sky+=vec3(3.,2.2,1.3)*smoothstep(.9995,.99985,sun)*(1.-night);
        vec2 uv=vec2(atan(d.z,d.x),d.y/max(.2,d.y+.3));
        float c=smoothstep(.49,.7,fbm(uv*vec2(4.,8.)+vec2(time*.0008,0.)));
        c*=smoothstep(.02,.22,d.y)*(1.-smoothstep(.86,.99,d.y));
        sky=mix(sky,mix(vec3(.87,.72,.55),vec3(.06,.08,.16),night),c*.58);
        float stars=pow(hash(floor(uv*900.)),1300.)*smoothstep(.12,.6,d.y)*night;
        sky+=vec3(.55,.7,1.)*stars*.8;
        gl_FragColor=vec4(sky,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(8500,24,16),material);mesh.renderOrder=-100;mesh.frustumCulled=false;scene.add(mesh);
  const dayFog=new THREE.Color('#caa986'),nightFog=new THREE.Color('#242d50');
  return { update(elapsed:number,position:THREE.Vector3,night:boolean,delta:number){u.time.value=elapsed;u.night.value=THREE.MathUtils.damp(u.night.value,night?1:0,2,delta);mesh.position.copy(position);if(scene.fog)scene.fog.color.copy(dayFog).lerp(nightFog,u.night.value);},get night(){return u.night.value;} };
}
