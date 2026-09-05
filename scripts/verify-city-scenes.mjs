import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {getDistrict} from '../lib/game-config.ts';
import {WorldMeshQuery} from '../lib/mesh-world.ts';
import {RepeatingMeshWorld} from '../lib/repeating-mesh-world.ts';
import {findWallScenario,findRollScenario} from '../lib/traversal-scenarios.ts';
import {probeWallFeet} from '../lib/wall-surface.ts';
import {createTraversalState,stepTraversalInPlace,setTraversalKinematics,acceptTraversalWallContact,refreshTraversalContext} from '../lib/traversal-physics.ts';
import {hasRollCorridor} from '../lib/traversal-prediction.ts';
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(parser=>{parser.loadTextureImage=()=>Promise.resolve(new THREE.Texture());return{name:'CPUTextures'};});
const config=getDistrict('new-york-city'), bytes=await fs.readFile(`public${config.model}`);
const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const embedded=[];gltf.scene.traverse(o=>{if(o.isSkinnedMesh)embedded.push(o)});embedded.forEach(o=>o.removeFromParent());
const initial=new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3()),scale=config.targetWidth/Math.max(initial.x,initial.z);
gltf.scene.scale.setScalar(scale);gltf.scene.updateWorldMatrix(true,true);
const bounds=new THREE.Box3().setFromObject(gltf.scene),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
gltf.scene.position.set(-center.x,-config.sourceGroundY*scale,-center.z);
const root=new THREE.Group();root.add(gltf.scene);const floor=new THREE.Mesh(new THREE.BoxGeometry(size.x+12,.28,size.z+12),new THREE.MeshBasicMaterial());floor.position.y=-.16;root.add(floor);root.updateWorldMatrix(true,true);
const query=await WorldMeshQuery.fromObject(root), world=new RepeatingMeshWorld(query,size.x+8,size.z+8);
const wall=findWallScenario(world),roll=findRollScenario(world);assert.ok(wall);assert.ok(roll,'A real supported roll corridor exists');
const reports=[];
for(const kind of ['wall','roll'])for(const frameRate of [8,30,60,120]){
 const scenario=kind==='wall'?wall:roll,state=createTraversalState(scenario.position,scenario.velocity);
 const modes=new Set(),events=new Set();let contact=null,stage=0,penetrations=0,steps=0;
 // The physics API bounds individual calls under severe frame stalls. Test
 // exactly its supported maximum plus normal frame intervals against triangles.
 const dt=Math.min(1/frameRate,.05);
 while(state.elapsed<7){
  const input={move:kind==='wall'&&stage<2?wall.normal.clone().negate():new THREE.Vector3(),cameraForward:kind==='wall'?wall.normal.clone().negate():scenario.velocity,wallClimb:kind==='wall'&&stage<2?1:0,swingHeld:false};
  if(kind==='wall'){
   if(state.elapsed>1&&stage===0){input.wallCrawlPressed=true;stage=1;}
   if(state.elapsed>2.2&&stage===1){input.jumpPressed=true;stage=2;}
   if(state.elapsed>2.65&&stage===2){input.jumpPressed=true;stage=3;}
  }
  const before={...state.position},incoming={...state.velocity},wasGrounded=state.grounded;
  const result=stepTraversalInPlace(state,input,{groundY:-10000,wallContact:contact,canRoll:(p,v)=>hasRollCorridor(world,p,v),sampleGround:(p,r,d)=>world.supportAt(p,r,d??.1)?.point.y??null},dt);
  const hit=world.sweepCapsule(before,state.position,state.velocity);setTraversalKinematics(state,hit.position,hit.velocity);state.grounded=hit.grounded;
  if(!wasGrounded&&state.grounded){state.landingSeconds=.25;state.landingImpact=Math.max(0,-incoming.y);if(state.landingImpact>9&&Math.hypot(hit.velocity.x,hit.velocity.z)>7&&hasRollCorridor(world,state.position,state.velocity))state.rollSeconds=.8;}
  if(state.grounded)state.airSeconds=0;
  const normal=hit.wallNormal??state.wall?.normal;
  contact=normal?probeWallFeet(state.position,normal,(p,d,m)=>world.raycast(p,d,m)):null;
  if(contact){state.wall={...contact,contactSeconds:state.wall?.contactSeconds??0,graceSeconds:.14};acceptTraversalWallContact(state,contact,incoming,input);}
  else{state.wall=null;state.wallCrawlActive=false;state.wallRunActive=false;}
  refreshTraversalContext(state,input);modes.add(state.mode);result.events.forEach(e=>events.add(e.type));
  if(!world.isCapsuleClear(state.position,.46,2.05,false))penetrations++;
  assert.ok(Number.isFinite(state.velocity.x+state.velocity.y+state.velocity.z));steps++;
 }
 assert.equal(penetrations,0,`${kind} ${frameRate} FPS geometry overlap`);
 if(kind==='wall')for(const mode of ['wallRun','wallCrawl','wallJump','doubleJump'])assert.ok(modes.has(mode),`${frameRate}FPS missing ${mode}`);
 else assert.ok(modes.has('roll'),`${frameRate}FPS missing automatic landing roll`);
 reports.push({scene:kind,frameRate,effectiveStep:dt,steps,modes:[...modes],events:[...events],penetrations});
}
await fs.writeFile('docs/verification/city-scenes.json',JSON.stringify({passed:true,triangles:query.triangleCount,reports},null,2)+'\n');
console.log(`PASS: ${reports.length} real New York wall/aerial/roll scene replays, 8–120 FPS inputs, zero capsule penetrations.`);
