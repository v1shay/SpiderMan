'use client';
import { Flag, Moon, Sun } from 'lucide-react';
import {formatRaceTime,type RaceView} from '@/lib/race-session';
import type {RaceAction} from './SpiderGame';
export function RaceHud({view,action,night,onNight}:{view:RaceView;action:(a:RaceAction)=>void;night:boolean;onNight:()=>void}){
 const busy=['inviting','countdown','racing'].includes(view.phase);
 return <>
  <section className="race-hologram" aria-label="Race timer and personal best" data-phase={view.phase}>
   <div><small>{view.phase==='countdown'?'LAUNCH IN':view.phase==='racing'?'TIME TRIAL':view.phase==='finished'?'FINISH':'SKYLINE RACING'}</small><strong>{view.phase==='countdown'?view.countdown:formatRaceTime(view.time)}</strong></div>
   <i/><div><small>PERSONAL BEST</small><b>{formatRaceTime(view.best)}</b><em>{view.ghost?'GHOST READY':'MAKE YOUR MARK'}</em></div>
   {view.course&&<div className="race-guidance"><b>{view.distance} m</b><small>{view.wind?'WIND TUNNEL':view.message}</small></div>}
  </section>
  <aside className="race-actions" aria-label="Race controls">
   <button type="button" onClick={()=>action(busy?'cancel':'invite')}><Flag size={16}/>{busy?'Leave race':'Challenge lobby'}</button>
   {!busy&&view.best!==null&&<button type="button" onClick={()=>action('pb')}>Race my ghost</button>}
   <button type="button" onClick={onNight} aria-label={night?'Switch to golden hour':'Switch to night'}>{night?<Sun size={16}/>:<Moon size={16}/>}<span>{night?'Golden hour':'Nightfall'}</span></button>
  </aside>
  {view.phase==='invited'&&<section className="race-invitation" aria-live="polite"><small>LOBBY CHALLENGE</small><strong>A race across New York</strong><span>{view.distance} m · shared start · {view.countdown}s to join</span><div><button type="button" onClick={()=>action('accept')}>Accept race</button><button type="button" onClick={()=>action('decline')}>Keep exploring</button></div><small>{view.message}</small></section>}
  {view.phase==='inviting'&&<output className="race-toast">{view.participants} ready · launch in {view.countdown}s</output>}
  {view.phase==='countdown'&&<div className="race-countdown" aria-live="assertive">{view.countdown||'GO'}</div>}
  {view.phase==='finished'&&<section className="race-results" aria-label="Race results"><strong>{view.message}</strong>{view.results.map((r,i)=><div key={r.id}><span>{i+1}. Spider {r.id.slice(0,4)}</span><b>{formatRaceTime(r.time)}</b></div>)}</section>}
 </>;
}
