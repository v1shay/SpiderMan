import assert from 'node:assert/strict';
import { createTraversalState, stepTraversal, stepTraversalInPlace, acceptTraversalWallContact, refreshTraversalContext, commitAdvancedMotion } from '../lib/traversal-physics.ts';
import { ADVANCED_TRAVERSAL_CONFIG as config, advancedReleaseVelocity, catchVelocity, glideVelocity, loopAngle, aLength, aUnit, aSub, aDot, advancedWindVelocity } from '../lib/traversal-advanced.ts';
import { probeAdvancedWorld } from '../lib/traversal-feature-world.ts';
const v=(x=0,y=0,z=0)=>({x,y,z}), f=v(0,0,-1), dt=1/120;
const empty={groundY:-10000};
const tests=[];
function test(name,run){run();tests.push(name);console.log('PASS '+name);}
const speed=s=>Math.hypot(s.velocity.x,s.velocity.y,s.velocity.z);
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);
const step=(s,i={},e=empty,d=dt,c=config)=>stepTraversalInPlace(s,i,e,d,c);
const stand=()=>{const s=createTraversalState(v());s.grounded=true;return s;};
const pair=[{id:'left',point:v(-15,20,-25),normal:v(1,0,0),kind:'facade',lineOfSight:true},
 {id:'right',point:v(15,20,-25),normal:v(-1,0,0),kind:'facade',lineOfSight:true}];
const slingEnv={groundY:0,slingshotAnchors:pair,hasLineOfSight:()=>true};
const logs={};

test('catch redirects a fast dive without deleting its speed',()=>{
 const before=v(0,-70,-15),radial=aUnit(v(-20,-45,10));
 const after=catchVelocity(before,radial,f,config.maximumSpeed);
 near(aLength(after),aLength(before));near(aDot(after,radial),0);
});
test('release charge remains monotonic for identical incoming state',()=>{
 let lastUp=-Infinity,lastForward=0;
 for(const seconds of [.05,.15,.25,.5,.8,1.2]){
  const out=advancedReleaseVelocity(v(0,-4,-32),seconds,v(0,-1,0),f,108);
  assert.ok(out.y>=lastUp);assert.ok(-out.z>=lastForward);lastUp=out.y;lastForward=-out.z;
 }
});
test('zero/sub-60ms clicks do not add energy',()=>{
 for(const t of [0,.01,.06]) assert.deepEqual(advancedReleaseVelocity(v(2,-30,-40),t,v(0,-1,0),f,108),v(2,-30,-40));
});
test('upswing timing and a capped flow chain earn a bounded bonus',()=>{
 const incoming=v(0,16,-38),radial=aUnit(v(0,-.8,-.6));
 const normal=advancedReleaseVelocity(incoming,1,radial,f,108,0,false);
 const chained=advancedReleaseVelocity(incoming,1,radial,f,108,4,true);
 assert.ok(chained.y>=normal.y);assert.ok(aLength(chained)>aLength(normal));
 assert.ok(aLength(chained)<=108);assert.deepEqual(chained,advancedReleaseVelocity(incoming,1,radial,f,108,900,true));
});
function releaseTrial(hold){
 const s=createTraversalState(v(0,30,0),v(0,-5,-35));
 s.swing={anchor:v(0,60,0),pivot:v(0,60,0),ropeLength:30,maximumLength:30,attachedSeconds:hold,tension:1,pressure:1};
 step(s,{swingReleased:true,swingHeld:false,cameraForward:f},empty,dt,{...config,airAcceleration:0});
 const release={...s.velocity};let peak=s.position.y,frames=0;
 while((s.position.y>=30||s.velocity.y>0)&&frames++<1500){step(s,{},empty,dt,{...config,airAcceleration:0});peak=Math.max(peak,s.position.y);}
 return {release,apexGain:peak-30,range:-s.position.z};
}
test('actual solver: longer charge raises apex and distance',()=>{
 const short=releaseTrial(.25),long=releaseTrial(1.2);logs.releases={short,long};
 assert.ok(long.apexGain>short.apexGain*2);assert.ok(long.range>short.range*1.5);
});
test('Space on a swing releases exactly once, not a release plus double jump',()=>{
 const s=createTraversalState(v(0,30),v(0,4,-35));s.airSeconds=1;
 s.swing={anchor:v(0,60),ropeLength:30,maximumLength:30,attachedSeconds:1,tension:1,pressure:1};
 const r=step(s,{jumpPressed:true,swingHeld:true,cameraForward:f},empty,1/30);
 assert.equal(r.events.filter(e=>e.type==='web-released').length,1);
 assert.equal(r.events.filter(e=>e.type==='double-jump').length,0);assert.equal(s.swing,null);assert.equal(s.swingNeedsRelease,true);
});
test('charged jump needs a real charge and support',()=>{
 const s=createTraversalState(v(0,30));step(s,{chargeJumpReleased:true});assert.ok(s.velocity.y<0);
 const g=stand();step(g,{chargeJumpReleased:true},{groundY:0});assert.equal(g.grounded,true);
});
function jumpTrial(seconds){const s=stand();for(let i=0;i<seconds*120;i++)step(s,{chargeJumpHeld:true},{groundY:0});const r=step(s,{chargeJumpReleased:true},{groundY:0});return {s,r};}
test('C charge scales jump height and emits only one launch',()=>{
 const short=jumpTrial(.1),long=jumpTrial(4);assert.ok(long.s.velocity.y>short.s.velocity.y+15);
 assert.equal(long.r.events.filter(e=>e.type==='jump').length,1);assert.equal(long.s.grounded,false);
 assert.ok(long.s.position.y<1);logs.chargeJumpVelocity=long.s.velocity;
});
test('losing focus cancels charging without firing a jump',()=>{
 const s=stand();for(let i=0;i<50;i++)step(s,{chargeJumpHeld:true},{groundY:0});
 const r=step(s,{chargeJumpReleased:true,cancelAbilities:true},{groundY:0});
 assert.equal(r.events.some(e=>e.type==='jump'),false);assert.equal(s.advanced.chargeJump,0);assert.equal(s.grounded,true);
});
test('slingshot rejects missing or fake dual anchors',()=>{
 for(const env of [{groundY:0},{...slingEnv,slingshotAnchors:[{...pair[0],id:'sky-fallback'},pair[1]]}]){
  const s=stand();for(let i=0;i<150;i++)step(s,{slingshotHeld:true,cameraForward:f},env);
  const r=step(s,{slingshotReleased:true},env);assert.equal(s.advanced.sling,null);assert.equal(s.grounded,true);
  assert.equal(r.events.some(e=>e.type==='slingshot-launch'),false);
 }
});
function chargeSling(){const s=stand();for(let i=0;i<150;i++)step(s,{slingshotHeld:true,cameraForward:f},slingEnv);assert.ok(s.advanced.sling);return s;}
test('slingshot launches once from validated support, without teleporting',()=>{
 const s=chargeSling();const r=step(s,{slingshotReleased:true},slingEnv,1/30);
 assert.equal(r.events.filter(e=>e.type==='slingshot-launch').length,1);assert.ok(speed(s)>95&&s.velocity.y>29);
 assert.ok(Math.hypot(s.position.x,s.position.y,s.position.z)<=108/30+.001);assert.equal(s.grounded,false);
 logs.slingshotVelocity=s.velocity;
});
test('slingshot cancels when either web becomes occluded',()=>{
 const s=chargeSling();const r=step(s,{slingshotReleased:true},{...slingEnv,hasLineOfSight:()=>false});
 assert.equal(s.advanced.sling,null);assert.equal(r.events.some(e=>e.type==='slingshot-launch'),false);assert.equal(s.grounded,true);
});
test('slingshot cannot launch after support is lost',()=>{
 const s=chargeSling();s.grounded=false;s.coyoteSeconds=0;s.position.y=20;
 const r=step(s,{slingshotReleased:true},empty);assert.equal(r.events.some(e=>e.type==='slingshot-launch'),false);assert.equal(s.advanced.sling,null);
});
test('G cannot start flying from the ground',()=>{
 const s=stand();s.velocity=f;step(s,{glidePressed:true},{groundY:0});assert.equal(s.advanced.gliding,false);
});
test('gliding loses total mechanical energy without authored wind',()=>{
 const s=createTraversalState(v(0,300),v(0,-12,-55));step(s,{glidePressed:true,cameraForward:f});
 assert.equal(s.mode,'glide');let e=.5*speed(s)**2+29*s.position.y;
 for(let i=0;i<600;i++){
  step(s,{cameraForward:f,glidePitch:i<300?1:-.5});const next=.5*speed(s)**2+29*s.position.y;
  assert.ok(next<=e+1e-6,`${next} > ${e}`);e=next;
 }
 assert.ok(s.position.y < 300 + (55**2 + 12**2)/(2*29));logs.glideAfterFiveSeconds={position:s.position,velocity:s.velocity};
});
test('repeated G toggles cannot add free energy or stack flight state',()=>{
 const s=createTraversalState(v(0,200),v(0,0,-50));let e=.5*speed(s)**2+29*s.position.y;
 for(let i=0;i<120;i++){
  step(s,{glidePressed:true,cameraForward:f},empty,dt,{...config,airAcceleration:0});
  const n=.5*speed(s)**2+29*s.position.y;assert.ok(n<=e+1e-6);e=n;
 }
});
test('glide stalls rather than gaining unlimited altitude',()=>{
 const s=createTraversalState(v(0,200),v(0,0,-18));let top=200;
 step(s,{glidePressed:true,cameraForward:f});
 for(let i=0;i<1200;i++){step(s,{cameraForward:f,glidePitch:1});top=Math.max(top,s.position.y);}
 assert.ok(top<206);assert.ok(s.position.y<195);
});
test('a fresh swing press interrupts glide and preserves a real anchor',()=>{
 const s=createTraversalState(v(0,60),v(0,-10,-45));step(s,{glidePressed:true,cameraForward:f});
 step(s,{swingHeld:false});
 step(s,{swingPressed:true,swingHeld:true,cameraForward:f},{...empty,anchorCandidates:[{id:'real',point:v(20,95,-20),kind:'facade'}]});
 assert.equal(s.advanced.gliding,false);assert.ok(s.swing);assert.equal(s.swing.anchorId,'real');assert.equal(s.mode,'swing');
});
test('glide ends on ground or authoritative wall contact',()=>{
 const s=createTraversalState(v(0,30),v(0,0,-40));step(s,{glidePressed:true,cameraForward:f});
 s.grounded=true;commitAdvancedMotion(s,{},config);assert.equal(s.advanced.gliding,false);
 s.grounded=false;s.advanced.gliding=true;s.wall={point:v(),normal:v(1),feetTouching:true,graceSeconds:.08,contactSeconds:0};
 commitAdvancedMotion(s,{},config);assert.equal(s.advanced.gliding,false);
});
test('RMB works without an anchor and adds no lift',()=>{
 const s=createTraversalState(v(0,80),v(0,0,-35));const r=step(s,{zipPressed:true,zipStyle:'air',zipHeld:true,cameraForward:f});
 assert.equal(r.events.filter(e=>e.type==='zip-started').length,1);assert.equal(s.zip.targetId,'air-zip-no-anchor');
 for(let i=0;i<35;i++)step(s,{zipHeld:true,cameraForward:f});
 assert.ok(-s.velocity.z>90);assert.ok(s.position.y<=80);assert.equal(s.zip,null);
});
test('air zip cooldown prevents rapid cancel/restart acceleration spam',()=>{
 const s=createTraversalState(v(0,100),v(0,0,-35));let starts=0;
 for(let i=0;i<120;i++){
  starts+=step(s,{zipPressed:i%2===0,zipReleased:i%2===1,zipHeld:i%2===0,zipStyle:'air',cameraForward:f}).events.filter(e=>e.type==='zip-started').length;
 }
 assert.ok(starts<=3);logs.zipStartsPerSecond=starts;
});
test('point launch preserves fast incoming speed; perfect timing is stronger',()=>{
 function launch(remaining){const s=createTraversalState(v(0,50),v(0,0,-80));s.zip={target:v(0,50,-remaining),elapsed:.2,startingDistance:30};step(s,{jumpPressed:true,zipHeld:true,cameraForward:f});return s;}
 const early=launch(4),perfect=launch(1);assert.equal(early.zip,null);assert.equal(perfect.zip,null);
 assert.ok(-early.velocity.z>=80);assert.ok(-perfect.velocity.z>-early.velocity.z);assert.ok(perfect.velocity.y>early.velocity.y);
});
test('early point-launch press is buffered into the arrival window',()=>{
 const s=createTraversalState(v(0,50),v(0,0,-70));s.zip={target:v(0,50,-8),elapsed:.2,startingDistance:40};let launches=0;
 for(let i=0;i<15;i++) launches+=step(s,{jumpPressed:i===0,zipHeld:true,cameraForward:f}).events.filter(e=>e.type==='point-launch').length;
 assert.equal(launches,1);assert.equal(s.zip,null);
});
test('corner assist requires a nearby verified anchor',()=>{
 const s=createTraversalState(v(0,60),v(0,0,-40));step(s,{cornerHeld:true});assert.equal(s.advanced.corner,null);
 step(s,{cornerHeld:true},{...empty,cornerTarget:{anchor:{id:'far',point:v(100,60),lineOfSight:true},direction:v(1)}});
 assert.equal(s.advanced.corner,null);
});
test('corner assist turns velocity rather than warping the capsule',()=>{
 const s=createTraversalState(v(0,60),v(0,0,-40));const env={...empty,hasLineOfSight:()=>true,cornerTarget:{anchor:{id:'corner',point:v(10,61,-3),lineOfSight:true},direction:v(1)}};
 let events=0;
 for(let i=0;i<45;i++){const before={...s.position};events+=step(s,{cornerHeld:true},env).events.filter(e=>e.type==='corner-tether').length;
  assert.ok(aLength(aSub(s.position,before))<=108*dt+.001);}
 assert.equal(events,1);assert.ok(s.velocity.x>38);near(Math.hypot(s.velocity.x,s.velocity.z),40);assert.ok(s.velocity.y<0);
});
test('corner assist aborts if the supporting web becomes occluded',()=>{
 const s=createTraversalState(v(0,60),v(0,0,-40));
 step(s,{cornerHeld:true},{...empty,hasLineOfSight:()=>true,cornerTarget:{anchor:{id:'corner',point:v(10,61,-3)},direction:v(1)}});
 assert.ok(s.advanced.corner);step(s,{cornerHeld:true},{...empty,hasLineOfSight:()=>false});assert.equal(s.advanced.corner,null);
});
test('signed loop measurement counts a full turn, not arbitrary elapsed time',()=>{
 let a=0,prev=v(0,-1,0);
 for(let i=1;i<=120;i++){const t=i/120*Math.PI*2,next=v(0,-Math.cos(t),-Math.sin(t));a+=loopAngle(prev,next,v(1,0,0));prev=next;}
 near(a,Math.PI*2);near(loopAngle(v(0,-1),v(0,-1),v(1)),0);
});
test('loop-de-loop needs dive speed, not just a held L key',()=>{
 const s=createTraversalState(v(0,50),v(0,0,-30));s.swing={anchor:v(0,80),ropeLength:30,maximumLength:30,attachedSeconds:.3,tension:1,pressure:1};
 step(s,{swingHeld:true,loopHeld:true,cameraForward:f});assert.equal(s.advanced.loop,null);
});
test('actual solver can complete a force-driven loop around its fixed anchor',()=>{
 const s=createTraversalState(v(0,50),v(0,0,-70));s.swing={anchor:v(0,80),ropeLength:30,maximumLength:30,attachedSeconds:.3,tension:1,pressure:1};
 s.advanced.diveSpeed=50;s.advanced.diveUntil=10;let completed=0,at=0;
 for(let i=0;i<960;i++){
  const r=step(s,{swingHeld:true,loopHeld:true,cameraForward:f});
  assert.ok(speed(s)<=108+1e-6);assert.ok(s.swing);
  if(r.events.some(e=>e.type==='loop-completed')){completed++;at=s.elapsed;break;}
 }
 assert.equal(completed,1);logs.loopCompletionSeconds=at;
});
test('loop cannot complete after the mesh cancels the web',()=>{
 const s=createTraversalState(v(0,50),v(0,0,-70));s.advanced.loop={axis:v(1),previousRadial:v(0,-1),radians:6.25,seconds:2};
 const events=[];commitAdvancedMotion(s,{loopHeld:true},config,dt,events);assert.equal(s.advanced.loop,null);assert.equal(events.length,0);
});
test('reduced-motion configuration suppresses dynamic camera FOV',()=>{
 const s=createTraversalState(v(0,50),v(0,0,-100));s.advanced.pulse=1;
 const still=refreshTraversalContext(s,{}, {...config,cameraMotionScale:0});const active=refreshTraversalContext(s,{},config);
 near(still.camera.fov,66);assert.ok(active.camera.fov>85);near(still.camera.roll,0);
});
test('active wall run settles to a controllable pace for 2.5 seconds',()=>{
 const s=createTraversalState(v(0,40),v(30,0,-50));const contact={point:v(.46,40),normal:v(-1),feetTouching:true};
 s.wallApproach='swing';s.wallApproachUntil=10;
 acceptTraversalWallContact(s,contact,s.velocity,{cameraForward:f},config);const before=speed(s),start=s.position.y;
 const wall={min:v(.46,0,-1000),max:v(2,300,1000)};
 for(let i=0;i<300;i++)step(s,{swingHeld:true,cameraForward:f},{...empty,wallContact:contact,colliders:[wall]});
 assert.equal(s.mode,'wallRun');assert.ok(s.position.y-start>10);assert.ok(speed(s)<=26 && speed(s)>=18);logs.wallRun={gain:s.position.y-start,entrySpeed:before,exitSpeed:speed(s)};
});
test('30/60/120Hz agree for a glide using identical internal steps',()=>{
 const run=hz=>{const s=createTraversalState(v(0,300),v(0,-12,-50));for(let i=0;i<hz*2;i++)step(s,{glidePressed:i===0,cameraForward:f,glidePitch:.4},empty,1/hz);return s;};
 const baseline=run(120);for(const hz of [30,60]){const s=run(hz);for(const axis of ['x','y','z']){near(s.position[axis],baseline.position[axis]);near(s.velocity[axis],baseline.velocity[axis]);}}
});
test('immutable stepping does not mutate prior advanced state',()=>{
 const s=createTraversalState(v(0,40),v(0,0,-40));s.advanced.corner={anchor:v(10,41),direction:v(1),seconds:.1};const copy=JSON.stringify(s);
 stepTraversal(s,{cornerHeld:true},{...empty,hasLineOfSight:()=>true},dt,config);assert.equal(JSON.stringify(s),copy);
});
test('high-speed glide and air-zip remain solid against a thin wall',()=>{
 const wall={id:'thin',min:v(-100,0,-5.01),max:v(100,200,-5)};
 for(const action of [{glidePressed:true},{zipPressed:true,zipStyle:'air',zipHeld:true}]){
  const s=createTraversalState(v(0,50),v(0,0,-100));
  for(let i=0;i<80;i++){
   step(s,{cameraForward:f,...(i===0?action:{}),zipHeld:true},{...empty,colliders:[wall]});
   assert.ok(s.position.z>=-5+.46-1e-6);assert.ok(speed(s)<=108+1e-6);
  }
 }
});
test('geometry probes do not fabricate slingshot or corner anchors in empty space',()=>{
 const world={raycast:()=>null,sweepCapsule:(a,b)=>({position:b,blocked:false,grounded:false})};
 assert.deepEqual(probeAdvancedWorld(world,v(),v(0,0,-40),f,true,1),{slingshotAnchors:null,cornerTarget:null});
});
test('20,000 generated catch/release/glide cases stay finite and speed-bounded',()=>{
 let seed=12345;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
 for(let i=0;i<20000;i++){
  const x=v((random()-.5)*180,(random()-.5)*180,(random()-.5)*180),n=aUnit(v(random()-.5,random()-.5,random()-.5));
  for(const out of [catchVelocity(x,n,f,108),advancedReleaseVelocity(x,random()*2,n,f,108,random()*5),glideVelocity(x,f,random()*2-1,dt,29,108)]){
   assert.ok(Object.values(out).every(Number.isFinite));assert.ok(aLength(out)<=108+1e-6);
  }
 }
});

test('losing focus releases a charged web without a bonus launch',()=>{
 const s=createTraversalState(v(0,50),v(0,-10,-40));
 s.swing={anchor:v(0,80),ropeLength:30,maximumLength:30,attachedSeconds:1.2,tension:1,pressure:1};
 const result=step(s,{cancelAbilities:true,swingReleased:true,swingHeld:false},empty,dt,{...config,airAcceleration:0});
 assert.equal(s.swing,null);near(s.velocity.y,-10-29*dt);near(s.velocity.z,-40);
 assert.equal(result.events.filter(e=>e.type==='web-released').length,1);
 assert.equal(result.events.find(e=>e.type==='web-released').strength,0);
});
test('authored wind carries fast forward speed instead of braking to 35',()=>{
 const before=v(0,0,-100),out=advancedWindVelocity(before,f,0,1,dt,108);
 assert.ok(-out.z>=100);assert.ok(out.y>0);assert.ok(aLength(out)<=108);
 const slow=advancedWindVelocity(v(0,0,-40),f,0,1,dt,108);assert.ok(-slow.z>40);
});
test('zero-weight or zero-time wind has no effect below the speed cap',()=>{
 const before=v(5,-12,-70);assert.deepEqual(advancedWindVelocity(before,f,0,0,dt,108),before);
 assert.deepEqual(advancedWindVelocity(before,f,0,1,0,108),before);
});
// Infinite facade planes are synthetic geometry, not real-map verification.
const corridorWorld={
 raycast(origin,direction,maximum){
  let best=null;
  for(const x of [-12,12]){
   if(Math.abs(direction.x)<1e-8)continue;
   const t=(x-origin.x)/direction.x;
   if(t<=0||t>maximum||(best&&t>=best.distance))continue;
   best={point:v(x,origin.y+direction.y*t,origin.z+direction.z*t),
    normal:v(x<0?1:-1),distance:t,triangleIndex:x<0?1:2};
  }
  return best;
 },
 sweepCapsule:(a,b)=>({position:{...b},blocked:false,grounded:false}),
};
test('geometry query finds two distinct visible forward slingshot facades',()=>{
 const query=probeAdvancedWorld(corridorWorld,v(),v(),f,true,0);
 assert.ok(query.slingshotAnchors);assert.notEqual(query.slingshotAnchors[0].id,query.slingshotAnchors[1].id);
 assert.ok(query.slingshotAnchors[0].point.x*query.slingshotAnchors[1].point.x<0);
 const s=stand();step(s,{slingshotHeld:true,cameraForward:f},{groundY:0,...query});assert.ok(s.advanced.sling);
});
test('corner query requires a clear swept turn and rejects a blocking corridor',()=>{
 const clear=probeAdvancedWorld(corridorWorld,v(0,40),v(0,0,-40),f,false,1);
 assert.ok(clear.cornerTarget);
 const blocked={...corridorWorld,sweepCapsule:(a)=>({position:{...a},blocked:true,grounded:false})};
 assert.equal(probeAdvancedWorld(blocked,v(0,40),v(0,0,-40),f,false,1).cornerTarget,null);
});


test('actual held swing: 0.25, 0.6 and 1.2 seconds gain progressively more altitude and range',()=>{
 function run(hold){
  const s=createTraversalState(v(0,40),v(0,-5,-35));
  const env={...empty,anchorCandidates:[{id:'fixed-test-anchor',point:v(16,80,-25),kind:'facade'}]};
  let peak=40;
  for(let i=0;i<Math.round(hold*120);i++){
   step(s,{swingHeld:true,cameraForward:f,move:f},env);peak=Math.max(peak,s.position.y);assert.ok(s.swing);
  }
  step(s,{swingReleased:true,swingHeld:false,cameraForward:f},env);
  const release={position:{...s.position},velocity:{...s.velocity}};
  for(let i=0;i<1200;i++){
   step(s,{},env);peak=Math.max(peak,s.position.y);
   if(s.velocity.y<0&&s.position.y<40)break;
  }
  return {holdSeconds:hold,apexAboveStartingHeight:peak-40,forwardDistance:-s.position.z,release};
 }
 logs.heldSwingTrials=[.25,.6,1.2].map(run);
 for(let i=1;i<logs.heldSwingTrials.length;i++){
  assert.ok(logs.heldSwingTrials[i].apexAboveStartingHeight>logs.heldSwingTrials[i-1].apexAboveStartingHeight);
  assert.ok(logs.heldSwingTrials[i].forwardDistance>logs.heldSwingTrials[i-1].forwardDistance);
 }
});


test('A/D world movement steers the glide without adding thrust',()=>{
 for(const side of [-1,1]){
  const s=createTraversalState(v(0,300),v(0,-4,-50));const initial=.5*speed(s)**2+29*s.position.y;
  for(let i=0;i<60;i++)step(s,{glidePressed:i===0,cameraForward:f,move:v(side,0,0)});
  assert.ok(s.velocity.x*side>10);assert.ok(.5*speed(s)**2+29*s.position.y<initial);
 }
});

console.log(`\n${tests.length} advanced checks passed.`);console.log(JSON.stringify(logs,null,2));
console.log('Scope: actual renderer-independent solver plus analytic/synthetic geometry queries. Not a WebGL/GLB playtest.');
