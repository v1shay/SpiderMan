import assert from 'node:assert/strict';
import { RaceSession,createRaceCourse,validRaceCourse } from '../lib/race-session.ts';
import {swingPreset} from '../lib/swing-profile.ts';
import {raceRoutePoints,RaceWorldVisuals} from '../lib/race-world.ts';
import * as THREE from 'three';
const start=[0,30,0];
const course={...createRaceCourse(start,350,320,12,-1,{mapId:'fixture',sample:(desired,_type,radius)=>({position:[desired[0],35,desired[2]],radius})}),swingProfile:swingPreset()};
assert.ok(validRaceCourse(course));assert.equal(course.gates,undefined);assert.deepEqual(raceRoutePoints(course),[course.finish]);
assert.deepEqual(createRaceCourse(start,350,320,12),createRaceCourse(start,350,320,12));
assert.notEqual(createRaceCourse(start,350,320,12,course.side).side,course.side);
assert.equal(validRaceCourse({...course,swingProfile:{...course.swingProfile,values:{gravity:1e50}}}),false);
const sessions=[],packets=[],teleports=[],finished=[];
const ids=['host-0000','guest-0001','guest-0002'];
for(const id of ids)sessions.push(new RaceSession(id,{send:p=>packets.push(p),teleport:p=>teleports.push({id,p}),started:()=>{},finished:(c,t)=>finished.push({id,c,t})}));
const deliver=()=>{while(packets.length){const p=packets.shift();for(const s of sessions)s.receive(structuredClone(p),p.sentAt+20);}};
const host=sessions[0];assert.equal(host.invite(course,1000,2,'destination-test'),true);deliver();
assert.equal(teleports.length,0,'invitation must not move spectators');
for(const s of sessions.slice(1))s.accept(1200);deliver();
host.tick(9001,start);deliver();
assert.equal(teleports.length,3);assert.equal(host.participants.size,3);
for(const s of sessions){assert.deepEqual(s.course,host.course);assert.equal(s.startAt,host.startAt);s.tick(host.startAt,start);}
// No intermediate checkpoint requirements. Approach from either side and cross
// the finish between frames without needing a sampled position inside it.
for(const [i,s] of sessions.entries()){
 const finish=course.finish;
 const before=[finish[0]-20,finish[1],finish[2]],after=[finish[0]+20,finish[1],finish[2]];
 s.tick(s.startAt+20000+i*1000,before);
 s.tick(s.startAt+20400+i*1000,after);deliver();
 assert.equal(s.phase,'finished');
}
for(const s of sessions){assert.equal(s.results.size,3);assert.deepEqual([...s.results.keys()],ids);}
assert.equal(finished.length,3);
const scene=new THREE.Scene(),visuals=new RaceWorldVisuals(scene);
visuals.setCourse(course,{});visuals.update(start,0);
assert.ok(visuals.root.visible);assert.equal(visuals.lanes.length,0);assert.deepEqual(visuals.root.getObjectByName('race-destination').position.toArray(),course.finish);
visuals.dispose();
console.log('PASS single destination, map-authored point, early marker, shared physics, 3 players, countdown, swept arrival and consistent ranking');
