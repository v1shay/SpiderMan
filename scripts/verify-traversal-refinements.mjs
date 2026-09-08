import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createTraversalState,stepTraversalInPlace,acceptTraversalWallContact} from '../lib/traversal-physics.ts';
import {ADVANCED_TRAVERSAL_CONFIG as config,chargedJumpVelocity,slingshotVelocity,glideVelocity} from '../lib/traversal-advanced.ts';
import {probeLowObstacle} from '../lib/traversal-feature-world.ts';
import {WorldMeshQuery} from '../lib/mesh-world.ts';
import {TraversalTetherVisual} from '../lib/traversal-extras-visual.ts';
const v=(x=0,y=0,z=0)=>({x,y,z}),dt=1/120,f=v(0,0,-1),speed=s=>Math.hypot(s.velocity.x,s.velocity.y,s.velocity.z);
let checks=0;function test(name,fn){fn();checks++;console.log('PASS '+name);}
test('ground momentum settles to exactly zero without movement input',()=>{
 const s=createTraversalState(v(),v(25,0,-40));s.grounded=true;
 for(let i=0;i<120;i++)stepTraversalInPlace(s,{}, {groundY:0},dt,config);
 assert.equal(s.velocity.x,0);assert.equal(s.velocity.z,0);assert.equal(s.mode,'idle');
});
test('longer charges keep increasing height through four seconds, with a finite cap',()=>{
 const charges=[.2,.9,2,3,4,20].map(t=>chargedJumpVelocity(v(),t,13.5,108).y);
 for(let i=1;i<5;i++)assert.ok(charges[i]>charges[i-1]);assert.equal(charges[4],charges[5]);assert.equal(charges[4],76);
});
test('slingshot aim trades horizontal range for a substantially higher launch',()=>{
 const low=slingshotVelocity(v(),f,1.1,108),high=slingshotVelocity(v(),v(0,1,-.5),1.1,108);
 assert.ok(high.y>low.y*2);assert.ok(Math.abs(high.z)<Math.abs(low.z));assert.ok(Math.hypot(...Object.values(high))<=108);
});
test('neutral glide descends gently; dive gains speed; pull-up spends kinetic energy',()=>{
 const run=p=>{let velocity=v(0,0,-50),y=100;for(let i=0;i<360;i++){velocity=glideVelocity(velocity,f,p,dt,29,108);y+=velocity.y*dt;}return {velocity,y};};
 const neutral=run(0),dive=run(-1),up=run(1);
 assert.ok(neutral.y<100&&neutral.y>75);assert.ok(dive.y<neutral.y);assert.ok(Math.hypot(...Object.values(dive.velocity))>Math.hypot(...Object.values(up.velocity)));
 for(const r of [neutral,dive,up])assert.ok(.5*Math.hypot(...Object.values(r.velocity))**2+29*r.y<=.5*50**2+29*100+1e-5);
});
test('fast wall arrival becomes controllable and carries speed into the next swing once',()=>{
 const s=createTraversalState(v(.462,40),v(-50,30,-70)),contact={point:v(0,40),normal:v(1),feetTouching:true};
 s.wallApproach='swing';s.wallApproachUntil=10;
 assert.ok(acceptTraversalWallContact(s,contact,s.velocity,{cameraForward:f},config));assert.ok(speed(s)<=26.01);
 for(let i=0;i<120;i++)stepTraversalInPlace(s,{wallStrafe:-1,wallClimb:0,swingHeld:true,cameraForward:f},{groundY:-100,wallContact:contact},dt,config);
 assert.equal(s.mode,'wallRun');assert.ok(s.velocity.z>15);assert.ok(speed(s)<=26.01);
 const saved=s.wallCarrySpeed;assert.ok(saved>speed(s));s.swingNeedsRelease=false;
 stepTraversalInPlace(s,{swingPressed:true,swingHeld:true,aimDirection:v(0,1,1),cameraForward:v(0,0,1)},{groundY:-100,wallContact:null,anchorCandidates:[{point:v(0,75,s.position.z+30),kind:'facade'}]},dt,config);
 assert.ok(s.swing);assert.ok(speed(s)>30);assert.equal(s.wallCarrySpeed,0);
});
async function world(height,ceiling=false){const root=new THREE.Group();
 const box=new THREE.Mesh(new THREE.BoxGeometry(4,height,1),new THREE.MeshBasicMaterial());box.position.set(0,height/2,-1.5);root.add(box);
 const floor=new THREE.Mesh(new THREE.BoxGeometry(20,.2,20),new THREE.MeshBasicMaterial());floor.position.y=-.102;root.add(floor);
 if(ceiling){const roof=new THREE.Mesh(new THREE.BoxGeometry(6,.2,6),new THREE.MeshBasicMaterial());roof.position.y=2.2;root.add(roof);}
 root.updateMatrixWorld(true);return WorldMeshQuery.fromObject(root);}
for(const [height,ceiling,expected] of [[.8,false,true],[1.7,false,true],[5,false,false],[.8,true,false]]){
 const w=await world(height,ceiling);test(`vault geometry: ${height}m obstacle, ceiling ${ceiling}`,()=>assert.equal(Boolean(probeLowObstacle(w,v(0,.002,0),f)),expected));
}
test('slingshot webs begin at the actual independent left and right hand positions',()=>{
 const scene=new THREE.Scene(),webs=new TraversalTetherVisual(scene),hands=[v(-.7,1,.1),v(.7,.9,.2)];webs.update(hands,{sling:{anchors:[v(-20,8,-20),v(20,8,-20)]}});
 const p=webs.lines.geometry.getAttribute('position');for(let i=0;i<2;i++){assert.ok(Math.abs(p.getX(i*2)-hands[i].x)<1e-6);assert.ok(Math.abs(p.getY(i*2)-hands[i].y)<1e-6);assert.ok(Math.abs(p.getZ(i*2)-hands[i].z)<1e-6);}webs.dispose();
});
console.log(`${checks} refinement checks passed.`);
