import assert from 'node:assert/strict';
import {createTraversalState,stepTraversal,acceptTraversalWallContact} from '../lib/traversal-physics.ts';
import {swingPreset,swingProfileConfig} from '../lib/swing-profile.ts';
import {readController,defaultControllerSettings} from '../lib/controller.ts';
const v=(x=0,y=0,z=0)=>({x,y,z});const config=swingProfileConfig(swingPreset());
const environment={groundY:0,anchorCandidates:[{id:'front-building',point:v(12,60,-35),kind:'facade'},{id:'back-building',point:v(12,60,35),kind:'facade'}]};
const air=()=>{const s=createTraversalState(v(0,25,0));s.velocity=v(0,-4,-30);s.airSeconds=.5;return s;};
let s=air();let out=stepTraversal(s,{jumpPressed:true,move:v(0,0,1),cameraForward:v(0,0,-1)},environment,1/120,config);
assert.ok(out.state.zip?.airDash && out.state.zip.contextual);assert.equal(out.state.zip.targetId,'back-building');assert.ok(out.state.velocity.z>20,'stick zip must support deliberate U-turn');
s=out.state;for(let i=0;i<6;i++)s=stepTraversal(s,{zipHeld:false},environment,1/120,config).state;
assert.ok(s.zip,'one press completes the short zip without holding a separate button');
for(let i=0;i<45;i++)s=stepTraversal(s,{},environment,1/120,config).state;
assert.equal(s.zip,null);assert.ok(Math.hypot(s.velocity.x,s.velocity.y,s.velocity.z)<=config.maximumSpeed);
const noAnchor=stepTraversal(air(),{jumpPressed:true},{groundY:0},1/120,config);assert.equal(noAnchor.state.zip,null);assert.ok(!noAnchor.events.some(e=>e.type==='double-jump'),'empty sky cannot supply a zip');
const blocked=stepTraversal(air(),{jumpPressed:true},{...environment,hasLineOfSight:()=>false},1/120,config);assert.equal(blocked.state.zip,null);
assert.ok(stepTraversal(air(),{jumpPressed:true},{groundY:0},1/120,{...config,traversalAirZip:0}).events.some(e=>e.type==='double-jump'));
function swinging(y){const s=air();s.velocity=v(0,y,-30);s.swing={anchor:v(12,60,-35),anchorId:'front-building',ropeLength:48,maximumLength:48,attachedSeconds:1.3,tension:.5,pressure:1};return s;}
const low=stepTraversal(swinging(0),{jumpPressed:true,swingHeld:true},environment,1/120,config);const high=stepTraversal(swinging(18),{jumpPressed:true,swingHeld:true},environment,1/120,config);
assert.ok(Math.abs(low.state.velocity.z)>Math.abs(high.state.velocity.z),'low release earns forward speed');assert.ok(high.state.velocity.y-low.state.velocity.y>20,'upswing release earns height');assert.equal(low.state.swing,null);
s=low.state;let attached=false;for(let i=0;i<100;i++){const r=stepTraversal(s,{swingHeld:true,cameraForward:v(0,0,-1)},environment,1/120,config);s=r.state;attached ||= r.events.some(e=>e.type==='web-attached');}
assert.ok(attached,'held trigger catches the next web after a jump');
const wall=air();wall.swing=swinging(0).swing;assert.ok(acceptTraversalWallContact(wall,{point:v(0,25,-1),normal:v(0,0,1),feetTouching:true},v(0,10,-50),{swingHeld:true,cameraForward:v(0,0,-1)},config));assert.ok(Math.hypot(wall.velocity.x,wall.velocity.y,wall.velocity.z)>35,'facade entry must retain incoming momentum');
const over=stepTraversal(wall,{jumpPressed:true,roofExitDirection:v(0,0,-1),cameraForward:v(0,0,-1)},{groundY:0,wallContact:wall.wall},1/120,config);assert.ok(over.state.velocity.z< -20,'pre-probed roof jump goes over the building');assert.ok(over.state.velocity.y>0);
const vault=air();vault.position=v(0,2,0);vault.velocity=v();vault.mantle={target:v(0,2,0),elapsed:0,lowObstacle:true,exitVelocity:v(0,2,-11)};const flowed=stepTraversal(vault,{}, {groundY:0},1/120,config);assert.ok(flowed.state.velocity.z< -10 && !flowed.state.mantle,'vault completion keeps movement');
const pad=buttons=>({buttons:Array.from({length:18},(_,i)=>({pressed:buttons.includes(i),value:buttons.includes(i)?1:0})),axes:[0,0,0,0]});assert.ok(readController(pad([6]),defaultControllerSettings()).held.has('aim'));assert.ok(readController(pad([10]),defaultControllerSettings()).held.has('dive'));
console.log('PASS contextual geometry-backed air zip, U-turn, one-press lifetime, release timing, held-trigger reattachment, facade momentum, roof launch, parkour flow, aim and L3 dive');
