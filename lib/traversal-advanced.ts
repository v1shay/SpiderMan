/** Custom assisted traversal, inspired by public gameplay descriptions.
 * No proprietary Insomniac code or constants. Pure data, no rendering or I/O.
 * All locomotion outputs are velocities; the caller must sweep every movement.
 */
import { SPIDER_TRAVERSAL_FEEL, limitFeelVelocity, type FeelVector } from './traversal-feel.ts';
export type AVec = FeelVector;
export type AdvancedRuntime = {
  enabled: boolean;
  gliding: boolean;
  chargeJump: number;
  sling: { anchors: [AVec, AVec]; direction: AVec; seconds: number } | null;
  corner: { anchor: AVec; direction: AVec; seconds: number } | null;
  loop: { automatic?: boolean; axis: AVec; previousRadial: AVec; radians: number; seconds: number } | null;
  pulse: number;
  flow: number;
  wallSamplePosition?: AVec;
  wallStallSeconds?: number;
  wallRecoveryUntil?: number;
  wallRecoverySide?: number;
  lastReleaseAt: number;
  diveSpeed: number;
  diveUntil: number;
  zipAfter: number;
  cornerAfter: number;
  loopAfter: number;
  phase: 'catch' | 'downswing' | 'trough' | 'upswing' | 'apex' | 'air';
};
export const ADVANCED_TRAVERSAL_CONFIG = Object.freeze({
  ...SPIDER_TRAVERSAL_FEEL,
  advancedTraversal: true,
  maximumSpeed: 108,
  swingMaximumLength: 120,
  anchorMaximumDistance: 145,
  swingPumpAcceleration: 58,
  swingSteerAcceleration: SPIDER_TRAVERSAL_FEEL.swingSteerAcceleration,
  swingReelSpeed: 12,
  zipMaximumSpeed: 96,
  wallRunLift: 7,
  maximumFov: 94,
  cameraMotionScale: 1,
  // Empty-sky anchors are available only through an explicit accessibility mode.
  allowSkyFallback: false,
});
export const ADVANCED_TUNING = Object.freeze({
  releaseFullCharge: 1.2,
  shortReleaseUp: 7,
  chargedReleaseUp: 35,
  shortReleaseForward: 5,
  chargedReleaseForward: 19,
  timingUpBonus: 5,
  timingForwardBonus: 5,
  chainWindow: 2.1,
  chainMaximum: 4,
  chargeJumpSeconds: 4,
  chargeJumpUp: 76,
  slingChargeSeconds: 1.1,
  slingMinimumCharge: .18,
  slingForward: 98,
  slingUp: 31,
  cornerSeconds: .38,
  cornerTurnRate: 4.8,
  zipCooldown: .38,
  skimImpulseBudget: 12,
  skimUpAcceleration: 48,
  loopMinimumDiveSpeed: 32,
  loopMotorAcceleration: 0,
});
const eps = 1e-8;
export const aClamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const aLength = (v: AVec) => Math.hypot(v.x, v.y, v.z);
export const aDot = (a: AVec, b: AVec) => a.x*b.x+a.y*b.y+a.z*b.z;
export const aSub = (a: AVec, b: AVec): AVec => ({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
export const aScale = (v: AVec, s: number): AVec => ({x:v.x*s,y:v.y*s,z:v.z*s});
export const aAdd = (a: AVec, b: AVec): AVec => ({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
export const aCross = (a: AVec,b: AVec): AVec => ({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
export const aUnit = (v: AVec, fallback: AVec = {x:0,y:0,z:-1}): AVec => {
  const n=aLength(v); return n>eps?aScale(v,1/n):{...fallback};
};
export const aReject = (v: AVec,n: AVec): AVec => aSub(v,aScale(n,aDot(v,n)));
const flat = (v: AVec): AVec => ({x:v.x,y:0,z:v.z});
const smooth = (n: number) => {n=aClamp(n,0,1);return n*n*(3-2*n);};
export function createAdvancedRuntime(): AdvancedRuntime {
  return {enabled:false,gliding:false,chargeJump:0,sling:null,corner:null,loop:null,pulse:0,flow:0,
    lastReleaseAt:-1e9,diveSpeed:0,diveUntil:0,zipAfter:0,cornerAfter:0,loopAfter:0,phase:'air'};
}
export function cloneAdvancedRuntime(a: AdvancedRuntime): AdvancedRuntime {
  return {...a,
    wallSamplePosition:a.wallSamplePosition?{...a.wallSamplePosition}:undefined,
    sling:a.sling?{...a.sling,anchors:[{...a.sling.anchors[0]},{...a.sling.anchors[1]}],direction:{...a.sling.direction}}:null,
    corner:a.corner?{...a.corner,anchor:{...a.corner.anchor},direction:{...a.corner.direction}}:null,
    loop:a.loop?{...a.loop,axis:{...a.loop.axis},previousRadial:{...a.loop.previousRadial}}:null};
}
/** Redirect the catch into the web's plane, not into a moving invisible pivot.
 * This conserves speed, not momentum direction; it is an explicit arcade assist.
 */
export function catchVelocity(v: AVec, radial: AVec, forward: AVec, maximum: number): AVec {
  const input=limitFeelVelocity(v,maximum), n=aUnit(radial,{x:0,y:-1,z:0});
  const tangent=aReject(input,n), speed=aLength(input);
  const fallback=aReject(forward,n);
  if(aLength(tangent)<eps && aLength(fallback)<eps) return input;
  return aScale(aUnit(tangent,aUnit(fallback)),speed);
}
/** Hold time controls amplitude. Upswing timing and bounded chaining add skill.
 * No bonus at <=60 ms; aim cannot flip horizontal travel on release.
 */
export function advancedReleaseVelocity(v: AVec, seconds: number, radial: AVec,
  forward: AVec, maximum: number, flow=0, jumpKick=false): AVec {
  const input=limitFeelVelocity(v,maximum), t=Number.isFinite(seconds)?Math.max(0,seconds):0;
  const gate=smooth((t-.06)/.16);
  if(gate===0)return input;
  const charge=aClamp(t/ADVANCED_TUNING.releaseFullCharge,0,1);
  const n=aUnit(radial,{x:0,y:-1,z:0}), tangent=aReject(input,n);
  const timing=smooth(tangent.y/24)*smooth((-n.y+.15)/.45);
  const chain=aClamp(flow,0,ADVANCED_TUNING.chainMaximum)*.65;
  const targetUp=ADVANCED_TUNING.shortReleaseUp+(ADVANCED_TUNING.chargedReleaseUp-ADVANCED_TUNING.shortReleaseUp)*charge
    +timing*ADVANCED_TUNING.timingUpBonus+(jumpKick?3:0);
  // A quick release while descending keeps the dive instead of turning every
  // click into the same upward launch. Holding, trough timing and jump-kick
  // still earn the large aerial release.
  const liftGate=input.y < -2 && charge < .42 ? gate*charge*.35 : gate;
  const y=input.y+Math.max(0,targetUp-input.y)*liftGate;
  const horizontalSpeed=Math.hypot(input.x,input.z);
  const boost=(ADVANCED_TUNING.shortReleaseForward+(ADVANCED_TUNING.chargedReleaseForward-ADVANCED_TUNING.shortReleaseForward)*charge
    +timing*ADVANCED_TUNING.timingForwardBonus+chain+(jumpKick?3:0))*gate;
  const retained=Math.sqrt(Math.max(0,aLength(input)**2-y*y));
  const direction=aUnit(flat(input),aUnit(flat(forward)));
  return limitFeelVelocity({x:direction.x*Math.max(retained,horizontalSpeed+boost),y,z:direction.z*Math.max(retained,horizontalSpeed+boost)},maximum);
}
/** Full 3-D turns are not needed for air-zips/corner assistance. */
export function turnHorizontal(v: AVec, wish: AVec, dt: number, rate: number): AVec {
  const speed=Math.hypot(v.x,v.z), from=aUnit(flat(v)), to=aUnit(flat(wish),from);
  const angle=Math.atan2(from.x*to.z-from.z*to.x,aDot(from,to));
  const turn=aClamp(angle,-rate*Math.max(0,dt),rate*Math.max(0,dt));
  return {x:(from.x*Math.cos(turn)-from.z*Math.sin(turn))*speed,y:v.y,
    z:(from.x*Math.sin(turn)+from.z*Math.cos(turn))*speed};
}
/** Controlled glide: turning/pitch exchange direction, drag removes speed, and
 * the final energy bound prevents level flight or repeated pull-up energy gain.
 * No lift/forward thrust is created by pressing G again.
 */
export function glideVelocity(v: AVec, forward: AVec, pitch: number, dt: number, gravity: number, maximum: number): AVec {
  const input=limitFeelVelocity(v,maximum), h=aClamp(dt,0,.05);
  if(h===0)return input;
  const g=Math.max(0,gravity), speed=aLength(input);
  let out=turnHorizontal({...input,y:input.y-g*h},forward,h,1.9);
  const s=aLength(out), horizontal=Math.hypot(out.x,out.z);
  const stall=smooth((speed-13)/15);
  const targetPitch=-.065+aClamp(pitch,-1,1)*.65*stall-(1-stall)*.8;
  const currentPitch=Math.atan2(out.y,horizontal);
  const nextPitch=currentPitch+aClamp(targetPitch-currentPitch,-1.45*h,1.45*h);
  const direction=aUnit(flat(out),aUnit(flat(forward)));
  out={x:direction.x*Math.cos(nextPitch)*s,y:Math.sin(nextPitch)*s,z:direction.z*Math.cos(nextPitch)*s};
  // Account for the height implied by this semi-implicit tick before spending
  // remaining kinetic energy. Collision can only shorten this proposed motion.
  const dragPower=(1.2+.014*speed*speed)*(1+.9*Math.max(0,pitch));
  // Solve 0.5*u^2 + g*u*sin(pitch)*dt <= 0.5*v^2 - drag*dt.
  const b=g*Math.sin(nextPitch)*h;
  const energySpeed=Math.max(0,-b+Math.sqrt(Math.max(0,b*b+speed*speed-2*dragPower*h)));
  return aScale(aUnit(out),Math.min(energySpeed,maximum));
}
export function chargedJumpVelocity(v: AVec, held: number, jumpSpeed: number, maximum: number): AVec {
  const charge=smooth(held/ADVANCED_TUNING.chargeJumpSeconds);
  return limitFeelVelocity({...v,y:Math.max(v.y,jumpSpeed+(ADVANCED_TUNING.chargeJumpUp-jumpSpeed)*charge)},maximum);
}
export function slingshotVelocity(v: AVec, direction: AVec, held: number, maximum: number): AVec {
  const charge=smooth(held/ADVANCED_TUNING.slingChargeSeconds);
  const f=aUnit(flat(direction));
  const pitch=aClamp(Math.atan2(direction.y,Math.hypot(direction.x,direction.z)),.32,1.12);
  const speed=55+(ADVANCED_TUNING.slingForward-55)*charge;
  return limitFeelVelocity({x:f.x*Math.cos(pitch)*speed,y:Math.max(v.y,Math.sin(pitch)*speed),z:f.z*Math.cos(pitch)*speed},maximum);
}
export function pointLaunchVelocity(v: AVec, direction: AVec, perfect: boolean, maximum: number): AVec {
  const f=aUnit(flat(direction),aUnit(flat(v))), speed=Math.max(38,Math.hypot(v.x,v.z))+(perfect?15:7);
  return limitFeelVelocity({x:f.x*speed,y:Math.max(v.y,perfect?25:19),z:f.z*speed},maximum);
}
/** Signed angle around a fixed loop plane. Accumulate actual motion, not a timer. */
export function loopAngle(previous: AVec,next: AVec,axis: AVec): number {
  const n=aUnit(axis),a=aUnit(aReject(previous,n)),b=aUnit(aReject(next,n));
  return Math.atan2(aDot(n,aCross(a,b)),aClamp(aDot(a,b),-1,1));
}
export function swingPhase(seconds:number,vertical:number,radial:AVec): AdvancedRuntime['phase'] {
  if(seconds<.14)return 'catch';
  if(radial.y<-.82&&Math.abs(vertical)<9)return 'trough';
  if(Math.abs(vertical)<3)return 'apex';
  return vertical<0?'downswing':'upswing';
}

/** Authored wind can add energy, but must not brake a fast character to 35 m/s. */
export function advancedWindVelocity(v: AVec, direction: AVec, heightError: number,
  weight: number, dt: number, maximum: number): AVec {
  const h=aClamp(dt,0,.05), w=aClamp(weight,0,1);
  const out=turnHorizontal(v,direction,h,1.6*w), f=aUnit({x:out.x,y:0,z:out.z},aUnit({x:direction.x,y:0,z:direction.z}));
  const horizontal=Math.hypot(out.x,out.z), target=Math.max(horizontal,92);
  const next=Math.min(target,horizontal+32*w*h);
  const y=out.y+(30+aClamp(heightError*1.8,-10,12)-out.y*1.2)*w*h;
  return limitFeelVelocity({x:f.x*next,y,z:f.z*next},maximum);
}
