import {createClient} from '@supabase/supabase-js';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {RaceSession,createRaceCourse} from '../lib/race-session.ts';
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;if(!url||!key)throw Error('Realtime configuration is missing');
const clients=[0,1].map(()=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}));
const topic=`spiderman:verification-race-${crypto.randomUUID()}`,ids=['race-test-host','race-test-guest'],moves=[],packets=[];
const channels=clients.map((c,i)=>c.channel(topic,{config:{private:true,broadcast:{self:false,ack:true},presence:{key:ids[i]}}}));
const sessions=channels.map((channel,i)=>new RaceSession(ids[i],{send:p=>{packets.push({type:p.type,sender:p.sender});void channel.send({type:'broadcast',event:'race',payload:p});},teleport:p=>moves.push({id:ids[i],point:p}),started:()=>{},finished:()=>{}}));
const wait=async predicate=>{const until=Date.now()+10000;while(!predicate()&&Date.now()<until)await new Promise(r=>setTimeout(r,50));assert.ok(predicate(),'Timed out waiting for Realtime race packet')};
try{
 await Promise.all(channels.map((channel,i)=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Private Realtime subscribe timed out')),15000);channel.on('presence',{event:'sync'},()=>{}).on('broadcast',{event:'race'},({payload})=>sessions[i].receive(payload,Date.now())).subscribe(async(status,error)=>{if(status==='SUBSCRIBED'){clearTimeout(timeout);await channel.track({playerId:ids[i]});resolve();}else if(['CHANNEL_ERROR','TIMED_OUT'].includes(status)){clearTimeout(timeout);reject(error??Error(status));}});})));await wait(()=>Object.keys(channels[0].presenceState()).length===2);
 const course=createRaceCourse([0,30,0],350,320,12);sessions[0].invite(course,Date.now(),1,'verified-race');await wait(()=>sessions[1].phase==='invited');assert.equal(moves.length,0);
 sessions[1].accept(Date.now());await wait(()=>sessions[0].participants.size===2);
 await new Promise(r=>setTimeout(r,8100));sessions[0].tick(Date.now(),course.start);await wait(()=>sessions[1].phase==='countdown');assert.deepEqual(sessions[0].course,sessions[1].course);assert.equal(sessions[0].startAt,sessions[1].startAt);assert.equal(moves.length,2);
 await fs.writeFile('docs/verification/race-realtime.json',JSON.stringify({passed:true,transport:'Supabase private Realtime WebSockets',isolatedTopic:true,presencePlayers:2,sameCourse:true,sameStartTime:true,moves,packets},null,2)+'\n');console.log('PASS: two real private Realtime clients, presence, invite, explicit acceptance, synchronized course and countdown.');
}finally{await Promise.all(clients.map((c,i)=>c.removeChannel(channels[i])));clients.forEach(c=>c.realtime.disconnect());}
