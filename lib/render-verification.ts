import * as THREE from 'three';
import { TraversalSpeedBlur } from './traversal-camera';

/** Opt-in development GPU check. Uses the actual renderer and blur color pipeline. */
export function verifyBlurColors(renderer:THREE.WebGLRenderer) {
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.01,10);
  camera.position.z=2;
  const uniform={value:new THREE.Color()};
  const material=new THREE.ShaderMaterial({uniforms:{color:uniform},vertexShader:'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'uniform vec3 color;void main(){gl_FragColor=vec4(color,1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'});
  const geometry=new THREE.PlaneGeometry(2,2),mesh=new THREE.Mesh(geometry,material);scene.add(mesh);
  const blur=new TraversalSpeedBlur(),size=renderer.getDrawingBufferSize(new THREE.Vector2());blur.resize(size.x,size.y);
  const pixel=new Uint8Array(4),gl=renderer.getContext();
  const sample=()=>{gl.readPixels(Math.floor(size.x/2),Math.floor(size.y/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);return Array.from(pixel).slice(0,3);};
  const samples=[];
  try {
    for(const color of ['#6b89a3','#ecc493','#96bbdc','#18283e','#808080']) {
      uniform.value.set(color);blur.update(.1,0,false,true);blur.render(renderer,scene,camera);const clear=sample();
      blur.update(.016,70,true);blur.render(renderer,scene,camera);const active=sample();
      const maximumDifference=Math.max(...clear.map((value,index)=>Math.abs(value-active[index])));
      samples.push({color,clear,active,maximumDifference});
    }
    return {passed:samples.every(s=>s.maximumDifference<=2),samples};
  } finally {blur.dispose();geometry.dispose();material.dispose();}
}
