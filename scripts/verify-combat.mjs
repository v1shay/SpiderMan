import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BossSystem } from '../lib/boss-system.ts';
import { BOSS_DEFINITIONS } from '../lib/boss-definitions.ts';
import { prepareBossClips } from '../lib/boss-visuals.ts';
import { createAttackClock, advanceAttack, canAttackHit, registerAttackHit, PlayerCombatState, sweptSphereHit } from '../lib/combat-system.ts';

const v = (x=0,y=0,z=0) => ({x,y,z});
const world = { groundAt:()=>0, move:(_from,to)=>({...to}), lineOfSight:()=>true };
const player = (position=v(3),rest={}) => ({position,velocity:v(),grounded:true,traversalMode:'idle',...rest});
const timing = {startup:.6,active:.1,recovery:.5};
const clock = createAttackClock();
advanceAttack(clock,.59); assert.equal(canAttackHit(clock,timing,'player'),false);
advanceAttack(clock,.15); assert.equal(canAttackHit(clock,timing,'player'),true);
registerAttackHit(clock,'player'); assert.equal(canAttackHit(clock,timing,'player'),false);
assert.equal(sweptSphereHit(v(-100),v(100),v(),.65),true);
assert.equal(sweptSphereHit(v(-100,2),v(100,2),v(),.65),false);
const defender = new PlayerCombatState(); defender.step(.01,false,true);
assert.equal(defender.damage(40),false); defender.step(.5,false,false);
assert.equal(defender.damage(40),true); assert.equal(defender.health,60); assert.equal(defender.damage(40),false);
console.log('PASS active intervals, single-hit dedupe, swept projectiles, dodge and hurt immunity');

const trials=[];
for (const id of Object.keys(BOSS_DEFINITIONS)) {
  const system = new BossSystem(); system.start(id,v(),world);
  const before = system.snapshot();
  // Startup never deals damage, even with the hero in contact.
  for(let i=0;i<105;i++)system.step(1/60,player({...system.snapshot().position}),world);
  assert.equal(system.snapshot().playerHealth,100, `${id}: damage during attack startup`);
  system.retry();
  const events={};let escapeHeight=0,phaseTwoCheckpoint=null;
  for(let i=0;i<30000;i++){
    const s=system.snapshot();
    const result=system.step(1/60,player(v(s.position.x+3,s.position.y,s.position.z),{grounded:false,traversalMode:'swing',attackPressed:i%35===0,webHeld:true,dodgePressed:i%60===0}),world);
    for(const e of result.events)events[e.type]=(events[e.type]??0)+1;
    if(s.escaping)escapeHeight=Math.max(escapeHeight,s.position.y);
    if(s.phase===2&&!s.escaping)phaseTwoCheckpoint=system.checkpointPosition;
    if(system.snapshot().status!=='active')break;
  }
  const final=system.snapshot();assert.equal(final.status,'victory',id);assert.equal(final.phase,3);
  assert.equal(events.phase,2);assert.equal(events.victory,1);assert.ok(events.restrained>=1);
  assert.ok(escapeHeight>=17,`${id}: phase escape must actually leave the roof`);
  assert.ok(phaseTwoCheckpoint);
  system.retry(); assert.equal(system.snapshot().status,'active');assert.equal(system.snapshot().playerHealth,100);
  assert.equal(system.snapshot().phase,3);assert.deepEqual(system.snapshot().projectiles,[]);
  assert.equal(system.snapshot().attack,null);assert.ok(system.snapshot().health>0);
  system.stop();assert.equal(system.snapshot(),null);
  trials.push({id,events,escapeHeight,finalHealth:final.playerHealth,start:before.position});
}
console.log('PASS three complete encounters, three phases, traversal escapes, web counterplay, victory, checkpoint retry and stop');

// Let an actual boss attack kill a stationary player, then retry without stale hitboxes.
const doomed = new BossSystem();doomed.start('venom',v(),world);
for(let i=0;i<10000&&doomed.snapshot().status==='active';i++)doomed.step(1/60,player(v(doomed.snapshot().position.x+2,doomed.snapshot().position.y,doomed.snapshot().position.z)),world);
assert.equal(doomed.snapshot().status,'dead');doomed.retry();assert.equal(doomed.snapshot().playerHealth,100);
assert.equal(doomed.snapshot().status,'active');
console.log('PASS damage can defeat hero; retry clears death and attack state');

const charge = new BossSystem();charge.start('hulk',v(),world);
let stagger=false;
const blocked={...world,move:(from,to)=>to.x>3?v(3,to.y,to.z):to};
for(let i=0;i<500;i++){
 const result=charge.step(1/60,player(v(12)),blocked);
 if(result.events.some(e=>e.type==='wall-stagger')){stagger=true;break;}
}
assert.ok(stagger);assert.ok(charge.snapshot().vulnerable>3);
console.log('PASS luring Hulk into geometry creates a real vulnerability window');

const protectedPlayer = new BossSystem(); protectedPlayer.start('ironman',v(),world);
let projectileSeen = false;
// Acquiring a target is allowed, but each small projectile segment crossing the
// thin plane is occluded. This exercises missile/world checks after firing.
const cover = {...world,lineOfSight:(a,b)=>Math.abs(a.x-b.x)>5 || !(a.x<8&&b.x>=8)};
for(let i=0;i<240;i++){
 protectedPlayer.step(1/60,player(v(20,8)),cover);
 projectileSeen ||= protectedPlayer.snapshot().projectiles.length>0;
}
assert.ok(projectileSeen);
assert.equal(protectedPlayer.snapshot().playerHealth,100,'thin cover must intercept projectiles before hero damage');
// Direct segment predicate additionally documents a thin wall crossing that a
// point-only collision test would miss.
assert.equal(cover.lineOfSight(v(7.99),v(8.01)),false);
console.log('PASS fast projectiles consult geometry segments across a thin wall');

const airborne = new BossSystem(); airborne.start('ironman',v(),world);
let aimedHigh = false;
for(let i=0;i<240;i++){
 airborne.step(1/60,player(v(20,8)),world);
 const s=airborne.snapshot();if(s.attack){assert.equal(s.attack.target.y,8);aimedHigh=true;}
}
assert.ok(aimedHigh);assert.ok(airborne.snapshot().playerHealth<100,'unobstructed repulsor must hit actual airborne player height');
console.log('PASS Iron Man projectile targeting preserves airborne player height');

for(const id of ['hulk','venom']){
 const rooftop={groundAt:p=>Math.abs(p.x)<20&&Math.abs(p.z)<20&&p.y>=159?160:0,
   move:(from,to)=>Math.abs(to.x)<20&&Math.abs(to.z)<20&&to.y<159.9&&to.y>0?from:to,lineOfSight:()=>true};
 const pursuit=new BossSystem();pursuit.start(id,v(0,160),rooftop);let pursuing=false,lowest=160,maxX=0;
 for(let i=0;i<480;i++){
  pursuit.step(1/60,player(v(65,0)),rooftop);
  const s=pursuit.snapshot();pursuing ||= s.pursuing;lowest=Math.min(lowest,s.position.y);maxX=Math.max(maxX,s.position.x);
 }
 assert.ok(pursuing,`${id} must pursue vertically separated hero`);
 assert.ok(lowest<2&&maxX>60,`${id} must leap off the high roof to real street support`);
}
console.log('PASS Hulk and Venom pursue from a 160m rooftop to the street using a swept arc');

const loader = new GLTFLoader();
loader.register(parser=>{parser.loadTextureImage=()=>Promise.resolve(new THREE.Texture());return{name:'combat-test-skip-images'};});
const manifests=JSON.parse(fs.readFileSync('public/assets/bosses/manifest.json'));
for(const [id,definition]of Object.entries(BOSS_DEFINITIONS)){
 const bytes=fs.readFileSync(`public${definition.asset}`);
 const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const clips=prepareBossClips(gltf.animations), names=new Set(clips.map(c=>c.name));
 for(const name of [...Object.values(definition.clips),...definition.attacks.map(a=>a.clip)])assert.ok(names.has(name),`${id} missing ${name}`);
 const nodeNames=new Set();gltf.scene.traverse(o=>nodeNames.add(o.name));
 const root=gltf.scene;root.rotation.y=definition.modelYaw;
 const setupMixer=new THREE.AnimationMixer(root);setupMixer.clipAction(clips.find(c=>c.name===definition.clips.idle)).play();setupMixer.update(0);
 root.updateMatrixWorld(true);const initialBounds=new THREE.Box3().setFromObject(root,true), initialCenter=initialBounds.getCenter(new THREE.Vector3());
 const scale=definition.height/initialBounds.getSize(new THREE.Vector3()).y;
 root.scale.multiplyScalar(scale);root.position.set(-initialCenter.x*scale,-initialBounds.min.y*scale,-initialCenter.z*scale);setupMixer.stopAllAction();
 const rootPosition=root.position.clone();
 let tracks=0,poseSamples=0,maxHorizontalCenter=0,maxExtent=0,minFeet=0;
 for(const clip of clips){
  for(const track of clip.tracks){assert.ok(nodeNames.has(THREE.PropertyBinding.parseTrackName(track.name).nodeName),`${id}: unbound ${track.name}`);tracks++;}
  const mixer=new THREE.AnimationMixer(gltf.scene);mixer.clipAction(clip).play();
  for(let i=0;i<8;i++){
   mixer.setTime(clip.duration*i/8);gltf.scene.updateMatrixWorld(true);
   gltf.scene.traverse(o=>{if(o.isBone)assert.ok(o.matrixWorld.elements.every(Number.isFinite),`${id} nonfinite bone`);});poseSamples++;
   const box=new THREE.Box3().setFromObject(root,true), center=box.getCenter(new THREE.Vector3());
   assert.ok(root.position.equals(rootPosition),`${id}: animation moved the world/root placement`);
   maxHorizontalCenter=Math.max(maxHorizontalCenter,Math.hypot(center.x,center.z));
   maxExtent=Math.max(maxExtent,box.getSize(new THREE.Vector3()).length());minFeet=Math.min(minFeet,box.min.y);
   assert.ok(Math.hypot(center.x,center.z)<1.5,`${id}: animation escaped its horizontal hurtbox`);
   assert.ok(box.getSize(new THREE.Vector3()).length()<definition.height*2.5,`${id}: exploded skin bounds`);
  }
  mixer.stopAllAction();mixer.uncacheRoot(gltf.scene);
 }
 const m=manifests.find(m=>m.id===id);assert.ok(m.outputBytes<m.sourceBytes*.5);assert.ok(clips.length<=9);
 trials.find(t=>t.id===id).animation={clips:clips.length,tracks,poseSamples,outputBytes:m.outputBytes,maxHorizontalCenter,maxExtent,minFeetBeforeSupportCalibration:minFeet};
 console.log(`PASS ${id}: ${clips.length} native clips, ${tracks} bound tracks, ${poseSamples} finite poses; optimized asset ${(m.outputBytes/1e6).toFixed(2)}MB`);
}
fs.writeFileSync('docs/verification/combat-2026-09-17.json',JSON.stringify({scope:'Deterministic combat simulation + native rig/clip binding; browser visual timing reviewed separately.',trials},null,2)+'\n');
