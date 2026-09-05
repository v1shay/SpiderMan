import * as THREE from 'three';
import type {RaceCourse} from './race-session';
export type GhostRecord={course:RaceCourse;time:number;bones:string[];frames:Float32Array[];version:1};
export type GhostRig={root:THREE.Object3D;surfaceFrame:THREE.Object3D;model:THREE.Object3D};
export class GhostRecorder{
  frames:Float32Array[]=[];bones:THREE.Bone[]=[];private next=0;
  private rig:GhostRig;
  constructor(rig:GhostRig){this.rig=rig;rig.model.traverse(o=>{if(o instanceof THREE.Bone)this.bones.push(o)});}
  capture(milliseconds:number){
    if(milliseconds<this.next||this.frames.length>=12000)return;this.next=milliseconds+50;
    const r=this.rig,values=[milliseconds,...r.root.position.toArray(),...r.root.quaternion.toArray(),...r.surfaceFrame.position.toArray(),...r.surfaceFrame.quaternion.toArray(),...r.model.position.toArray()];
    for(const b of this.bones)values.push(...b.quaternion.toArray());this.frames.push(new Float32Array(values));
  }
  record(course:RaceCourse,time:number):GhostRecord{return{course,time,bones:this.bones.map(b=>b.name),frames:this.frames,version:1};}
}
export function poseGhost(rig:GhostRig,record:GhostRecord,milliseconds:number){
  const frames=record.frames;if(!frames.length)return;
  let low=0,high=frames.length-1;while(low<high){const mid=Math.ceil((low+high)/2);if(frames[mid][0]<=milliseconds)low=mid;else high=mid-1;}
  const a=frames[low],b=frames[Math.min(low+1,frames.length-1)],t=THREE.MathUtils.clamp((milliseconds-a[0])/Math.max(1,b[0]-a[0]),0,1);
  const vec=(target:THREE.Vector3,offset:number)=>target.fromArray(a,offset).lerp(new THREE.Vector3().fromArray(b,offset),t);
  const quat=(target:THREE.Quaternion,offset:number)=>target.fromArray(a,offset).slerp(new THREE.Quaternion().fromArray(b,offset),t);
  vec(rig.root.position,1);quat(rig.root.quaternion,4);vec(rig.surfaceFrame.position,8);quat(rig.surfaceFrame.quaternion,11);vec(rig.model.position,15);
  record.bones.forEach((name,i)=>{const bone=rig.model.getObjectByName(name);if(bone)quat(bone.quaternion,18+i*4)});rig.root.updateMatrixWorld(true);
}
function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open('spiderman-2099-ghosts',1);request.onupgradeneeded=()=>request.result.createObjectStore('runs');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
export async function saveGhost(record:GhostRecord){const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('runs','readwrite');tx.objectStore('runs').put(record,record.course.id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
export async function loadGhost(courseId:string):Promise<GhostRecord|null>{const db=await database();try{return await new Promise((resolve,reject)=>{const request=db.transaction('runs').objectStore('runs').get(courseId);request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>reject(request.error);});}finally{db.close();}}
export function readBest(courseId:string):number|null{try{const n=Number(localStorage.getItem(`2099-pb:${courseId}`));return n>0&&Number.isFinite(n)?n:null;}catch{return null;}}
export function storeBest(course:RaceCourse,time:number){try{localStorage.setItem(`2099-pb:${course.id}`,String(time));localStorage.setItem('2099-last-course',JSON.stringify(course));return true;}catch{return false;}}
