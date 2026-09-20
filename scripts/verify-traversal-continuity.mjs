import assert from 'node:assert/strict';
import { createTraversalState, stepTraversalInPlace, resolveSwingContinuation, scoreSwingTrajectory, commitAdvancedMotion } from '../lib/traversal-physics.ts';
import { ADVANCED_TRAVERSAL_CONFIG as config } from '../lib/traversal-advanced.ts';
import { resolveTraversalAssists } from '../lib/traversal-assist-budget.ts';
const v=(x=0,y=0,z=0)=>({x,y,z}), dt=1/120, forward=v(0,0,-1);
const empty={groundY:-10000};
const near=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
let checks=0;
const test=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
const step=(s,input={},env=empty)=>stepTraversalInPlace(s,{cameraForward:forward,...input},env,dt,config);
const attached=()=>{const s=createTraversalState(v(0,50),v(0,0,-40));s.swing={anchor:v(0,80),visualAnchor:v(0,80),simulationPivot:v(0,80),ropeLength:30,maximumLength:30,attachedSeconds:.3,tension:1,pressure:1};return s;};
const metrics={};
test('swing starts on the first pressed simulation frame',()=>{
 const s=createTraversalState(v(0,100),v(0,-10,-40));
 const r=step(s,{swingPressed:true,swingHeld:true},{...empty,anchorCandidates:[{id:'facade',point:v(20,140,-25)}]});
 assert.ok(s.swing);assert.equal(r.events.filter(e=>e.type==='web-attached').length,1);
});
test('ordinary hold pressure cannot shorten a deep arc',()=>{
 for(const pressure of [0,.5,1]){
  const s=createTraversalState(v(0,100),v(0,-10,-40));
  const env={...empty,anchorCandidates:[{id:'facade',point:v(20,140,-25)}]};
  let initial;
  for(let i=0;i<240;i++){step(s,{swingHeld:true,pointerPressure:pressure},env);assert.ok(s.swing);initial??=s.swing.ropeLength;near(s.swing.ropeLength,initial);}
  metrics.ordinaryHold={seconds:2,length:initial,shrinkPercent:0};
 }
});
test('explicit reel still changes radius',()=>{
 const s=attached();const start=s.swing.ropeLength;for(let i=0;i<60;i++)step(s,{swingHeld:true,reel:-1});assert.ok(s.swing.ropeLength<start-4);
});
test('open-street attachment survives 15 seconds with no unexplained releases',()=>{
 const s=attached();let released=0;
 for(let i=0;i<1800;i++){const r=step(s,{swingHeld:true});released+=r.events.filter(e=>e.type==='web-released').length;assert.ok(s.swing);}
 assert.equal(released,0);metrics.openStreet={seconds:15,unintendedDetachments:released};
});
test('a brief obstruction preserves the line and never creates release energy',()=>{
 const s=attached(), speed=Math.hypot(...Object.values(s.velocity));
 const r=resolveSwingContinuation(s,{obstruction:{point:v(0,49,-3)},dt});
 assert.equal(r,'grace');assert.ok(s.swing);near(Math.hypot(...Object.values(s.velocity)),speed);
 assert.equal(resolveSwingContinuation(s,{}),'clear');near(s.swing.obstructionSeconds,0);
});
test('valid geometry corners keep the endpoint on the real surface',()=>{
 const s=attached(), point=v(8,65,-4), velocity={...s.velocity}, events=[];
 assert.equal(resolveSwingContinuation(s,{obstruction:{point,normal:v(-1)},hasLineOfSight:()=>true,dt},{swingHeld:true},config,events),'corner');
 assert.deepEqual(s.swing.visualAnchor,point);assert.deepEqual(s.swing.anchor,point);assert.deepEqual(s.velocity,velocity);
 const offset=Math.hypot(s.swing.simulationPivot.x-point.x,s.swing.simulationPivot.y-point.y,s.swing.simulationPivot.z-point.z);
 assert.ok(offset>0&&offset<=1.2);assert.equal(events.some(e=>e.type==='web-released'),false);
 for(let i=0;i<60;i++)step(s,{swingHeld:true});
 assert.ok(Math.hypot(s.swing.simulationPivot.x-point.x,s.swing.simulationPivot.y-point.y,s.swing.simulationPivot.z-point.z)<offset*.1);
});
test('small solid-rope disagreements borrow slack instead of detaching',()=>{
 const s=attached();s.swing.ropeLength=29.6;
 assert.equal(resolveSwingContinuation(s,{constraintBlocked:true}, {},config),'slack');near(s.swing.ropeLength,30);
});
test('a real alternative is selected before a failed line is released',()=>{
 const s=attached();const result=resolveSwingContinuation(s,{obstruction:{point:v(0,40,-2)},candidates:[{id:'new-surface',point:v(12,85,-30)}],hasLineOfSight:()=>true},{cameraForward:forward},config);
 assert.equal(result,'reattach');assert.equal(s.swing.anchorId,'new-surface');
});
test('unrecoverable obstruction times out with an explicit reason, no release boost',()=>{
 const s=attached(), events=[];
 for(let i=0;i<35&&s.swing;i++)resolveSwingContinuation(s,{obstruction:{point:v(0,40,-2)},dt},{},config,events);
 assert.equal(s.swing,null);assert.equal(events.length,1);assert.equal(events[0].reason,'no-valid-continuation');assert.equal(events[0].strength,0);
});
test('glancing contact becomes controlled wall movement with retained tangent',()=>{
 const s=attached();s.velocity=v(8,2,-45);
 assert.equal(resolveSwingContinuation(s,{contact:{point:v(.46,50,0),normal:v(-1),feetTouching:true},constraintBlocked:true},{cameraForward:forward,swingHeld:true},config),'wall');
 assert.ok(s.wallRunActive);assert.equal(s.swing,null);assert.ok(s.velocity.z<-15);assert.ok(Math.hypot(...Object.values(s.velocity))<=26.01);
});
test('landing ends a pinning rope while retaining held-input eligibility',()=>{
 const s=attached(),events=[];s.grounded=true;s.velocity=v();
 assert.equal(resolveSwingContinuation(s,{}, {swingHeld:true},config,events),'landed');
 assert.equal(s.swing,null);assert.equal(s.swingNeedsRelease,false);assert.equal(events[0].reason,'ground-contact');
 for(let i=0;i<24;i++)step(s,{swingHeld:true,move:forward},{groundY:50,anchorCandidates:[{id:'higher',point:v(10,90,-15)}]});
 assert.ok(s.swing);assert.ok(Math.hypot(...Object.values(s.velocity))>1);
});
test('a fast street brush stays tethered for a bounded low-swing skim',()=>{
 const s=attached();s.position=v(0,0,0);s.velocity=v(18,0,-26);s.grounded=true;
 const events=[];
 assert.equal(resolveSwingContinuation(s,{dt},{swingHeld:true},config,events),'skim');
 assert.ok(s.swing);assert.equal(s.grounded,false);assert.ok(s.velocity.y>2);
 assert.equal(events.some(e=>e.type==='web-released'),false);
});
test('high descending traversal may catch a visible lower facade, street-level traversal may not',()=>{
 const high=createTraversalState(v(0,60),v(0,-14,-30));
 step(high,{swingPressed:true,swingHeld:true,aimDirection:v(0,-.3,-1)},{groundY:0,anchorCandidates:[{id:'lower',point:v(0,48,-35),kind:'facade'}]});
 assert.equal(high.swing?.anchorId,'lower');
 const low=createTraversalState(v(0,5),v(0,-2,-16));
 step(low,{swingPressed:true,swingHeld:true,aimDirection:v(0,-.3,-1)},{groundY:0,anchorCandidates:[{id:'unsafe-lower',point:v(0,2,-18),kind:'facade'}]});
 assert.equal(low.swing,null);
});
test('wall movement routes sideways under a blocked overhang instead of stalling',()=>{
 const s=createTraversalState(v(0,50),v(0,8,0));
 s.wall={point:v(.46,50),normal:v(-1),feetTouching:true,contactSeconds:1,graceSeconds:.08};s.wallRunActive=true;
 const input={wallClimb:1,cameraForward:forward};
 let maxStall=0,stall=0;
 for(let i=0;i<90;i++){
  const before={...s.position};step(s,input,{...empty,externalCollision:true,wallContact:s.wall});
  // Authoritative vertical ceiling and facade: upward and inward moves are blocked.
  s.position.x=0;s.position.y=50;s.velocity.x=0;s.velocity.y=0;
  commitAdvancedMotion(s,input,config,dt);
  const moved=Math.hypot(s.position.x-before.x,s.position.y-before.y,s.position.z-before.z);
  stall=moved<dt*.8?stall+1:0;maxStall=Math.max(maxStall,stall);
 }
 assert.ok(Math.abs(s.position.z)>2);assert.ok(maxStall<42);
});
test('empty-sky fallback is rejected in ordinary traversal',()=>{
 const s=createTraversalState(v(0,100),v(0,0,-30));step(s,{swingHeld:true},{...empty,anchorCandidates:[{id:'sky-fallback',point:v(0,130,-20)}]});assert.equal(s.swing,null);
});
test('earned dive speed completes a passive full loop without holding a loop button',()=>{
 const s=attached();s.velocity=v(0,0,-75);let completed=0, highestEnergy=0;
 const initialEnergy=.5*75**2+29*s.position.y;
 let previous={y:-1,z:0}, measuredRadians=0;
 for(let i=0;i<720;i++){
  const r=step(s,{swingHeld:true});assert.ok(s.swing);
  const offset={y:s.position.y-80,z:s.position.z},length=Math.hypot(offset.y,offset.z);
  const next={y:offset.y/length,z:offset.z/length};
  measuredRadians+=Math.atan2(previous.y*next.z-previous.z*next.y,previous.y*next.y+previous.z*next.z);previous=next;
  highestEnergy=Math.max(highestEnergy,.5*Math.hypot(...Object.values(s.velocity))**2+29*s.position.y);
  if(r.events.some(e=>e.type==='loop-completed')){completed++;metrics.naturalLoop={seconds:s.elapsed,initialSpeed:75,energyRatio:highestEnergy/initialEnergy,measuredRadians};break;}
 }
 assert.equal(completed,1);assert.ok(measuredRadians>=Math.PI*2);assert.ok(highestEnergy<=initialEnergy*1.005);
});
test('trajectory ranking penalizes a foreseeable building intersection',()=>{
 const position=v(0,30),velocity=v(0,0,-40),candidate={point:v(10,60,-20)};
 const clear=scoreSwingTrajectory(position,velocity,forward,candidate,empty);
 const obstructed=scoreSwingTrajectory(position,velocity,forward,candidate,{...empty,colliders:[{min:v(-10,0,-40),max:v(20,100,-3)}]});
 assert.ok(clear>obstructed+3);
});
test('candidate hysteresis preserves a near-equal previous preference',()=>{
 const s=createTraversalState(v(0,100),v(0,0,-30));s.preferredAnchorId='stable';
 step(s,{swingHeld:true},{...empty,anchorCandidates:[{id:'new',point:v(-10,140,-20)},{id:'stable',point:v(10,140,-20)}]});assert.equal(s.swing.anchorId,'stable');
});
test('collision avoidance owns the first share of the high-assist velocity budget',()=>{
 const result=resolveTraversalAssists([
  {priority:'comfort',deltaVelocity:v(0,0,4)},
  {priority:'steering',deltaVelocity:v(4)},
  {priority:'collision',deltaVelocity:v(0,0,-4)},
  {priority:'ground',deltaVelocity:v(0,.3)},
 ],dt);
 near(result.spent,.7);near(result.applied.collision,.7);near(result.applied.ground,0);near(result.applied.steering,0);near(result.applied.comfort,0);
 assert.ok(Math.hypot(...Object.values(result.deltaVelocity))<=.7+1e-8);
 const s=attached();for(let i=0;i<120;i++){step(s,{swingHeld:true,move:v(1)},{...empty,predictiveAssistAcceleration:v(1000)});assert.ok(s.assistImpulse<=84*dt+1e-8);}
});
console.log(JSON.stringify({passed:true,checks,metrics},null,2));
