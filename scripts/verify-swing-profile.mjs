import assert from 'node:assert/strict';
import { swingPreset,swingProfileConfig,sanitizeSwingProfile,SWING_PARAMETERS } from '../lib/swing-profile.ts';
import {createTraversalState,stepTraversal} from '../lib/traversal-physics.ts';
const v=(x=0,y=0,z=0)=>({x,y,z});
const profile=swingPreset();
const config=swingProfileConfig(profile);
const invalid=sanitizeSwingProfile({...profile,values:{maximumSpeed:1e20,gravity:NaN,baseFov:85,maximumFov:70,swingCruiseSpeed:100}});
assert.equal(invalid.values.maximumSpeed,130);assert.equal(invalid.values.gravity,29);assert.equal(invalid.values.maximumFov,85);
assert.deepEqual(sanitizeSwingProfile(JSON.parse(JSON.stringify(profile))),profile);
assert.deepEqual(sanitizeSwingProfile({version:2}),profile);
assert.equal(new Set(SWING_PARAMETERS.map(p=>p.key)).size,SWING_PARAMETERS.length);
function run(overrides={},aimY=0){
 let state=createTraversalState(v(0,25,0));state.velocity=v(0,-6,-28);
 let low=Infinity,high=-Infinity,peak=0,release=null;
 for(let i=0;i<480;i++){
  const result=stepTraversal(state,{swingHeld:true,cameraForward:v(0,0,-1),aimDirection:v(0,aimY,-1)},
   {groundY:0,anchorCandidates:[{id:'building',point:v(20,60,-30)}]},1/120,{...config,...overrides});state=result.state;
  low=Math.min(low,state.position.y);high=Math.max(high,state.position.y);peak=Math.max(peak,Math.hypot(state.velocity.x,state.velocity.y,state.velocity.z));
  release??=result.events.find(e=>e.reason==='apex-handoff');
  assert.ok(Object.values(state.position).every(Number.isFinite));
 }
 return {state,low,high,peak,release};
}
const rounded=run({swingAutoReattach:0});
assert.ok(rounded.low<20 && rounded.high>35,'default has a readable descent and upswing');
assert.ok(rounded.peak<config.maximumSpeed,'motor should not drive immediately to the speed cap');
assert.ok(Math.abs(rounded.state.position.z)<150,'rounded swing must not become a long straight launch');
const down=run({swingAutoReattach:0},-.6),up=run({swingAutoReattach:0},.6);
assert.ok(up.high>down.high+2,'look up/down must shape height');
const damped=run({swingAutoReattach:0,swingHorizontalDrag:.8,swingVerticalDrag:.8});
assert.ok(damped.peak<rounded.peak,'damping changes the real motion');
assert.ok(run().release,'held trigger automatically hands off near the apex');
for(const preset of ['friendly','physical','acrobat'])assert.ok(run(swingProfileConfig(swingPreset(preset))).peak<=130);
const state=createTraversalState(v(0,25,0));state.velocity=v(0,12,-30);
state.swing={anchor:v(10,60,-20),anchorId:'a',ropeLength:45,maximumLength:45,attachedSeconds:1.3,tension:.5,pressure:1};
const launch=stepTraversal(state,{swingReleased:true,cameraForward:v(0,0,-1)},{groundY:0},1/120,config).state;
assert.ok(launch.velocity.y>state.velocity.y && launch.velocity.y<35,'release lifts without a fixed huge launch floor');
const quiet=stepTraversal(state,{swingReleased:true,cameraForward:v(0,0,-1)},{groundY:0},1/120,{...config,swingReleaseLift:0,swingReleaseBoost:0}).state;
assert.ok(quiet.velocity.y<launch.velocity.y,'release customization changes motion');
console.log(JSON.stringify({passed:true,controls:SWING_PARAMETERS.length,rounded:{low:rounded.low,high:rounded.high,peak:rounded.peak},lookUp:up.high,lookDown:down.high}));
