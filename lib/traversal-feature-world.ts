/** Real-geometry queries for optional maneuvers. No anchor is fabricated here. */
import { aAdd, aSub, aScale, aUnit, aDot, aLength, aCross, turnHorizontal, ADVANCED_TUNING, type AVec } from './traversal-advanced.ts';
import type { WebAnchorCandidate } from './traversal-physics.ts';
export interface FeatureWorld {
  raycast(origin: AVec, direction: AVec, maximum: number): {point: AVec; normal: AVec; distance: number; triangleIndex?: number} | null;
  sweepCapsule(from: AVec, to: AVec, velocity: AVec): {position: AVec; blocked: boolean; grounded: boolean};
}
export type FeatureQuery = {
  slingshotAnchors: [WebAnchorCandidate, WebAnchorCandidate] | null;
  cornerTarget: {anchor: WebAnchorCandidate; direction: AVec} | null;
};
export function probeAdvancedWorld(world: FeatureWorld, position: AVec, velocity: AVec, forward: AVec,
  slingRequested: boolean, cornerSide: number, gravity = 29): FeatureQuery {
  const result: FeatureQuery = {slingshotAnchors:null,cornerTarget:null};
  const f=aUnit({x:forward.x,y:0,z:forward.z}), right=aCross(f,{x:0,y:1,z:0});
  const chest=aAdd(position,{x:0,y:1.3,z:0});
  function candidate(direction:AVec,maximum:number): WebAnchorCandidate|null {
    const hit=world.raycast(chest,aUnit(direction),maximum);
    if(!hit||hit.distance<3||Math.abs(hit.normal.y)>.4)return null;
    const offset=aSub(hit.point,chest),range=aLength(offset);
    if(world.raycast(chest,aUnit(offset),Math.max(0,range-.1)))return null;
    return {id:`feature:${hit.triangleIndex??'surface'}:${hit.point.x.toFixed(2)}:${hit.point.z.toFixed(2)}`,
      point:{...hit.point},normal:{...hit.normal},kind:'facade',lineOfSight:true};
  }
  if(slingRequested){
    const pair: WebAnchorCandidate[]=[];
    for(const side of [-1,1]){
      let best:WebAnchorCandidate|null=null,bestScore=-Infinity;
      for(const lateral of [.7,1.15,1.6])for(const height of [.2,.55]){
        const anchor=candidate(aAdd(aAdd(f,aScale(right,side*lateral)),{x:0,y:height,z:0}),65);
        if(!anchor)continue;
        const offset=aSub(anchor.point,chest);
        if(aDot(offset,right)*side<2||aDot(offset,f)<3)continue;
        const score=aDot(offset,f)-Math.abs(aLength(offset)-30)*.2;
        if(score>bestScore){best=anchor;bestScore=score;}
      }
      if(best)pair.push(best);
    }
    if(pair.length===2)result.slingshotAnchors=[pair[0],pair[1]];
  }
  if(Math.abs(cornerSide)>.5&&Math.hypot(velocity.x,velocity.z)>16){
    const direction=aScale(right,Math.sign(cornerSide));
    const anchor=candidate(aAdd(aScale(f,.25),direction),17)
      ??candidate(aAdd(aScale(f,.7),direction),17);
    if(anchor){
      let p={...position},v={...velocity},clear=true;
      const dt=ADVANCED_TUNING.cornerSeconds/12;
      for(let i=0;i<12;i++){
        v=turnHorizontal(v,direction,dt,ADVANCED_TUNING.cornerTurnRate);v.y-=gravity*dt;
        const wanted=aAdd(p,aScale(v,dt)),hit=world.sweepCapsule(p,wanted,v);
        if(hit.blocked||hit.grounded||aLength(aSub(hit.position,wanted))>.04){clear=false;break;}
        p=wanted;
      }
      if(clear)result.cornerTarget={anchor,direction};
    }
  }
  return result;
}

/** A low obstacle is vaulted only when both rise and crossing are capsule-clear. */
export function probeLowObstacle(world: FeatureWorld, position: AVec, move: AVec): AVec | null {
  if (Math.hypot(move.x,move.z)<.1) return null;
  const forward=aUnit({x:move.x,y:0,z:move.z});
  const hit=world.raycast(aAdd(position,{x:0,y:.35,z:0}),forward,1.4);
  if(!hit||Math.abs(hit.normal.y)>.35)return null;
  const across=aAdd(position,aScale(forward,hit.distance+1));
  const top=world.raycast({...across,y:position.y+2.04},{x:0,y:-1,z:0},2);
  if(!top||top.normal.y<.85||top.point.y-position.y<.2||top.point.y-position.y>1.95)return null;
  const target={...top.point,y:top.point.y+.04};
  const raised={...position,y:target.y};
  const up=world.sweepCapsule(position,raised,{x:0,y:1,z:0});
  if(aLength(aSub(up.position,raised))>.025)return null;
  const over=world.sweepCapsule(raised,target,forward);
  return aLength(aSub(over.position,target))<.025?target:null;
}
