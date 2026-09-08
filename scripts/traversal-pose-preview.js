import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';
import {normalizeSuit,retargetMixamoClips} from '/lib/three-assets.ts';
import {getSuit} from '/lib/game-config.ts';
import {supportLegacyMaterials,calibrate2099Materials} from '/lib/gltf-materials.ts';
import {AvatarAnimator} from '/lib/avatar-animation.ts';
import {TraversalTetherVisual} from '/lib/traversal-extras-visual.ts';
const loader=supportLegacyMaterials(new GLTFLoader()),suit=getSuit('miguel');
const [model,pack]=await Promise.all([loader.loadAsync(suit.model),loader.loadAsync(suit.animationSource)]);
const clips=retargetMixamoClips(pack.animations,pack.scene,model.scene),cells=[];
for(const [mode,label] of [['glide','Flying / deployed wings'],['slingshot','Slingshot / hand webs'],['doubleJump','Double jump / full flip']]){
 const el=document.createElement('section');el.innerHTML=`<h2>${label}</h2>`;document.querySelector('main').append(el);
 const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(1);renderer.setSize(el.clientWidth,el.clientHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;el.append(renderer.domElement);
 const scene=new THREE.Scene();scene.background=new THREE.Color('#0b2033');scene.add(new THREE.HemisphereLight(0xc8eaff,0x526480,2.5));const light=new THREE.DirectionalLight(0xfff3e8,3);light.position.set(3,5,-3);scene.add(light);
 const root=clone(model.scene);normalizeSuit(root,suit,2.05);calibrate2099Materials(root);const actor=new THREE.Group();actor.add(root);scene.add(actor);
 const camera=new THREE.PerspectiveCamera(38,el.clientWidth/el.clientHeight,.01,100);camera.position.set(2,2,-5);camera.lookAt(0,1,0);
 scene.add(new THREE.GridHelper(10,20,0x35677c,0x16354a));
 const animator=new AvatarAnimator(root,suit,clips),webs=new TraversalTetherVisual(scene);
 cells.push({mode,renderer,scene,root,actor,camera,animator,webs});
}
let playing=true,back=false,charge=1,time=0,previous=performance.now();
document.querySelector('#play').onclick=()=>{playing=!playing;document.querySelector('#play').textContent=playing?'Pause':'Play';};
document.querySelector('#reverse').onclick=()=>{back=!back;for(const c of cells){c.camera.position.set(back?-2:2,2,back?5:-5);c.camera.lookAt(0,1,0);}};
document.querySelector('#charge').oninput=e=>{charge=Number(e.target.value)/100;};
function tick(now){requestAnimationFrame(tick);const dt=Math.min(.025,(now-previous)/1000);previous=now;if(playing)time+=dt;
 for(const c of cells){
  if(playing){
   const cycle=time%2.4;const flip=c.mode==='doubleJump';
   c.animator.update(dt,{pose:c.mode==='glide'?'fly':flip?'jump':'perch',mode:flip?(cycle<.1?'idle':cycle<.9?'doubleJump':'fall'):c.mode,grounded:flip?cycle<.1:c.mode==='slingshot',speed:flip?0:35,verticalSpeed:flip?10:0,timeToLanding:1.2,trickClearance:true,charge,actionSequence:Math.floor(time/2.4)});
   c.actor.updateMatrixWorld(true);
   const hands=['leftHand','rightHand'].map(role=>c.animator.bones.find(b=>b.role===role).bone.getWorldPosition(new THREE.Vector3()));
   c.webs.update(hands,c.mode==='slingshot'?{sling:{anchors:[{x:-3,y:2,z:-3},{x:3,y:2,z:-3}]}}:undefined);
  }
  c.renderer.render(c.scene,c.camera);
 }
 document.querySelector('#report').textContent=cells.map(c=>c.animator.activeClip).join(' · ');
}requestAnimationFrame(tick);
