/** Rebuild only the six inconsistent Classic clips from the calibrated 2099
 * reference motion. Preserve all other clips, clip names and the rig itself. */
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { retargetWorldSpace } from './retarget-world-space.mjs';
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(parser=>{parser.loadTextureImage=()=>Promise.resolve(new THREE.Texture());return {name:'clip_repair_no_textures'};});
async function load(path){const bytes=await fs.readFile(path);return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');}
const [reference,source,target,pack]=await Promise.all([
 load('public/assets/animations/mixamo-2099.glb'),load('public/assets/suits/miguel-2099.glb'),
 load('public/assets/suits/classic-suit.glb'),load('public/assets/animations/mixamo-classic-suit.glb'),
]);
const affected=new Set(['Big Body Blow','Corkscrew Kip Up','Wall Crash','Grab And Slam','Butterfly Twirl','Drop Kick'].map(name=>'mixamo:'+name));
const clips=pack.animations.map(clip=>{
 if(!affected.has(clip.name))return clip;
 const canonical=reference.animations.find(candidate=>candidate.name===clip.name);
 if(!canonical)throw new Error(`Missing reference ${clip.name}`);
 const repaired=retargetWorldSpace(canonical,source.scene,target.scene,30);
 repaired.name=clip.name;return repaired;
});
globalThis.FileReader=class {
 readAsArrayBuffer(blob){void blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.();});}
 readAsDataURL(blob){void blob.arrayBuffer().then(result=>{this.result=`data:${blob.type};base64,${Buffer.from(result).toString('base64')}`;this.onloadend?.();});}
};
const bytes=await new GLTFExporter().parseAsync(pack.scene,{binary:true,animations:clips,onlyVisible:false});
await fs.writeFile('public/assets/animations/mixamo-classic-suit.glb',Buffer.from(bytes));
console.log(`Repaired ${affected.size} Classic clips; retained all ${clips.length} animations.`);
