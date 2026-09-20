import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { WorldMeshQuery } from '../lib/mesh-world.ts';
import { RepeatingMeshWorld } from '../lib/repeating-mesh-world.ts';
import { DISTRICTS } from '../lib/game-config.ts';
import { createRaceCourse, validRaceCourse } from '../lib/race-session.ts';
import { createRaceGeometrySampler } from '../lib/race-world.ts';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(parser => {
  parser.loadTextureImage = () => Promise.resolve(new THREE.Texture());
  return {name:'race_geometry_audit',loadTexture:()=>Promise.resolve(new THREE.Texture())};
});
const reports=[];
for(const config of DISTRICTS){
 const bytes=await fs.readFile(new URL(`../public${config.model}`,import.meta.url));
 const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const embedded=[];gltf.scene.traverse(o=>{if(o instanceof THREE.SkinnedMesh)embedded.push(o);});for(const o of embedded)o.removeFromParent();
 const raw=new THREE.Box3().setFromObject(gltf.scene),sourceSize=raw.getSize(new THREE.Vector3());
 const scale=config.targetWidth/Math.max(sourceSize.x,sourceSize.z,.001);gltf.scene.scale.setScalar(scale);gltf.scene.updateWorldMatrix(true,true);
 const bounds=new THREE.Box3().setFromObject(gltf.scene),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
 gltf.scene.position.set(-center.x,-config.sourceGroundY*scale,-center.z);
 const root=new THREE.Group();root.position.set(...config.position);root.rotation.y=config.rotation??0;root.add(gltf.scene);
 const floor=new THREE.Mesh(new THREE.BoxGeometry(size.x+12,.28,size.z+12),new THREE.MeshBasicMaterial());floor.position.y=-.16;root.add(floor);root.updateWorldMatrix(true,true);
 const rotated=new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
 const world=new RepeatingMeshWorld(await WorldMeshQuery.fromObject(root),Math.max(8,rotated.x-4),Math.max(8,rotated.z-4));
 const startHit=world.raycast(new THREE.Vector3(0,world.query.bounds.max.y+50,0),new THREE.Vector3(0,-1,0),2000,.65);
 const start=[0,(startHit?.point.y??0)+.002,0];
 const sampled=createRaceGeometrySampler(world),started=performance.now();const courses=[];
 for(const seed of [50,137,214]){
  const course=createRaceCourse(start,world.width,world.depth,seed,-1,{sample:sampled,mapId:config.id,mode:'combined'});
  assert.ok(validRaceCourse(course));
  for(const gate of course.gates){
   const position=new THREE.Vector3().fromArray(gate.position);assert.ok(world.isCapsuleClear(position,.5,2.05),`${config.id}/${seed}/${gate.id} inside geometry`);
   if(gate.type==='wall-run')assert.ok([[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]].some(d=>world.raycast(position,new THREE.Vector3(...d),2)),`${config.id}/${gate.id} lacks real facade`);
  }
  courses.push({seed,gates:course.gates.map(g=>({id:g.id,type:g.type,position:g.position,required:g.required})),finish:course.finish});
 }
 const report={map:config.id,triangles:world.query.triangleCount,generationMs:+(performance.now()-started).toFixed(2),courses};reports.push(report);
 console.log(`PASS ${config.name}: ${courses.length} courses, ${courses.flatMap(c=>c.gates).length} collision-clear actual-city gates (${report.generationMs}ms)`);
 root.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());}});
}
await fs.writeFile('docs/verification/race-city-courses.json',JSON.stringify({passed:true,reports},null,2)+'\n');
