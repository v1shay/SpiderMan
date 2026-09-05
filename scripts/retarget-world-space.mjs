import * as THREE from 'three';

const key = name => name.toLowerCase().replace(/^.*:/, '').replace(/^(mixamorig|peter)/,'').replace(/_\d+.*$/, '').replace(/[^a-z0-9]/g,'');
/** Absolute anatomical retarget. The 2099 bind is an A-pose with bent elbows;
 * applying T-pose local deltas to it folds the arms through the chest.
 * Match source world frames and each target segment's local longitudinal axis,
 * then solve back through the animated target parent. Preserve target lengths. */
export function retargetWorldSpace(clip, source, target, fps=30) {
  const sb=new Map(),tb=new Map(), saved=[];
  source.traverse(o=>{if(o.isBone)sb.set(key(o.name),o)});
  target.traverse(o=>{if(o.isBone){tb.set(key(o.name),o);saved.push([o,o.quaternion.clone()])}});
  source.updateMatrixWorld(true);target.updateMatrixWorld(true);
  const pairs=[];
  source.traverse(s=>{
    if(!s.isBone)return;
    const t=tb.get(key(s.name));if(!t)return;
    const sc=s.children.find(c=>c.isBone&&tb.has(key(c.name)));
    const tc=sc?tb.get(key(sc.name)):null;
    const offset=new THREE.Quaternion();
    if(sc&&tc?.parent===t&&sc.position.lengthSq()>1e-10&&tc.position.lengthSq()>1e-10)offset.setFromUnitVectors(tc.position.clone().normalize(),sc.position.clone().normalize());
    pairs.push({s,t,offset,values:[]});
  });
  const mixer=new THREE.AnimationMixer(source),action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
  const frames=Math.max(2,Math.ceil(clip.duration*fps)+1),times=[];
  const q=new THREE.Quaternion(),parent=new THREE.Quaternion();
  for(let i=0;i<frames;i++){
    const time=clip.duration*i/(frames-1);times.push(time);mixer.setTime(time);source.updateMatrixWorld(true);
    for(const p of pairs){
      p.s.getWorldQuaternion(q).multiply(p.offset);
      p.t.parent.getWorldQuaternion(parent).invert();
      p.t.quaternion.copy(parent.multiply(q)).normalize();
      p.t.updateMatrixWorld(true);
      p.values.push(...p.t.quaternion.toArray());
    }
  }
  mixer.stopAllAction();mixer.uncacheRoot(source);
  for(const [bone,rotation]of saved)bone.quaternion.copy(rotation);
  target.updateMatrixWorld(true);
  return new THREE.AnimationClip(clip.name,Math.max(.35,clip.duration),pairs.map(p=>new THREE.QuaternionKeyframeTrack(`${p.t.name}.quaternion`,times,p.values)));
}
