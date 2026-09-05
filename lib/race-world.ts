import * as THREE from 'three';
import type {RaceCourse,RacePoint} from './race-session';
import type {RepeatingMeshWorld} from './repeating-mesh-world';
import type {TraversalState} from './traversal-physics';

export type WindLane={start:THREE.Vector3;end:THREE.Vector3;radius:number};
/** Tested corridors sit above a measured building envelope. Curved air ribbons
 * show the route while the capsule still uses the ordinary collision sweep. */
export function windLanes(course:RaceCourse,world:RepeatingMeshWorld):WindLane[]{
 const start=new THREE.Vector3().fromArray(course.start),end=new THREE.Vector3().fromArray(course.finish),direction=end.clone().sub(start).setY(0).normalize();
 const lanes:WindLane[]=[];
 for(const fraction of [.28,.64]){
  const center=start.clone().lerp(end,fraction),a=center.clone().addScaledVector(direction,-65),b=center.clone().addScaledVector(direction,65);
  let height=Math.max(25,center.y+18);
  for(let i=0;i<=8;i++){const p=a.clone().lerp(b,i/8);const hit=world.raycast(new THREE.Vector3(p.x,500,p.z),new THREE.Vector3(0,-1,0),600);if(hit)height=Math.max(height,hit.point.y+12);}
  a.y=height;b.y=height+5;lanes.push({start:a,end:b,radius:9});
 }
 return lanes;
}
export function applyWind(state:TraversalState,lanes:readonly WindLane[],delta:number){
 if(state.grounded||state.wallCrawlActive||state.wallRunActive||state.zip||state.swing)return false;
 const point=new THREE.Vector3().copy(state.position);let active=false;
 for(const lane of lanes){const axis=lane.end.clone().sub(lane.start),length=axis.length(),dir=axis.divideScalar(length),along=point.clone().sub(lane.start).dot(dir);if(along<0||along>length)continue;
 const nearest=lane.start.clone().addScaledVector(dir,along),offset=point.clone().sub(nearest),distance=offset.length();if(distance>lane.radius)continue;
 const weight=THREE.MathUtils.smoothstep(1-distance/lane.radius,0,.6);
 const gain=(1-Math.exp(-1.4*delta))*weight;state.velocity.x=THREE.MathUtils.lerp(state.velocity.x,dir.x*35,gain);state.velocity.z=THREE.MathUtils.lerp(state.velocity.z,dir.z*35,gain);
 state.velocity.y+= (30 + THREE.MathUtils.clamp((nearest.y-point.y)*1.8,-10,12)-state.velocity.y*2.5)*weight*delta;active=true;
 }
 return active;
}
export class RaceWorldVisuals{
 readonly root=new THREE.Group();private goal=new THREE.Group();private route:THREE.Line;private windMeshes:THREE.Group[]=[];lanes:WindLane[]=[];
 constructor(scene:THREE.Scene){
  this.root.add(this.goal);const ring=new THREE.Mesh(new THREE.TorusGeometry(8,.18,8,64),new THREE.MeshBasicMaterial({color:'#74fff1',transparent:true,opacity:.9}));ring.rotation.x=Math.PI/2;this.goal.add(ring);
  const beam=new THREE.Mesh(new THREE.CylinderGeometry(.9,2,125,12,1,true),new THREE.MeshBasicMaterial({color:'#54e6ff',transparent:true,opacity:.22,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending}));beam.position.y=60;this.goal.add(beam);
  const halo=new THREE.Mesh(new THREE.TorusGeometry(9,.4,8,64),new THREE.MeshBasicMaterial({color:'#a4ffff',transparent:true,opacity:.24,depthWrite:false,blending:THREE.AdditiveBlending}));halo.position.y=10;this.goal.add(halo);
  this.route=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineDashedMaterial({color:'#8fefff',transparent:true,opacity:.25,dashSize:3,gapSize:3}));this.root.add(this.route);scene.add(this.root);this.root.visible=false;
 }
 setCourse(course:RaceCourse,world:RepeatingMeshWorld){
  this.root.visible=true;this.goal.visible=true;this.route.visible=true;this.goal.position.fromArray(course.finish);this.lanes=windLanes(course,world);
  for(const group of this.windMeshes){group.removeFromParent();group.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());}})}this.windMeshes=[];
  for(const lane of this.lanes){const group=new THREE.Group();group.position.copy(lane.start);group.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),lane.end.clone().sub(lane.start).normalize());const length=lane.start.distanceTo(lane.end);
   for(let i=0;i<=10;i++){const ring=new THREE.Mesh(new THREE.TorusGeometry(lane.radius,.035,4,48),new THREE.MeshBasicMaterial({color:'#81efff',transparent:true,opacity:.2,depthWrite:false,blending:THREE.AdditiveBlending}));ring.position.z=i*length/10;group.add(ring);}
   this.root.add(group);this.windMeshes.push(group);
  }
 }
 update(position:RacePoint,elapsed:number){this.goal.children[2].rotation.y=elapsed*.35;this.goal.children[2].position.y=10+Math.sin(elapsed*2)*1.5;
 const vertices=this.route.geometry.getAttribute('position');vertices.setXYZ(0,position[0],position[1]+1,position[2]);vertices.setXYZ(1,this.goal.position.x,this.goal.position.y+3,this.goal.position.z);vertices.needsUpdate=true;this.route.computeLineDistances();this.route.geometry.computeBoundingSphere();
 for(const g of this.windMeshes)g.children.forEach((o,i)=>{const m=(o as THREE.Mesh).material as THREE.MeshBasicMaterial;m.opacity=.12+.22*(.5+.5*Math.sin(elapsed*3-i*.6));});
 }
 clear(){this.goal.visible=false;this.route.visible=false;}
 dispose(){this.root.removeFromParent();this.root.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Line){o.geometry.dispose();const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m.dispose());}});}
}
