import assert from 'node:assert/strict';
import { chargedSwingRelease, steerSwingTangent, arcadeWallRunVelocity,
  arcadeAirZipVelocity, hasWallRunSupport, SPIDER_TRAVERSAL_FEEL } from '../lib/traversal-feel.ts';
const v = (x=0,y=0,z=0) => ({x,y,z});
const speed = a => Math.hypot(a.x,a.y,a.z);
const near = (a,b,tolerance=1e-8) => assert.ok(Math.abs(a-b)<tolerance, `${a} != ${b}`);
const checks = [];
function test(name, fn) { fn(); checks.push(name); console.log('PASS', name); }
const cap=SPIDER_TRAVERSAL_FEEL.maximumSpeed;
test('zero-duration and sub-catch taps add no energy', () => {
  for (const t of [0,.01,.05,.06]) assert.deepEqual(chargedSwingRelease(v(20,-8,-25),t,v(0,0,-1),cap),v(20,-8,-25));
});
test('hold duration provides increasing upward launch from the same state', () => {
  let previous=-Infinity;
  for (const seconds of [.06,.08,.12,.16,.22,.25,.5,.75,1,1.2,2]) {
    const r=chargedSwingRelease(v(0,-5,-30),seconds,v(0,0,-1),cap);
    assert.ok(r.y>=previous-1e-8); previous=r.y;
  }
});
test('charged release does not destroy a fast fall’s total kinetic speed', () => {
  const original=v(0,-85,-25);
  const r=chargedSwingRelease(original,1.2,v(0,0,-1),cap);
  assert.ok(r.y>0); assert.ok(speed(r)>=speed(original)-1e-8); assert.ok(speed(r)<=cap+1e-8);
});
test('existing upward momentum survives an unsaturated release', () => {
  const r=chargedSwingRelease(v(0,55,-15),1.2,v(0,0,-1),cap); near(r.y,55);
});
test('sideways input steers a capped swing without speed loss', () => {
  const r=steerSwingTangent(v(0,0,-94),v(0,-1,0),v(1,0,-1),1/120,22);
  assert.ok(r.x>0); near(speed(r),94);
});
test('swing steering preserves the radial component', () => {
  const r=steerSwingTangent(v(20,6,-30),v(0,-1,0),v(-1,0,0),1/60,22); near(r.y,6); near(speed(r),speed(v(20,6,-30)));
});
test('head-on wall contact redirects rather than deleting speed', () => {
  const input=v(50,-8,0);
  const r=arcadeWallRunVelocity(input,v(-1,0,0),v(1,0,-1),speed(input),cap,18,6);
  assert.ok(r.y>=6); assert.ok(Math.abs(r.z)>45); near(r.x,.8); assert.ok(speed(r)>=speed(input)-1e-6);
});
test('wall run maintains height and speed for two seconds of measured contact', () => {
  const incoming=v(32,-8,-20); const entry=speed(incoming);
  let velocity=arcadeWallRunVelocity(incoming,v(-1,0,0),v(0,0,-1),entry,cap,18,6);
  let height=10;
  for (let i=0;i<240;i++) {
    velocity=arcadeWallRunVelocity(velocity,v(-1,0,0),v(0,0,-1),entry,cap,18,6);
    height+=velocity.y/120;
  }
  assert.ok(height>=22-1e-8); assert.ok(speed(velocity)>=entry-1e-8);
});
test('S is an explicit wall descent override', () => {
  const r=arcadeWallRunVelocity(v(0,6,-30),v(-1,0,0),v(0,0,-1),30,cap,18,6,-1); assert.ok(r.y<0);
});
test('only a previously active run gets contact grace; a crawl does not', () => {
  assert.equal(hasWallRunSupport({feetTouching:false,graceSeconds:.08}),false);
  assert.equal(hasWallRunSupport({feetTouching:false,graceSeconds:.08,runEntrySpeed:30}),true);
  assert.equal(hasWallRunSupport({feetTouching:false,graceSeconds:0,runEntrySpeed:30}),false);
});
test('air zip accelerates forward without adding upward speed', () => {
  let r=v(0,0,-25); const position=v();
  for(let i=0;i<34;i++) { r=arcadeAirZipVelocity(r,v(0,0,-1),1/120,88,cap,29); position.y+=r.y/120; position.z+=r.z/120; }
  assert.ok(-r.z>80); assert.ok(r.y<0); assert.ok(position.y<0); assert.ok(-position.z>14);
});
test('air zip does not kill inherited upward momentum', () => {
  const r=arcadeAirZipVelocity(v(0,25,-30),v(0,0,-1),1/120,88,cap,29); near(r.y,25-29/120);
});
test('air zip does not erase speed already above the zip target', () => {
  const r=arcadeAirZipVelocity(v(0,0,-90),v(0,0,-1),1/120,88,cap,0); near(r.z,-90);
});
test('air zip turns at a bounded rate rather than snapping heading', () => {
  const r=arcadeAirZipVelocity(v(0,0,-50),v(0,0,1),1/120,88,cap,0); assert.ok(r.z<0);
  assert.ok(Math.acos(-r.z/Math.hypot(r.x,r.z))<=4/120+1e-8);
});
test('invalid velocities are rejected, not silently made into NaN transforms', () => {
  assert.throws(()=>chargedSwingRelease(v(NaN),1,v(0,0,-1),cap),RangeError);
});
let seed=2099;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
test('2,000 generated release/steer/wall/zip cases stay finite and bounded', () => {
  for(let i=0;i<2000;i++) {
    let incoming=v(random()*120-60,random()*120-60,random()*120-60);
    const old=speed(incoming); if(old>cap) incoming={x:incoming.x*cap/old,y:incoming.y*cap/old,z:incoming.z*cap/old};
    const yaw=random()*Math.PI*2, normal=v(Math.cos(yaw),0,Math.sin(yaw));
    const desired=v(random()-.5,random()-.5,random()-.5);
    const outputs=[chargedSwingRelease(incoming,random()*2,desired,cap),
      arcadeWallRunVelocity(incoming,normal,desired,speed(incoming),cap,18,6),
      arcadeAirZipVelocity(incoming,desired,1/120,88,cap,29),
      steerSwingTangent(incoming,normal,desired,1/120,22)];
    for(const out of outputs) { assert.ok(Object.values(out).every(Number.isFinite)); assert.ok(speed(out)<=cap+1e-6); }
    assert.ok(speed(outputs[0])>=speed(incoming)-1e-6);
    assert.ok(outputs[2].y<=incoming.y+1e-8);
    near(speed(outputs[3]),speed(incoming),1e-6);
  }
});
console.log(`\n${checks.length} math checks passed (including 2,000 generated cases).`);
console.log('These are policy/helper tests, not a browser, asset, or complete game integration test.');
const short=chargedSwingRelease(v(0,0,-30),.25,v(0,0,-1),cap);
const long=chargedSwingRelease(v(0,0,-30),1.2,v(0,0,-1),cap);
console.log(JSON.stringify({releaseFromSameState:{shortHoldSeconds:.25,longHoldSeconds:1.2,
  shortVelocity:short,longVelocity:long,
  shortBallisticRise:short.y**2/(2*29),longBallisticRise:long.y**2/(2*29)},wallRun:{entrySpeed:speed(v(32,-8,-20)),gainInTwoSeconds:12}},null,2));
