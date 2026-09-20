export type MissionPoint = {x:number;y:number;z:number};
export type ObjectiveKind = 'reach'|'chase'|'collect'|'protect'|'survive'|'escape'|'destroy'|'interact'|'dialogue'|'bossPhase'|'reward';
export type ObjectiveNode = {id:string;kind:ObjectiveKind;label:string;position?:MissionPoint;radius?:number;duration?:number;target?:string;amount?:number;next?:string};
export type MissionDefinition = {id:string;name:string;seconds:number;nodes:ObjectiveNode[];reward:number};
export type MissionSignals = {position:MissionPoint;interact:boolean;score:number;collected?:ReadonlySet<string>;destroyed?:ReadonlySet<string>;protectedHealth?:number;bossPhase?:number;alive:boolean};
export type MissionView = {id:string;name:string;status:'active'|'complete'|'failed';objective:string;remaining:number;target:MissionPoint|null;radius:number;reward:number;step:number;steps:number};
const distance=(a:MissionPoint,b:MissionPoint)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);

/** Small graph interpreter: game events are data; high-frequency state stays outside React. */
export class MissionSystem {
  private definition:MissionDefinition|null=null;
  private index=0;private elapsed=0;private nodeElapsed=0;private startScore=0;
  private status:MissionView['status']='active';
  start(definition:MissionDefinition,score=0) {
    if(!definition.nodes.length||new Set(definition.nodes.map(n=>n.id)).size!==definition.nodes.length)throw new Error('Mission nodes must be unique and nonempty');
    for(const node of definition.nodes)if(node.next&&!definition.nodes.some(n=>n.id===node.next))throw new Error('Unknown objective edge');
    this.definition=definition;this.index=0;this.elapsed=0;this.nodeElapsed=0;this.startScore=score;this.status='active';
  }
  retry(score=0){if(this.definition)this.start(this.definition,score);}
  stop(){this.definition=null;}
  step(dt:number,signals:MissionSignals):MissionView|null {
    const d=this.definition;if(!d)return null;
    if(this.status!=='active')return this.view();
    this.elapsed+=Math.max(0,dt);this.nodeElapsed+=Math.max(0,dt);
    if(!signals.alive||this.elapsed>d.seconds){this.status='failed';return this.view();}
    const n=d.nodes[this.index],near=!n.position||distance(signals.position,n.position)<(n.radius??6);
    let complete=false;
    switch(n.kind){
      case'reach':case'chase':complete=near;break;
      case'collect':complete=near&&(n.target?Boolean(signals.collected?.has(n.target)):true);break;
      case'interact':case'dialogue':complete=near&&signals.interact;break;
      case'protect':if((signals.protectedHealth??0)<=0)this.status='failed';complete=(signals.protectedHealth??0)>0&&this.nodeElapsed>=(n.duration??10);break;
      case'survive':complete=this.nodeElapsed>=(n.duration??10);break;
      case'escape':complete=!!n.position&&distance(signals.position,n.position)>(n.radius??30);break;
      case'destroy':complete=!!n.target&&Boolean(signals.destroyed?.has(n.target));break;
      case'bossPhase':complete=(signals.bossPhase??0)>=(n.amount??1);break;
      case'reward':complete=signals.score-this.startScore>=(n.amount??0);break;
    }
    if(complete){this.index=n.next?d.nodes.findIndex(next=>next.id===n.next):this.index+1;this.nodeElapsed=0;if(this.index>=d.nodes.length)this.status='complete';}
    return this.view();
  }
  view():MissionView|null {const d=this.definition;if(!d)return null;const n=d.nodes[Math.min(this.index,d.nodes.length-1)];return{id:d.id,name:d.name,status:this.status,objective:this.status==='complete'?`COMPLETE +${d.reward}`:this.status==='failed'?'TIME EXPIRED · RETRY':n.label,remaining:Math.max(0,d.seconds-this.elapsed),target:this.status==='active'?n.position??null:null,radius:n.radius??6,reward:d.reward,step:Math.min(this.index+1,d.nodes.length),steps:d.nodes.length};}
}

/** All route positions come from collision-verified world supports supplied by the caller. */
export function createCityMission(kind:'courier'|'rescue'|'style',points:MissionPoint[]):MissionDefinition {
  if(points.length<3)throw new Error('Three verified locations required');
  if(kind==='style')return{id:'flow-challenge',name:'ROOFTOP FLOW',seconds:90,reward:600,nodes:[{id:'start',kind:'reach',label:'Reach the cyan marker',position:points[0],radius:12},{id:'score',kind:'reward',label:'Earn 1,000 trick points',amount:1000},{id:'finish',kind:'reach',label:'Return to the beacon',position:points[2],radius:12}]};
  if(kind==='rescue')return{id:'timed-rescue',name:'EMERGENCY SIGNAL',seconds:80,reward:500,nodes:[{id:'signal',kind:'reach',label:'Reach the distress signal',position:points[0],radius:10},{id:'rescue',kind:'interact',label:'Press N to secure the rescue beacon',position:points[0],radius:10},{id:'evacuate',kind:'reach',label:'Carry the beacon to the safe rooftop',position:points[2],radius:10}]};
  return{id:'rooftop-courier',name:'ROOFTOP COURIER',seconds:110,reward:400,nodes:points.map((position,i)=>({id:`delivery-${i}`,kind:i===0?'collect':'reach',label:i===0?'Collect the glowing delivery capsule':`Deliver to rooftop ${i+1}`,position,radius:10}))};
}
