import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldMeshQuery } from '../lib/mesh-world.ts';
import {createSwingAssistanceState,stepSwingAssistance} from '../lib/swing-assistance.ts';
import {createTraversalState,stepTraversal} from '../lib/traversal-physics.ts';
import {swingPreset,swingProfileConfig} from '../lib/swing-profile.ts';
const material=new THREE.MeshBasicMaterial(),city=new THREE.Group();
const floor=new THREE.Mesh(new THREE.BoxGeometry(400,.2,400),material);floor.position.y=-.1;city.add(floor);
const tower=new THREE.Mesh(new THREE.BoxGeometry(8,70,12),material);tower.position.set(0,35,-42);city.add(tower);
const anchorBuilding=new THREE.Mesh(new THREE.BoxGeometry(12,90,28),material);anchorBuilding.position.set(31,45,-28);city.add(anchorBuilding);
const world=await WorldMeshQuery.fromObject(city);
const config=swingProfileConfig(swingPreset());
const simulate=avoidance=>{
 let state=createTraversalState({x:0,y:25,z:0});state.velocity={x:0,y:-4,z:-28};
 const assist=createSwingAssistanceState();let contacts=0,frames=0,maximumSpeed=0;
 const overrides={...config,swingAvoidance:avoidance,swingAutoReattach:0};
 for(let frame=0;frame<300;frame++){
  const old={...state.position};
  const predicted=stepSwingAssistance(assist,{position:state.position,velocity:state.velocity,dt:1/120,swinging:Boolean(state.swing),diving:false,tuning:overrides,desiredDirection:{x:0,y:0,z:-1},trajectoryVelocity:state.swing?{x:state.velocity.x+(state.swing.anchor.x-state.position.x)*.12,y:state.velocity.y-5,z:state.velocity.z+(state.swing.anchor.z-state.position.z)*.12}:undefined},(o,d,m)=>world.raycast(o,d,m));
  if(predicted.active)frames++;
  state=stepTraversal(state,{swingHeld:true,cameraForward:{x:0,y:0,z:-1},aimDirection:{x:0,y:.15,z:-1}},{externalCollision:true,groundY:0,predictiveAssistAcceleration:predicted.acceleration,anchorCandidates:[{id:'facade',point:{x:25,y:62,z:-28}}],sampleGround:p=>world.raycast({x:p.x,y:p.y+.2,z:p.z},{x:0,y:-1,z:0},30,.65)?.point.y??null},1/120,overrides).state;
  const swept=world.sweepCapsule(old,state.position,state.velocity);
  contacts+=swept.contacts;state.position={x:swept.position.x,y:swept.position.y,z:swept.position.z};state.velocity={x:swept.velocity.x,y:swept.velocity.y,z:swept.velocity.z};
  maximumSpeed=Math.max(maximumSpeed,Math.hypot(state.velocity.x,state.velocity.y,state.velocity.z));
  assert.ok(world.isCapsuleClear(state.position),'body must stay outside actual triangles');
 }
 return {contacts,frames,position:state.position,maximumSpeed};
};
const assisted=simulate(1),manual=simulate(0);
assert.ok(assisted.frames>0,'profile must steer before building contact');
assert.ok(assisted.contacts<manual.contacts,'default should avoid more collisions than manual swinging');
assert.ok(assisted.maximumSpeed<=config.maximumSpeed+1e-6);
console.log(JSON.stringify({passed:true,assisted,manual}));
