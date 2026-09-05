export type RacePoint = [number, number, number];
export type RaceCourse = { id: string; start: RacePoint; finish: RacePoint; side: number };
export type RacePacket = { version: 1; type: 'invite'|'accept'|'start'|'finish'|'cancel'; sender: string; raceId: string; sentAt: number; course?: RaceCourse; until?: number; participants?: string[]; elapsed?: number };
export type RacePhase = 'free'|'inviting'|'invited'|'countdown'|'racing'|'finished';
export type RaceView = { phase: RacePhase; time: number; countdown: number; best: number|null; distance: number; participants: number; course: RaceCourse|null; results: {id:string;time:number}[]; ghost: boolean; wind: boolean; message: string };
export const emptyRaceView: RaceView = {phase:'free',time:0,countdown:0,best:null,distance:0,participants:1,course:null,results:[],ghost:false,wind:false,message:'Own the skyline'};
export const raceDistance = (a: RacePoint,b: RacePoint) => Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
export function createRaceCourse(start:RacePoint,width:number,depth:number,seed:number,previousSide=-1):RaceCourse {
  let side=(seed>>>0)%4;if(side===previousSide)side=(side+1)%4;
  const tiles=2+((seed>>>3)%2),dx=[1,0,-1,0][side]*width*tiles,dz=[0,1,0,-1][side]*depth*tiles;
  const finish:RacePoint=[start[0]+dx,start[1],start[2]+dz];
  return {id:`nyc2099-v4:${start.map(n=>n.toFixed(1)).join(',')}:${finish.map(n=>n.toFixed(1)).join(',')}`,start:[...start],finish,side};
}
export function validRaceCourse(value:unknown):value is RaceCourse {
  if(!value||typeof value!=='object')return false;const c=value as RaceCourse;
  const point=(p:unknown):p is RacePoint=>Array.isArray(p)&&p.length===3&&p.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<1e6);
  return typeof c.id==='string'&&c.id.length<200&&point(c.start)&&point(c.finish)&&raceDistance(c.start,c.finish)>=300&&raceDistance(c.start,c.finish)<10000&&Number.isInteger(c.side)&&c.side>=0&&c.side<4;
}
export function validRacePacket(value:unknown):value is RacePacket {
  if(!value||typeof value!=='object')return false;const p=value as RacePacket;
  return p.version===1&&['invite','accept','start','finish','cancel'].includes(p.type)&&typeof p.sender==='string'&&p.sender.length>=8&&p.sender.length<=80&&typeof p.raceId==='string'&&p.raceId.length<=80&&Number.isFinite(p.sentAt)
    &&(p.course===undefined||validRaceCourse(p.course))&&(p.until===undefined||Number.isFinite(p.until))&&(p.elapsed===undefined||(Number.isFinite(p.elapsed)&&p.elapsed>0&&p.elapsed<3600000))
    &&(p.participants===undefined||(Array.isArray(p.participants)&&p.participants.length<=64&&new Set(p.participants).size===p.participants.length&&p.participants.every(id=>typeof id==='string'&&id.length>=8&&id.length<=80)));
}

type Hooks={send:(p:RacePacket)=>void;teleport:(p:RacePoint)=>void;finished:(course:RaceCourse,time:number)=>void;started:(course:RaceCourse)=>void};
/** Deterministic host invitation/countdown protocol. Invitation alone never
 * moves a receiver. Duplicate packets and starts from non-hosts are ignored. */
export class RaceSession {
  phase:RacePhase='free';course:RaceCourse|null=null;raceId='';host='';until=0;startAt=0;time=0;accepted=false;
  participants=new Set<string>();results=new Map<string,number>();private nextRepeat=0;private completed=false;
  readonly id:string; private hooks:Hooks;
  constructor(id:string,hooks:Hooks){this.id=id;this.hooks=hooks;}
  private packet(type:RacePacket['type'],now:number,extra:Partial<RacePacket>={}){this.hooks.send({version:1,type,sender:this.id,raceId:this.raceId,sentAt:now,...extra});}
  invite(course:RaceCourse,now:number,peerCount:number,raceId:string){
    if(['racing','countdown','inviting'].includes(this.phase)||!validRaceCourse(course))return false;
    this.reset();this.host=this.id;this.raceId=raceId;this.course=course;this.accepted=true;this.participants.add(this.id);this.phase='inviting';this.until=now+(peerCount?8000:500);this.nextRepeat=now;
    this.packet('invite',now,{course,until:this.until});return true;
  }
  accept(now:number){if(this.phase!=='invited'||now>this.until)return;this.accepted=true;this.participants.add(this.id);this.packet('accept',now);}
  decline(now:number){if(this.phase==='invited'){this.accepted=false;this.reset();}else this.cancel(now);}
  cancel(now:number){if(this.host===this.id)this.packet('cancel',now);this.reset();}
  private reset(){this.phase='free';this.accepted=false;this.course=null;this.results.clear();this.participants.clear();this.time=0;this.completed=false;this.startAt=0;}
  private start(now:number){
    if(!this.course)return;this.phase='countdown';this.startAt=now+3000;this.until=this.startAt;this.nextRepeat=now+750;
    this.hooks.teleport(this.course.start);this.packet('start',now,{course:this.course,until:this.startAt,participants:[...this.participants]});
  }
  receive(packet:unknown,now:number){
    if(!validRacePacket(packet))return;const p=packet;if(p.sender===this.id||Math.abs(p.sentAt-now)>30000)return;
    if(p.type==='invite'){
      if(!p.course||!p.until||p.until<now||p.until>now+15000)return;
      if(this.raceId===p.raceId)return;
      if(!['free','finished','invited'].includes(this.phase))return;
      if(this.phase==='invited'&&this.accepted)return;
      this.reset();this.phase='invited';this.host=p.sender;this.raceId=p.raceId;this.course=p.course;this.until=p.until;return;
    }
    if(p.raceId!==this.raceId)return;
    if(p.type==='accept'&&this.host===this.id&&this.phase==='inviting'&&now<this.until){this.participants.add(p.sender);return;}
    if(p.type==='start'&&p.sender===this.host&&this.accepted&&this.phase==='invited'&&p.course&&p.participants?.includes(this.id)&&p.until&&p.until>=now-1500&&p.until<now+10000){
      if(p.course.id!==this.course?.id||JSON.stringify(p.course)!==JSON.stringify(this.course))return;
      this.participants=new Set(p.participants);this.phase='countdown';this.startAt=p.until;this.hooks.teleport(p.course.start);return;
    }
    if(p.type==='cancel'&&p.sender===this.host&&this.phase!=='finished'){this.reset();return;}
    if(p.type==='finish'&&this.participants.has(p.sender)&&p.elapsed&&this.startAt&&p.sentAt>=this.startAt&&Math.abs(p.sentAt-this.startAt-p.elapsed)<2500)this.results.set(p.sender,p.elapsed);
  }
  tick(now:number,position:RacePoint){
    if(this.phase==='inviting'){
      if(now>=this.until)this.start(now);
      else if(now>=this.nextRepeat){this.nextRepeat=now+1000;this.packet('invite',now,{course:this.course!,until:this.until});}
    }
    if(this.phase==='invited'){
      if(this.accepted&&now>=this.nextRepeat){this.nextRepeat=now+700;this.packet('accept',now);}
      if(now>this.until+8000)this.reset();
    }
    if(this.phase==='countdown'){
      if(this.host===this.id&&now<this.startAt&&now>=this.nextRepeat){this.nextRepeat=now+750;this.packet('start',now,{course:this.course!,until:this.startAt,participants:[...this.participants]});}
      if(now>=this.startAt){this.phase='racing';this.hooks.started(this.course!);}
    }
    if(this.phase==='racing'&&this.course){
      this.time=Math.max(0,now-this.startAt);
      if(!this.completed&&raceDistance(position,this.course.finish)<9&&this.time>250){this.completed=true;this.phase='finished';this.results.set(this.id,this.time);this.packet('finish',now,{elapsed:this.time});this.hooks.finished(this.course,this.time);}
    }
  }
}
export function formatRaceTime(ms:number|null){if(ms===null)return '—';const s=Math.max(0,ms)/1000;return `${Math.floor(s/60)}:${(s%60).toFixed(2).padStart(5,'0')}`;}
