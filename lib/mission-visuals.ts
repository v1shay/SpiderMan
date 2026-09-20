import * as THREE from 'three';
import type {MissionView} from './mission-system';
export class MissionVisuals {
  readonly root=new THREE.Group();
  private material=new THREE.MeshBasicMaterial({color:0x65efff,transparent:true,opacity:.75,depthWrite:false});
  private ring=new THREE.Mesh(new THREE.TorusGeometry(5,.12,5,32),this.material);
  private core=new THREE.Mesh(new THREE.OctahedronGeometry(.8),this.material);
  constructor(scene:THREE.Scene){this.root.add(this.ring,this.core);scene.add(this.root);this.root.visible=false;}
  update(view:MissionView|null,time:number){this.root.visible=!!view?.target;if(!view?.target)return;this.root.position.copy(view.target);this.root.position.y+=2;this.ring.rotation.y=time*.4;this.core.position.y=1+Math.sin(time*2)*.5;this.core.rotation.y=time;}
  dispose(){this.root.removeFromParent();this.ring.geometry.dispose();this.core.geometry.dispose();this.material.dispose();}
}
