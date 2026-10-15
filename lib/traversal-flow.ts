/** Public GDC-inspired traversal policy. These are our constants, not Insomniac's.
 * The motor owns position/collision; this module only shapes velocity and pivots.
 */
import { limitFeelVelocity, steerSwingHeading, type FeelVector } from './traversal-feel.ts';

export const FLOW = Object.freeze({
  cruiseSpeed: 38,
  pumpAcceleration: 26,
  steeringAcceleration: 68,
  catchSeconds: .24,
  wallCruiseSpeed: 27,
  wallMaximumSpeed: 48,
});
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const magnitude = (v: FeelVector) => Math.hypot(v.x, v.y, v.z);
const dot = (a: FeelVector, b: FeelVector) => a.x*b.x+a.y*b.y+a.z*b.z;
const scale = (v: FeelVector, s: number): FeelVector => ({x:v.x*s,y:v.y*s,z:v.z*s});
const unit = (v: FeelVector, fallback: FeelVector = {x:0,y:0,z:-1}) => magnitude(v) > 1e-7 ? scale(v,1/magnitude(v)) : {...fallback};
export function flowTangent(v: FeelVector, radial: FeelVector): FeelVector {
  const d=dot(v,radial);
  return {x:v.x-radial.x*d,y:v.y-radial.y*d,z:v.z-radial.z*d};
}

/** Move the simulation pivot onto the travel plane. The visible web stays on
 * its real facade. This removes the otherwise unavoidable street zig-zag. */
export function flowSwingPivot(position: FeelVector, anchor: FeelVector, forward: FeelVector): FeelVector {
  const f=unit({x:forward.x,y:0,z:forward.z});
  // A shoulder-level side attachment starts behind the bottom of an arc,
  // rather than immediately climbing vertically and losing forward travel.
  const ahead=Math.max(12, (anchor.x-position.x)*f.x+(anchor.z-position.z)*f.z);
  return {x:position.x+f.x*ahead,y:anchor.y,z:position.z+f.z*ahead};
}

/** Redirect gradually into the loaded arc without deleting dive energy. */
export function flowCatchVelocity(v: FeelVector, radial: FeelVector, dt: number): FeelVector {
  const tangent=flowTangent(v,radial), speed=magnitude(v);
  if(magnitude(tangent)<.1) return {...v};
  const target=scale(unit(tangent),speed), blend=1-Math.exp(-dt/FLOW.catchSeconds);
  const out={x:v.x+(target.x-v.x)*blend,y:v.y+(target.y-v.y)*blend,z:v.z+(target.z-v.z)*blend};
  return scale(unit(out,unit(v)),speed);
}

/** Normal release keeps the arc's exit angle. Space is a separate swing jump.
 * Holding longer never replaces descent with an arbitrary 35 m/s launch. */
export function flowReleaseVelocity(v: FeelVector, seconds: number, forward: FeelVector,
  maximum: number, jump: boolean, forwardScale=1, liftScale=1): FeelVector {
  const out=limitFeelVelocity(v,maximum);
  const gate=clamp((seconds-.06)/.18,0,1);
  if(!gate)return out;
  const f=unit({x:out.x,y:0,z:out.z},unit({x:forward.x,y:0,z:forward.z}));
  const speed=Math.hypot(out.x,out.z);
  const upswing=clamp(out.y/30,0,1);
  const boost=(jump ? 6*(1-upswing*.6) : 2.5)*gate*forwardScale*clamp((55-speed)/25,0,1);
  return limitFeelVelocity({x:out.x+f.x*boost,y:out.y+(jump ? (8+clamp(magnitude(out)*.08,0,4))*(.8+upswing*.4)*gate*liftScale : 0),z:out.z+f.z*boost},maximum);
}

/** Fast wall arrivals remain fast, while sustained running settles smoothly.
 * W/S are vertical on the facade; A/D use the camera's projected right axis. */
export function flowWallVelocity(v: FeelVector, normal: FeelVector, cameraForward: FeelVector,
  climb: number, strafe: number, dt: number, entry=false): FeelVector {
  const n=unit({x:normal.x,y:0,z:normal.z},{x:1,y:0,z:0});
  const side={x:n.z,y:0,z:-n.x};
  const right={x:-cameraForward.z,y:0,z:cameraForward.x};
  const rightSign=Math.abs(dot(right,side))>.12 ? Math.sign(dot(right,side)) : 1;
  const along=flowTangent(v,n);
  let wish={x:side.x*strafe*rightSign,y:climb,z:side.z*strafe*rightSign};
  if(magnitude(wish)<.1) {
    wish=entry && magnitude(along)<4 ? {x:0,y:1,z:0} : unit(along,{x:0,y:1,z:0});
  }
  const incomingSpeed=entry ? magnitude(v) : magnitude(along);
  const speed=clamp(entry ? Math.max(18,incomingSpeed*.9)
    : incomingSpeed+(FLOW.wallCruiseSpeed-incomingSpeed)*(1-Math.exp(-1.2*dt)),12,FLOW.wallMaximumSpeed);
  const target=scale(unit(wish),speed), blend=entry ? 1 : 1-Math.exp(-9*dt);
  const mixed={x:along.x+(target.x-along.x)*blend,y:along.y+(target.y-along.y)*blend,z:along.z+(target.z-along.z)*blend};
  // Rotation can pass through zero during a reversal: use the requested side.
  const out=scale(unit(mixed,unit(wish)),speed);
  return {x:out.x-n.x*.8,y:out.y,z:out.z-n.z*.8};
}

export function flowSwingSteering(v: FeelVector, wish: FeelVector, radial: FeelVector,
  seconds: number, dt: number, acceleration: number): FeelVector {
  const trough=clamp(-radial.y,0,1);
  const ramp=clamp(seconds/.16,0,1);
  return steerSwingHeading(v,wish,dt,Math.max(FLOW.steeringAcceleration,acceleration)*(.45+.55*trough)*ramp);
}
