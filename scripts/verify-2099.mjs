import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';
import {getSuit, DISTRICTS, SUITS} from '../lib/game-config.ts';
import {retargetMixamoClips, normalizeSuit} from '../lib/three-assets.ts';
import {AvatarAnimator} from '../lib/avatar-animation.ts';
import {ContextualAnimationGraph} from '../lib/contextual-animation.ts';
import {createTraversalState,stepTraversal,acceptTraversalWallContact} from '../lib/traversal-physics.ts';
import {TraversalSpeedBlur,constrainCameraBoom} from '../lib/traversal-camera.ts';
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(parser=>{parser.loadTextureImage=()=>Promise.resolve(new THREE.Texture());return {name:'CPUTextureStub'};});
async function load(url){const b=await fs.readFile(`public${url}`);return loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
const suit=getSuit('miguel');const [model,pack]=await Promise.all([load(suit.model),load(suit.animationSource)]);
const clips=retargetMixamoClips(pack.animations,pack.scene,model.scene);
assert.equal(clips.length,59);assert.equal(SUITS.length,1);assert.equal(DISTRICTS.length,1);
const root=clone(model.scene);normalizeSuit(root,suit,2.05);const actor=new THREE.Group();actor.add(root);actor.updateMatrixWorld(true);
const mixer=new THREE.AnimationMixer(root), inventory=[];
let samples=0;
for(const clip of clips){
 assert.ok(clip.duration>0);assert.equal(clip.tracks.length,65);
 for(const track of clip.tracks){assert.ok(track.name.endsWith('.quaternion'));assert.ok(root.getObjectByName(track.name.slice(0,-11)));assert.ok([...track.values].every(Number.isFinite));}
 const action=mixer.clipAction(clip).reset().play();let maximumSpan=0;
 for(let i=0;i<=30;i++){
  action.time=clip.duration*i/30;mixer.update(0);actor.updateMatrixWorld(true);
  const box=new THREE.Box3();root.traverse(object=>{assert.ok([...object.quaternion].every(Number.isFinite));assert.ok(Math.abs(object.quaternion.lengthSq()-1)<1e-4);if(object.isMesh){const attr=object.geometry.getAttribute('position');for(let k=0;k<attr.count;k+=13){const v=object.getVertexPosition(k,new THREE.Vector3()).applyMatrix4(object.matrixWorld);assert.ok([...v].every(Number.isFinite));box.expandByPoint(v);}}});
  const span=box.getSize(new THREE.Vector3()).length();maximumSpan=Math.max(maximumSpan,span);assert.ok(span<4.7,`${clip.name}: exploded skinned silhouette ${span}`);samples++;
 }
 inventory.push({clip:clip.name,duration:+clip.duration.toFixed(3),tracks:clip.tracks.length,samples:31,maxSkinnedSpan:+maximumSpan.toFixed(3)});action.stop();
}
// Replay stability, safety gates and variation use the actual imported pack.
function replay(){const g=new ContextualAnimationGraph(clips);const selected=[];for(let i=0;i<18;i++){g.select(.1,{pose:'idle',grounded:true});for(let j=0;j<120;j++){const out=g.select(1/60,{pose:'jump',mode:j<45?'doubleJump':'fall',grounded:false,speed:20,verticalSpeed:10-j/5,timeToLanding:2.5-j/60,trickClearance:true,actionSequence:i});if(j===0)selected.push(out.clip.name);}}return selected;}
assert.deepEqual(replay(),replay());assert.ok(new Set(replay()).size>=4);
for(const time of [0,.05,.2,.5,.8]){const g=new ContextualAnimationGraph(clips);g.select(.1,{pose:'idle',grounded:true});const out=g.select(.02,{pose:'jump',mode:'doubleJump',grounded:false,speed:24,timeToLanding:time,trickClearance:true});assert.ok(!/Backflip|Front Flip|Twist|Twirl/.test(out.clip.name),'No rotation fits a near landing');}
const graph=new ContextualAnimationGraph(clips);const swings=[];
for(let i=0;i<12;i++){graph.select(.2,{pose:'fall',grounded:false});graph.select(.1,{pose:'swing',grounded:false});swings.push(graph.select(.3,{pose:'swing',grounded:false,verticalSpeed:i%2?12:-12}).clip.name);}
assert.equal(new Set(swings).size,3);assert.ok(swings.every((name,i)=>!i||name!==swings[i-1]));
// Entire landing/roll animations stay above the supporting plane after skinning.
const animRoot=clone(model.scene);normalizeSuit(animRoot,suit,2.05);const holder=new THREE.Group();holder.add(animRoot);const animator=new AvatarAnimator(animRoot,suit,clips);
for(const mode of ['roll','land']){
 animator.update(.02,{pose:'fall',grounded:false,timeToLanding:1});
 for(let i=0;i<90;i++){animator.update(1/120,{pose:'idle',mode,grounded:true,speed:mode==='roll'?14:0});holder.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(animRoot,true);assert.ok(box.min.y>-.035,`${mode} skin underground ${box.min.y} at ${i}, ${animator.activeClip}, ${animator.supportMode}, contact ${animator.contactError}, root ${animRoot.position.y}`);}
}
const v=(x=0,y=0,z=0)=>({x,y,z});const contact={point:v(0,8),normal:v(1,0),feetTouching:true};
const state=createTraversalState(v(.462,8),v(-22,5,27));state.elapsed=1;
assert.ok(acceptTraversalWallContact(state,contact,state.velocity,{}));assert.equal(state.wallRunActive,true);assert.equal(state.velocity.z,27);assert.ok(state.velocity.x>=0);
const jumped=stepTraversal(state,{jumpPressed:true},{groundY:-100,wallContact:contact},1/120).state;
assert.ok(jumped.velocity.z>26.5);assert.ok(jumped.velocity.x>10);assert.equal(jumped.wallRunActive,false);
const slow=createTraversalState(v(.462,8),v(-3,-1,1));assert.ok(acceptTraversalWallContact(slow,contact,slow.velocity,{}));assert.equal(slow.wallCrawlActive,true);
const departing=createTraversalState(v(.462,8),v(12,12,0));assert.equal(acceptTraversalWallContact(departing,contact,departing.velocity,{}),false);
const fake=createTraversalState(v(.462,8),v(-22,0));assert.equal(acceptTraversalWallContact(fake,{...contact,feetTouching:false},fake.velocity,{}),false);
const jumping=createTraversalState(v(0,10),v(20,-4));jumping.airSeconds=.3;
let result=stepTraversal(jumping,{jumpPressed:true},{groundY:-100},1/120);assert.equal(result.state.airJumps,1);assert.ok(result.events.some(e=>e.type==='double-jump'));assert.ok(result.state.velocity.x>19.9);
result=stepTraversal(result.state,{jumpPressed:true},{groundY:-100},1/120);assert.ok(!result.events.some(e=>e.type==='double-jump'));
const blur=new TraversalSpeedBlur();blur.update(.016,30,true);assert.ok(blur.strength>0);for(let i=0;i<60;i++)blur.update(1/60,30,false);assert.equal(blur.strength,0);blur.update(.016,40,true,true);assert.equal(blur.strength,0);blur.dispose();
const camera=constrainCameraBoom(new THREE.Vector3(),new THREE.Vector3(0,0,8),(origin,direction,max)=>max>3?{distance:3}:null);assert.ok(camera.z<=2.701);
const report={passed:true,sourceClips:58,generatedClips:1,skinnedPoseSamples:samples,animationVariety:replay(),swingVariety:swings,checks:['all bindings','finite quaternions and skin','bounded silhouettes','no root translation','grounded roll and landing clearance','deterministic graph','landing-time trick rejection','three nonrepeating swings','fast wall run','slow wall crawl','momentum wall jump','outbound no latch','feet contact required','one double jump','blur pulse decay','near-plane camera boom'],inventory};
await fs.mkdir('docs/verification',{recursive:true});await fs.writeFile('docs/verification/2099-report.json',JSON.stringify(report,null,2)+'\n');console.log(`PASS: ${clips.length} clips, ${samples} skinned pose samples, contextual replay/variety, ground contact, wall transition/jump, double jump, camera and blur.`);
