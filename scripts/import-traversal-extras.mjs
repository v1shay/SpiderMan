import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { retargetWorldSpace } from './retarget-world-space.mjs';
const directory=process.argv[2]; if(!directory)throw new Error('Supply the FBX directory');
globalThis.FileReader=class {readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.();});}};
const loader=new GLTFLoader();loader.register(parser=>{parser.loadTextureImage=()=>Promise.resolve(new THREE.Texture());return {name:'OfflineTextures'};});
async function load(file){const b=await fs.readFile(file);return loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');}
const target=(await load('public/assets/suits/miguel-2099.glb')).scene;
const pack=await load('public/assets/animations/mixamo-2099.glb');
const imports=[['Flying','X Bot@Flying.fbx'],['Web Slingshot Charge','mixamo_web_slingshot_charge_0_to_100.fbx'],['Web Slingshot Hold','mixamo_web_slingshot_hold.fbx']];
const names=new Set(imports.map(([n])=>`mixamo:${n}`));const clips=pack.animations.filter(c=>!names.has(c.name)),manifest=[];
for(const [name,file] of imports){
 const b=await fs.readFile(`${directory}/${file}`);
 // The supplied generated ASCII FBX uses spaces and nonstandard curve-node labels.
 // Normalize syntax only; preserve all authored keys, values and connections.
 let parseBytes=b;
 if(b.toString('utf8',0,5)==='; FBX') {
  const text=';'+'.'.repeat(256)+'\n'+b.toString('utf8').replace(/^( +)/gm,m=>'\t'.repeat(m.length/4)).replace(/AnimCurveNode::([TRS])_[^"]+/g,'AnimCurveNode::$1');
  parseBytes=Buffer.from(text);
 }
 const source=new FBXLoader().parse(parseBytes.buffer.slice(parseBytes.byteOffset,parseBytes.byteOffset+parseBytes.byteLength),'');
 if(!source.animations[0])throw new Error(`No animation in ${file}`);
 const clip=retargetWorldSpace(source.animations[0],source,target,60);clip.name=`mixamo:${name}`;
 if(clip.tracks.length<20)throw new Error(`Incomplete rig mapping ${name}: ${clip.tracks.length}`);
 const tracked=new Set(clip.tracks.map(t=>t.name));
 target.traverse(o=>{if(o.isBone&&!tracked.has(`${o.name}.quaternion`))clip.tracks.push(new THREE.QuaternionKeyframeTrack(`${o.name}.quaternion`,[0,clip.duration],[...o.quaternion,...o.quaternion]));});
 clips.push(clip);manifest.push({name,file,sha256:createHash('sha256').update(b).digest('hex'),duration:clip.duration,tracks:clip.tracks.length});
 console.log(name,clip.duration,clip.tracks.length);
}
const meshes=[];target.traverse(o=>{if(o.isMesh)meshes.push(o);});meshes.forEach(o=>o.removeFromParent());
const glb=await new GLTFExporter().parseAsync(target,{binary:true,animations:clips,onlyVisible:false});
await fs.writeFile('public/assets/animations/mixamo-2099.glb',Buffer.from(glb));
await fs.writeFile('public/assets/animations/traversal-extras-manifest.json',JSON.stringify({method:'World-space anatomical retarget, original 2099 bone lengths; controller-owned translation',clips:manifest},null,2)+'\n');
