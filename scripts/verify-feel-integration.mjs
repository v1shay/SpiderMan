import assert from 'node:assert/strict';
import { createTraversalState, stepTraversalInPlace, acceptTraversalWallContact,
  runTraversalPhysicsSelfTests, DEFAULT_TRAVERSAL_CONFIG } from '../lib/traversal-physics.ts';
import { SPIDER_TRAVERSAL_FEEL } from '../lib/traversal-feel.ts';
const v=(x=0,y=0,z=0)=>({x,y,z});
const speed=a=>Math.hypot(a.x,a.y,a.z);
const dt=1/120;
const feel={...SPIDER_TRAVERSAL_FEEL, zipMaximumSpeed:88};
const forward=v(0,0,-1);
const empty={groundY:-10000};
const near=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const checks=[];
function test(name,fn){fn();checks.push(name);console.log('PASS',name);}
const step=(s,input,environment=empty,seconds=dt,config=feel)=>stepTraversalInPlace(s,input,environment,seconds,config);
const makeWallRun=()=>{
  const state=createTraversalState(v(1.54,10,0),v(32,-8,-20));
  const contact={point:v(2,10.18,0),normal:v(-1,0,0),feetTouching:true,colliderId:'test-wall'};
  state.wallApproach='swing';state.wallApproachUntil=10;
  assert.equal(acceptTraversalWallContact(state,contact,{...state.velocity},{cameraForward:forward},feel),true);
  return {state,contact};
};
const wallEnvironment=contact=>({...empty,wallContact:contact,
  colliders:[{id:'test-wall',min:v(2,-100,-1000),max:v(3,500,1000)}]});

test('all 12 original built-in contracts remain green in legacy mode',()=>{
  const r=runTraversalPhysicsSelfTests();assert.ok(r.passed,JSON.stringify(r));
});
test('arcade attachment uses the real fixed anchor from the first tick',()=>{
  const state=createTraversalState(v(0,20),v(0,0,-25));
  const anchor={point:v(20,55,-10),kind:'facade'};
  for(let i=0;i<45;i++){
    step(state,{swingHeld:true,cameraForward:forward},{...empty,anchorCandidates:[anchor]});
    assert.ok(state.swing);assert.deepEqual(state.swing.pivot,anchor.point);assert.equal(state.swing.captureStart,undefined);
  }
});
test('zero-duration release does not grant a free impulse',()=>{
  const s=createTraversalState(v(0,20),v(0,-5,-30));
  s.swing={anchor:v(0,50),ropeLength:30,maximumLength:30,attachedSeconds:0,pressure:1,tension:1};
  step(s,{swingReleased:true,swingHeld:false},empty,dt,{...feel,gravity:0,airAcceleration:0});
  assert.deepEqual(s.velocity,v(0,-5,-30));
});
function releaseTrial(heldSeconds){
  const s=createTraversalState(v(0,20),v(0,-5,-30));
  s.swing={anchor:v(0,60),pivot:v(0,60),ropeLength:40,maximumLength:40,attachedSeconds:heldSeconds,pressure:1,tension:1};
  step(s,{swingReleased:true,swingHeld:false,cameraForward:forward});
  const releaseVelocity={...s.velocity};
  let peak=s.position.y, horizontalDistance=0;
  for(let i=0;i<900;i++){
    const old={...s.position};step(s,{cameraForward:forward});
    peak=Math.max(peak,s.position.y);horizontalDistance+=Math.hypot(s.position.x-old.x,s.position.z-old.z);
    if(s.position.y<=20&&s.velocity.y<0) break;
  }
  return {releaseVelocity,peak,horizontalDistance};
}
let shortRelease,longRelease;
test('charged release produces greater measured apex and range from the same state',()=>{
  shortRelease=releaseTrial(.25);longRelease=releaseTrial(1.2);
  assert.ok(longRelease.peak>shortRelease.peak+15);
  assert.ok(longRelease.horizontalDistance>shortRelease.horizontalDistance+35);
});
test('full held-swing simulation, not just the release helper, rewards a longer hold',()=>{
  const run=seconds=>{
    const s=createTraversalState(v(0,25),v(0,-5,-25));
    const a={point:v(20,65,-25),kind:'facade'};
    for(let i=0;i<Math.round(seconds/dt);i++) step(s,{swingHeld:true,cameraForward:forward,move:forward},{...empty,anchorCandidates:[a]});
    assert.ok(s.swing,'swing detached unexpectedly');
    step(s,{swingReleased:true,swingHeld:false,cameraForward:forward});
    let peak=s.position.y;
    for(let i=0;i<480;i++){step(s,{cameraForward:forward});peak=Math.max(peak,s.position.y);}
    return peak;
  };
  assert.ok(run(1.2)>run(.25)+10);
});
test('wall run retains speed and gains height instead of timing out into a crawl',()=>{
  const {state,contact}=makeWallRun(); const initialSpeed=speed(state.velocity),height=state.position.y;
  for(let i=0;i<300;i++){
    step(state,{swingHeld:true,cameraForward:forward},wallEnvironment(contact));
    assert.equal(state.mode,'wallRun');assert.ok(state.position.x<=1.54+1e-6);
  }
  assert.ok(state.position.y>=height+14.9);assert.ok(speed(state.velocity)>=initialSpeed*.995);
  near(state.wall.contactSeconds,2.5,1e-6);
});
test('release exits a run without zeroing speed or downward-launching the player',()=>{
  const {state,contact}=makeWallRun();
  for(let i=0;i<120;i++)step(state,{swingHeld:true,cameraForward:forward},wallEnvironment(contact));
  const incoming=speed(state.velocity),height=state.position.y;
  step(state,{swingReleased:true,swingHeld:false,cameraForward:forward},wallEnvironment(contact));
  assert.equal(state.wallRunActive,false);assert.notEqual(state.mode,'wallRun');assert.ok(state.velocity.x<0);
  assert.ok(state.position.y>=height);assert.ok(state.velocity.y>0);assert.ok(speed(state.velocity)>=incoming*.995);
});
test('a brief missing probe preserves an existing run but does not suspend gravity',()=>{
  const {state,contact}=makeWallRun();
  for(let i=0;i<30;i++)step(state,{swingHeld:true},wallEnvironment(contact));
  const up=state.velocity.y;
  // No collider or sampled contact during the deliberately missing interval.
  for(let i=0;i<5;i++)step(state,{swingHeld:true},{...empty,wallContact:null});
  assert.equal(state.mode,'wallRun');assert.ok(state.velocity.y<up);assert.equal(state.wall.feetTouching,false);
  step(state,{swingHeld:true},wallEnvironment(contact));assert.equal(state.mode,'wallRun');
});
test('walking off a real edge expires grace and cannot run forever in empty air',()=>{
  const {state}=makeWallRun();
  for(let i=0;i<36;i++)step(state,{swingHeld:true},{...empty,wallContact:null});
  assert.equal(state.wallRunActive,false);assert.equal(state.wall,null);assert.ok(state.velocity.y<0);
});
test('crawl still requires current foot contact, not run grace',()=>{
  const {state}=makeWallRun();state.wallRunActive=false;state.wallCrawlActive=true;delete state.wall.runEntrySpeed;
  step(state,{},{...empty,wallContact:null});assert.equal(state.wallCrawlActive,false);
});
let airZipResult;
test('RMB-style air zip is forward-only and retains exit momentum',()=>{
  const s=createTraversalState(v(0,25),v(0,0,-25));
  const candidate={point:v(0,80,-80),kind:'facade'};
  let peak=s.position.y,finishedAt=null,finishSpeed=null,zipCount=0;
  for(let i=0;i<80;i++){
    const r=step(s,{zipPressed:i===0,zipHeld:true,zipStyle:'air',cameraForward:forward,aimDirection:v(0,.8,-1)},
      {...empty,zipTargets:[candidate]});
    zipCount+=r.events.filter(e=>e.type==='zip-started').length;
    peak=Math.max(peak,s.position.y);
    if(!s.zip&&finishedAt===null){finishedAt=(i+1)*dt;finishSpeed=speed(s.velocity);}
  }
  assert.equal(zipCount,1);assert.ok(finishedAt>=.28&&finishedAt<.3);assert.ok(peak<=25+1e-7);
  assert.ok(finishSpeed>80);assert.ok(speed(s.velocity)>80);assert.ok(-s.position.z>35);
  airZipResult={finishedAt,finishSpeed,finalSpeed:speed(s.velocity),distance:-s.position.z,peak};
});
test('air zip reaching a target cannot trigger the point-grapple speed reset',()=>{
  const s=createTraversalState(v(0,25),v(0,0,-40));
  const candidate={point:v(0,25,-8),kind:'perch'};
  for(let i=0;i<36;i++)step(s,{zipPressed:i===0,zipHeld:true,zipStyle:'air',cameraForward:forward}, {...empty,zipTargets:[candidate]});
  assert.ok(-s.velocity.z>80);assert.equal(s.perchSeconds,0);
});
test('point grapple on E still keeps its separate target-arrival behavior',()=>{
  const s=createTraversalState(v(0,25),v(0,0,-25));const a={point:v(0,27,-20),kind:'facade'};
  let started=false;
  for(let i=0;i<360;i++){
    step(s,{zipPressed:i===0,zipHeld:true,zipStyle:'point',cameraForward:forward},{...empty,zipTargets:[a]});
    if(i===0){assert.ok(s.zip&&!s.zip.airDash);started=true;}
    if(started&&!s.zip)break;
  }
  assert.equal(s.zip,null);
});
test('30, 60 and 120 Hz pure solver calls agree over a held swing',()=>{
  const run=hz=>{
    const s=createTraversalState(v(0,25),v(0,-5,-25));const a={point:v(20,65,-25),kind:'facade'};
    for(let i=0;i<hz;i++)step(s,{swingHeld:true,cameraForward:forward,move:forward},{...empty,anchorCandidates:[a]},1/hz);
    return s;
  };
  const a=run(120);
  for(const hz of [30,60]){const b=run(hz);for(const axis of ['x','y','z']){near(a.position[axis],b.position[axis]);near(a.velocity[axis],b.velocity[axis]);}}
});
test('high-speed thin facade remains collision-solid with arcade mode enabled',()=>{
  const s=createTraversalState(v(0,25),v(90,0,0));
  const wall={id:'thin',min:v(2,0,-500),max:v(2.01,100,500)};
  for(let i=0;i<60;i++){
    step(s,{cameraForward:v(0,0,-1)},{...empty,colliders:[wall]});
    assert.ok(s.position.x<=wall.min.x-DEFAULT_TRAVERSAL_CONFIG.playerRadius+1e-6);
    assert.ok(speed(s.velocity)<=cap()+1e-6);
  }
});
function cap(){return feel.maximumSpeed;}
console.log(`\n${checks.length} solver integration checks passed.`);
console.log(JSON.stringify({sameStateRelease:{short:shortRelease,long:longRelease},airZip:airZipResult},null,2));
console.log('These checks execute the actual renderer-independent traversal solver. They do not render the GLB or exercise SpiderGame mesh/BVH integration.');
