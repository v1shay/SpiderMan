import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';
import {normalizeSuit,retargetMixamoClips,prepareMaterials} from '/lib/three-assets.ts';
import {getSuit} from '/lib/game-config.ts';
import {supportLegacyMaterials,calibrate2099Materials} from '/lib/gltf-materials.ts';
const loader=supportLegacyMaterials(new GLTFLoader()).setMeshoptDecoder(MeshoptDecoder);
const suit=getSuit('miguel');
const [model,pack]=await Promise.all([loader.loadAsync(suit.model),loader.loadAsync(suit.animationSource)]);
const clips=retargetMixamoClips(pack.animations,pack.scene,model.scene);
const grid=document.querySelector('#grid'), cells=[];
for(let i=0;i<12;i++){
 const cell=document.createElement('div');cell.className='cell';const label=document.createElement('div');label.className='label';cell.append(label);grid.append(cell);
 const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(1);renderer.setSize(cell.clientWidth,cell.clientHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;cell.append(renderer.domElement);
 const scene=new THREE.Scene();scene.background=new THREE.Color('#091827');scene.add(new THREE.HemisphereLight('#e1f4ff','#405c78',2.5));const light=new THREE.DirectionalLight('#fff4eb',3);light.position.set(3,5,4);scene.add(light);
 const root=clone(model.scene);normalizeSuit(root,suit,2.05);prepareMaterials(root,renderer,'character');calibrate2099Materials(root);scene.add(root);
 const camera=new THREE.PerspectiveCamera(38,cell.clientWidth/cell.clientHeight,.01,100);camera.position.set(3.3,2.2,-5);camera.lookAt(0,1.15,0);
 const floor=new THREE.GridHelper(6,12,'#28607a','#163448');scene.add(floor);
 const mixer=new THREE.AnimationMixer(root);cells.push({cell,label,renderer,scene,camera,root,mixer,action:null});
}
for(const c of cells){c.renderer.setSize(c.cell.clientWidth,c.cell.clientHeight,false);c.camera.aspect=c.cell.clientWidth/c.cell.clientHeight;c.camera.updateProjectionMatrix();}
let focus=-1,back=false;
clips.forEach((clip,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=clip.name.slice(7);document.querySelector('#focus').append(option)});
document.querySelector('#focus').onchange=e=>{focus=e.target.value==='all'?-1:Number(e.target.value);show()};
document.querySelector('#view').onclick=()=>{back=!back;show()};
let page=0,phase=.4,playing=false,last=performance.now();
function show(){
 grid.style.gridTemplateColumns=focus<0?'repeat(4,1fr)':'1fr';grid.style.gridTemplateRows=focus<0?'repeat(3,1fr)':'1fr';
 cells.forEach((c,i)=>{c.cell.style.display=focus<0||i===0?'block':'none';});
 cells.forEach(c=>{c.renderer.domElement.style.width='100%';c.renderer.domElement.style.height='100%';if(c.cell.clientWidth){c.renderer.setSize(c.cell.clientWidth,c.cell.clientHeight,false);c.camera.aspect=c.cell.clientWidth/c.cell.clientHeight;c.camera.position.set(back?-1.4:1.4,1.4,back?3.5:-3.5);c.camera.lookAt(0,1.05,0);c.camera.updateProjectionMatrix();}});
 document.querySelector('#page').textContent=`${page+1} / ${Math.ceil(clips.length/12)}`;
 cells.forEach((c,i)=>{c.mixer.stopAllAction();const clip=clips[focus<0?page*12+i:focus];c.root.visible=!!clip;c.label.textContent=clip?`${page*12+i+1}. ${clip.name.slice(7)} · ${clip.duration.toFixed(2)}s`:'';c.action=clip?c.mixer.clipAction(clip).reset().play():null;if(c.action){c.action.time=phase*clip.duration;c.mixer.update(0);}c.renderer.render(c.scene,c.camera);});
 document.querySelector('#report').textContent=`${clips.length} / 59 bound to original 2099 rig`;
}
document.querySelector('#next').onclick=()=>{page=(page+1)%Math.ceil(clips.length/12);show();};document.querySelector('#previous').onclick=()=>{page=(page+Math.ceil(clips.length/12)-1)%Math.ceil(clips.length/12);show();};
document.querySelector('#phase').oninput=e=>{phase=Number(e.target.value)/100;show();};document.querySelector('#play').onclick=()=>{playing=!playing;document.querySelector('#play').textContent=playing?'Pause':'Play all';};
show();function tick(time){requestAnimationFrame(tick);const dt=Math.min(.05,(time-last)/1000);last=time;if(playing)for(const c of cells){c.mixer.update(dt);c.renderer.render(c.scene,c.camera);}}requestAnimationFrame(tick);
