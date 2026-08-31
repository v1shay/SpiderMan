import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { applySuitRestPose, normalizeSuit, suitAnimationClips, prepareMaterials } from '../lib/three-assets.ts';
import { SUITS } from '../lib/game-config.ts';
import { AvatarAnimator } from '../lib/avatar-animation.ts';
import { IronManRepulsors } from '../lib/ironman-repulsors.ts';
const renderer=new THREE.WebGLRenderer({antialias:true}); renderer.setSize(innerWidth,640); renderer.setPixelRatio(1); document.body.append(renderer.domElement);
renderer.setScissorTest(true); renderer.outputColorSpace=THREE.SRGBColorSpace;
const source=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('/assets/suits/ironman-mua.glb');
const suit={...SUITS.find(s=>s.id==='ironman'),model:'/assets/suits/ironman-mua.glb'}, clips=suitAnimationClips(source.animations,suit);
let page=0, animated=false, runtime=false, views=[];
const scenarios=[
 {pose:'hover',grounded:false,seconds:1.4}, {pose:'hover',grounded:false,seconds:1.5,prelude:'hover'},
 {pose:'fly',grounded:false,speed:52,seconds:1.5,prelude:'hover'}, {pose:'fly',grounded:false,speed:72,boost:true,seconds:.8,prelude:'fly'},
 {pose:'fall',grounded:false,seconds:1.2,prelude:'fly'}, {pose:'hover',grounded:false,seconds:.8,prelude:'fall'},
 {pose:'idle',grounded:true,seconds:.55,prelude:'fall'}, {pose:'idle',grounded:true,lobby:true,seconds:2},
];
function show(){views=[]; document.querySelector('#labels').replaceChildren();
 for(let row=0;row<4;row++){const clip=clips[page*4+row], scenario=scenarios[(page%2)*4+row]; if(!clip)break;
  for(let col=0;col<4;col++){const scene=new THREE.Scene();scene.background=new THREE.Color('#172530');scene.add(new THREE.HemisphereLight(0xffffff,0x899fb0,3));const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(3,5,6);scene.add(key);
   const root=clone(source.scene);applySuitRestPose(root,suit,clips);normalizeSuit(root,suit,2.05);prepareMaterials(root,renderer,'character');root.rotation.y+=Math.PI;scene.add(root);
   let mixer,action,caption;
   if(runtime){const holder=new THREE.Group();holder.add(root);scene.add(holder);const actor=new AvatarAnimator(root,suit,clips);const effects=new IronManRepulsors(holder,actor.bones);const step=(motion,seconds)=>{for(let t=0;t<seconds;t+=1/60){actor.update(Math.min(1/60,seconds-t),motion);holder.rotation.x=motion.pose==='fly'?1.1*actor.cruiseBlend:0;holder.position.y=motion.grounded?0:.45;effects.update(['fly','hover'].includes(motion.pose),motion.speed??0,motion.boost??false,t)}};
    step({pose:'idle',grounded:true},3);
    if(scenario.prelude)step({pose:scenario.prelude,grounded:false,speed:scenario.prelude==='fly'?52:0},2);
    step(scenario,Math.max(1/60,scenario.seconds*col/3));
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
