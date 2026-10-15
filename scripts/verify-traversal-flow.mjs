import assert from 'node:assert/strict';
import { createTraversalState, stepTraversalInPlace, acceptTraversalWallContact } from '../lib/traversal-physics.ts';
import { ADVANCED_TRAVERSAL_CONFIG as config } from '../lib/traversal-advanced.ts';
import { FLOW, flowReleaseVelocity, flowWallVelocity } from '../lib/traversal-flow.ts';
import { ContextualAnimationGraph } from '../lib/contextual-animation.ts';
import * as THREE from 'three';
const v=(x=0,y=0,z=0)=>({x,y,z}), f=v(0,0,-1), dt=1/120;
const empty={groundY:-10000}, size=p=>Math.hypot(p.x,p.y,p.z);
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);
const step=(s,input={},env=empty,c=config,h=dt)=>stepTraversalInPlace(s,input,env,h,c);
let checks=0;const test=(name,fn)=>{fn();checks++;console.log('PASS '+name);};

test('production config enables flow for every suit override',()=>{
 assert.equal(config.flowTraversal,true);
 for(const steer of [10,15,27,72]){
  const s=createTraversalState(v(0,35),v(0,-6,-35));
  for(let i=0;i<120;i++)step(s,{swingHeld:true,cameraForward:i<20?f:v(-.7071,0,-.7071)},
   {...empty,anchorCandidates:[{id:'right',point:v(25,80,-20)}]},{...config,swingSteerAcceleration:steer});
  assert.ok(s.position.x < -9,`low steering style still turns: ${steer} ${s.position.x}`);
  assert.ok(s.velocity.x < -15);
 }
});
test('side anchors retain street direction and a real dip/rise before handoff',()=>{
 for(const side of [-1,1]){
  const s=createTraversalState(v(0,25),v(0,-6,-30));const point=v(side*25,65);
  let lowest=25, rising=false,handoffs=0;
  for(let i=0;i<300;i++){
   const result=step(s,{swingHeld:true,cameraForward:f},{...empty,anchorCandidates:[{id:'facade',point}]});
   if(s.swing)assert.deepEqual(s.swing.visualAnchor,point);
   lowest=Math.min(lowest,s.position.y);rising ||= s.velocity.y>12;
   handoffs+=result.events.filter(e=>e.reason==='arc-handoff').length;
   assert.ok(Math.abs(s.position.x)<.1);assert.ok(s.velocity.z< -18,'never reverse into a passive pendulum');
  }
  assert.ok(lowest<24);assert.ok(rising);assert.equal(handoffs,1);assert.ok(s.position.z< -65);
 }
});
test('a normal release retains descent while Space adds a bounded swing jump',()=>{
 const input=v(0,-12,-40);
 for(const held of [.25,.6,1.2,10]){
  const normal=flowReleaseVelocity(input,held,f,108,false);
  near(normal.y,-12);assert.ok(-normal.z>=40 && -normal.z<43);
  const jump=flowReleaseVelocity(input,held,f,108,true);
  assert.ok(jump.y>normal.y+8);assert.ok(size(jump)<55);
 }
 assert.deepEqual(flowReleaseVelocity(input,.05,f,108,true),input);
});
test('swing-jump input releases once and does not spend a double jump',()=>{
 const s=createTraversalState(v(0,40),v(0,8,-36));s.airSeconds=1;
 s.swing={anchor:v(0,80),ropeLength:40,maximumLength:40,attachedSeconds:1,tension:1,pressure:1};
 const result=step(s,{jumpPressed:true,swingHeld:true,cameraForward:f});
 assert.equal(result.events.filter(e=>e.type==='web-released').length,1);
 assert.equal(result.events.filter(e=>e.type==='double-jump').length,0);
 assert.ok(s.velocity.y>16);assert.equal(s.swingNeedsRelease,true);
});
test('wall W/S and camera-relative A/D honor both wall orientations',()=>{
 for(const nx of [-1,1])for(const camera of [v(-nx,0,0),v(nx,0,0)]){
  const normal=v(nx),right=v(-camera.z,0,camera.x);
  const run=(climb,strafe)=>{let velocity=flowWallVelocity(v(-nx*35,5,-30),normal,camera,climb,strafe,dt,true);
   for(let i=0;i<90;i++)velocity=flowWallVelocity(velocity,normal,camera,climb,strafe,dt);
   return velocity;};
  assert.ok(run(1,0).y>22);assert.ok(run(-1,0).y< -22);
  for(const strafe of [-1,1]){const out=run(0,strafe);assert.ok((out.x*right.x+out.z*right.z)*strafe>22);near(out.x,-nx*.8);}
  const diagonal=run(1,1);assert.ok(diagonal.y>16);assert.ok(size(diagonal)<FLOW.wallMaximumSpeed+1);
 }
});
test('wall entry preserves usable momentum without a deferred speed refund',()=>{
 const s=createTraversalState(v(.462,40),v(-50,30,-70));s.wallApproach='swing';s.wallApproachUntil=10;
 assert.ok(acceptTraversalWallContact(s,{point:v(0,40),normal:v(1),feetTouching:true},s.velocity,{cameraForward:v(-1)},config));
 assert.ok(size(s.velocity)>40);assert.equal(s.wallCarrySpeed,0);
});
test('ordinary swinging cannot automatically take control to perform a loop',()=>{
 const s=createTraversalState(v(0,50),v(0,0,-100));
 s.swing={anchor:v(0,80),ropeLength:30,maximumLength:30,attachedSeconds:.3,tension:1,pressure:1};
 step(s,{swingHeld:true,cameraForward:f});assert.equal(s.advanced.loop,null);
});
test('releases choose varied complete flips only with clearance and airtime',()=>{
 const names=['Swinging','Backflip','Front Flip','Front Twist Flip','Running Forward Flip','Run To Flip','Butterfly Twirl','Aerial Evade','Corkscrew Evade','Big Jump','Falling'];
 const graph=new ContextualAnimationGraph(names.map(name=>new THREE.AnimationClip('mixamo:'+name,1,[])));
 const chosen=new Set();
 for(let i=0;i<10;i++){
  graph.select(.2,{pose:'swing',mode:'swing',grounded:false,speed:36,tension:1,timeToLanding:2,trickClearance:true});
  const selection=graph.select(.2,{pose:'jump',mode:'jump',grounded:false,speed:40,verticalSpeed:22,timeToLanding:2,trickClearance:true});
  if(selection)chosen.add(selection.clip.name);
 }
 assert.ok(chosen.size>=4,`varied flips: ${[...chosen].join(', ')}`);
 const unsafe=new ContextualAnimationGraph(names.map(name=>new THREE.AnimationClip('mixamo:'+name,1,[])));
 unsafe.select(.2,{pose:'swing',grounded:false,speed:35,timeToLanding:.3,trickClearance:false});
 const selection=unsafe.select(.2,{pose:'fall',grounded:false,speed:35,timeToLanding:.3,trickClearance:false});
 assert.ok(!selection||!/[Ff]lip|Twirl|Evade/.test(selection.clip.name));
});
test('30/60/120 Hz use identical substeps for a steered swing',()=>{
 const run=hz=>{const s=createTraversalState(v(0,50),v(0,-8,-32));
  for(let i=0;i<hz;i++)step(s,{swingHeld:true,cameraForward:f,move:v(-.5,0,-.866)},
   {...empty,anchorCandidates:[{id:'real',point:v(25,90,-20)}]},config,1/hz);return s;};
 const baseline=run(120);for(const hz of [30,60]){const s=run(hz);for(const axis of ['x','y','z']){near(s.position[axis],baseline.position[axis]);near(s.velocity[axis],baseline.velocity[axis]);}}
});
console.log(`${checks} flow regression checks passed. Run verify-camera-swing.mjs for swept facade avoidance and verify-integrated-swing.mjs for all GLB maps.`);
