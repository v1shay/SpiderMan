import fs from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
const loader=new GLTFLoader();loader.register(p=>{p.loadTextureImage=()=>Promise.resolve(new THREE.Texture());return {name:'CPUTextures'};});
for(const name of process.argv.slice(2)){
 const bytes=await fs.readFile(name),g=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');g.scene.updateMatrixWorld(true);
 const box=new THREE.Box3().setFromObject(g.scene),meshes=[],levels=new Map();
 g.scene.traverse(o=>{if(!o.isMesh)return;const b=new THREE.Box3().setFromObject(o);meshes.push({name:o.name,min:b.min.toArray(),max:b.max.toArray(),materials:(Array.isArray(o.material)?o.material:[o.material]).map(m=>m.name)});
 const p=o.geometry.attributes.position,ix=o.geometry.index;const a=new THREE.Vector3(),b2=new THREE.Vector3(),c=new THREE.Vector3();for(let i=0;i<(ix?.count??p.count);i+=3){a.fromBufferAttribute(p,ix?ix.getX(i):i).applyMatrix4(o.matrixWorld);b2.fromBufferAttribute(p,ix?ix.getX(i+1):i+1).applyMatrix4(o.matrixWorld);c.fromBufferAttribute(p,ix?ix.getX(i+2):i+2).applyMatrix4(o.matrixWorld);const y=(a.y+b2.y+c.y)/3;const normal=b2.sub(a).cross(c.sub(a));if(normal.y>0&&normal.y/normal.length()>.9){const key=Math.round(y*10)/10;levels.set(key,(levels.get(key)??0)+normal.y/2);}}});
 console.log(JSON.stringify({name,bounds:[box.min.toArray(),box.max.toArray()],topLevels:[...levels].sort((a,b)=>b[1]-a[1]).slice(0,8),tallest:meshes.sort((a,b)=>b.max[1]-a.max[1]).slice(0,6)},null,2));
}
