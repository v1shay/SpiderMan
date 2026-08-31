import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { applySuitRestPose, normalizeSuit, suitAnimationClips, prepareMaterials } from '../lib/three-assets.ts';
import { SUITS } from '../lib/game-config.ts';
import { AvatarAnimator } from '../lib/avatar-animation.ts';
const renderer=new THREE.WebGLRenderer({antialias:true}); renderer.setSize(innerWidth,640); renderer.setPixelRatio(1); document.body.append(renderer.domElement);
renderer.setScissorTest(true); renderer.outputColorSpace=THREE.SRGBColorSpace;
const source=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('/assets/suits/pavitr.glb');
const suit=SUITS.find(s=>s.id==='pavitr'), clips=suitAnimationClips(source.animations,suit);
let page=0, animated=false, runtime=false, views=[];
const scenarios=[
 {pose:'perch',grounded:true,seconds:2.5}, {pose:'jump',grounded:false,seconds:1.3},
 {pose:'swing',grounded:false,tension:.9,seconds:1.8}, {pose:'release',grounded:false,seconds:1.1},
 {pose:'zip',grounded:false,seconds:.6}, {pose:'fall',grounded:false,seconds:1},
 {pose:'dive',grounded:false,seconds:.8}, {pose:'landing',grounded:true,seconds:.68},
];
function show(){views=[]; document.querySelector('#labels').replaceChildren();
 for(let row=0;row<4;row++){const clip=clips[page*4+row], scenario=scenarios[(page%2)*4+row]; if(!clip)break;
  for(let col=0;col<4;col++){const scene=new THREE.Scene();scene.background=new THREE.Color('#172530');scene.add(new THREE.HemisphereLight(0xffffff,0x899fb0,3));const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(3,5,6);scene.add(key);
   const root=clone(source.scene);applySuitRestPose(root,suit,clips);normalizeSuit(root,suit,2.05);prepareMaterials(root,renderer,'character');root.rotation.y+=Math.PI;scene.add(root);
   let mixer,action,caption;
   if(runtime){const actor=new AvatarAnimator(root,suit,clips);const step=(motion,seconds)=>{for(let t=0;t<seconds;t+=1/60)actor.update(Math.min(1/60,seconds-t),motion)};
    if(scenario.pose!=='perch')step({pose:'idle',grounded:true},3);
    if(scenario.pose==='release')step({pose:'swing',grounded:false,tension:.9},1);
    if(scenario.pose==='landing')step({pose:'fall',grounded:false},1);
    step({...scenario,pose:scenario.pose==='release'?'jump':scenario.pose==='landing'?'perch':scenario.pose},Math.max(1/60,scenario.seconds*col/3));
    caption=actor.activeClip.replace(/^.*Pavitr_/,'');mixer=actor.mixer;action=mixer.existingAction(actor.clips.find(c=>c.name===actor.activeClip));
   }else{mixer=new THREE.AnimationMixer(root);action=mixer.clipAction(clip).setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();mixer.update(clip.duration*col/3);caption=clip.name.replace(/^.*Pavitr_/,'')}
   const camera=new THREE.PerspectiveCamera(40,(innerWidth/4)/160,.01,100);camera.position.set(0,1.2,4.8);camera.lookAt(0,1,0);
   const floor=new THREE.Mesh(new THREE.PlaneGeometry(6,6),new THREE.MeshStandardMaterial({color:'#486070',side:THREE.DoubleSide}));floor.rotation.x=-Math.PI/2;floor.position.y=-.05;scene.add(floor);
   views.push({scene,camera,mixer,action,row,col});const label=document.createElement('div');label.textContent=caption+' '+Math.round(col/3*100)+'%';document.querySelector('#labels').append(label);
  }
 } document.querySelector('output').value=`Clips ${page*4+1}–${Math.min(page*4+4,clips.length)} of ${clips.length}`;
}
document.querySelector('#runtime').onclick=()=>{runtime=!runtime;animated=false;page=0;show()};
document.querySelector('#next').onclick=()=>{page=(page+1)%(runtime?2:Math.ceil(clips.length/4));show()};document.querySelector('#previous').onclick=()=>{page=(page+Math.ceil(clips.length/4)-1)%Math.ceil(clips.length/4);show()};document.querySelector('#animate').onclick=()=>{if(runtime)return;animated=!animated;for(const v of views){v.action.reset().setLoop(THREE.LoopRepeat,Infinity).play()}};
show(); let last=performance.now();function tick(t){requestAnimationFrame(tick);const dt=Math.min((t-last)/1000,.05);last=t;for(const v of views){if(animated)v.mixer.update(dt);const width=innerWidth/4;renderer.setViewport(v.col*width,(3-v.row)*160,width,160);renderer.setScissor(v.col*width,(3-v.row)*160,width,160);renderer.render(v.scene,v.camera)}}requestAnimationFrame(tick);
