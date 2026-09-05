import fs from 'node:fs/promises';import assert from 'node:assert/strict';import * as THREE from 'three';
import {FBXLoader} from 'three/examples/jsm/loaders/FBXLoader.js';import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
const reference=process.argv[2]??'/private/tmp/spiderman-reference';
const read=async p=>{const b=await fs.readFile(p);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};
const loader=new GLTFLoader(),target=(await loader.parseAsync(await read('public/assets/suits/miguel-2099.glb'),'')).scene;
const pack=await loader.parseAsync(await read('public/assets/animations/mixamo-2099.glb'),'');
const key=n=>n.toLowerCase().replace(/^.*:/,'').replace(/^(peter|mixamorig)/,'').replace(/_\d+.*$/,'');
const tb=new Map();target.traverse(b=>{if(b.isBone)tb.set(key(b.name),b)});
const pairs=[['leftarm','leftforearm'],['leftforearm','lefthand'],['rightarm','rightforearm'],['rightforearm','righthand'],['leftupleg','leftleg'],['leftleg','leftfoot'],['rightupleg','rightleg'],['rightleg','rightfoot']];
let samples=0,worst=1;const reports=[];
for(const file of(await fs.readdir(`${reference}/Assets/Animations/Mixamo`)).filter(n=>n.endsWith('.fbx'))){
 const source=new FBXLoader().parse(await read(`${reference}/Assets/Animations/Mixamo/${file}`),'');const sb=new Map();source.traverse(b=>{if(b.isBone)sb.set(key(b.name),b)});
 const name=file.replace(/^X Bot@/,'').replace(/\.fbx$/,'');const clip=pack.animations.find(c=>c.name===`mixamo:${name}`);assert.ok(clip);
 const sm=new THREE.AnimationMixer(source),tm=new THREE.AnimationMixer(target);
 for(const [m,c]of[[sm,source.animations[0]],[tm,clip]]){const a=m.clipAction(c);a.setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;a.play()}
 let minimum=1;
 for(let f=0;f<=30;f++){
  const t=source.animations[0].duration*f/30;sm.setTime(t);tm.setTime(t);source.updateMatrixWorld(true);target.updateMatrixWorld(true);
  for(const[a,b]of pairs){const dir=(map)=>map.get(b).getWorldPosition(new THREE.Vector3()).sub(map.get(a).getWorldPosition(new THREE.Vector3())).normalize();const dot=dir(sb).dot(dir(tb));minimum=Math.min(minimum,dot);samples++;}
 }
 sm.stopAllAction();tm.stopAllAction();worst=Math.min(worst,minimum);reports.push({clip:name,minimumDirectionAgreement:+minimum.toFixed(6)});
 assert.ok(minimum>.985,`${name}: source/2099 limb directions diverged (${minimum})`);
}
await fs.writeFile('docs/verification/retarget-fidelity.json',JSON.stringify({passed:true,samples,worstDirectionAgreement:worst,maxAngularErrorDegrees:THREE.MathUtils.radToDeg(Math.acos(worst)),reports},null,2)+'\n');
console.log(`PASS ${samples} shoulder/elbow/hip/knee segment direction comparisons, worst error ${THREE.MathUtils.radToDeg(Math.acos(worst)).toFixed(3)} degrees.`);
