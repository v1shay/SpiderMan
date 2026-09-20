'use client';

import Image from 'next/image';
import { useState, type CSSProperties } from 'react';
import { BOSS_DEFINITIONS, type BossId } from '@/lib/boss-definitions';
import type { ActivityAction, GameHud } from './SpiderGame';

export function ActivityHud({ hud, action }: { hud: GameHud; action: (action: ActivityAction) => void }) {
  const [open, setOpen] = useState(false);
  const boss = hud.boss;
  const mission = hud.mission;

  if (boss?.status === 'active') return null;
  if (boss) return (
    <aside className="boss-encounter-actions" aria-label="Boss encounter actions">
      <p>{boss.objective}</p>
      <div><button type="button" onClick={() => action('retry')}>Restart fight</button><button type="button" onClick={() => action('stop')}>Leave fight</button></div>
    </aside>
  );

  return (
    <aside className="city-activity" aria-label="City activities" data-open={open}>
      <button className="activity-launcher" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="activity-spider" aria-hidden="true">◈</span>
        <span><small>FRIENDLY NEIGHBORHOOD</small><b>{open ? 'CLOSE ACTIVITY MENU' : 'CITY ACTIVITIES'}</b></span>
      </button>
      {open && <div className="activity-menu">
        <header><small>SELECT ENCOUNTER</small><strong>THREATS IN THE CITY</strong></header>
        <div className="boss-picker">
          {(Object.keys(BOSS_DEFINITIONS) as BossId[]).map((id) => {
            const definition = BOSS_DEFINITIONS[id];
            return <button key={id} type="button" style={{ '--boss-accent': definition.accent } as CSSProperties} onClick={() => { action(id); setOpen(false); }}>
              <Image src={definition.portrait} alt="" width={96} height={96} unoptimized />
              <span><b>{definition.name}</b><small>{definition.subtitle}</small></span>
            </button>;
          })}
        </div>
        <header><small>NEIGHBORHOOD EVENTS</small></header>
        <div className="challenge-picker">
          {([['courier', 'Rooftop courier'], ['rescue', 'Emergency signal'], ['style', 'Flow challenge']] as const).map(([id, label]) =>
            <button key={id} type="button" onClick={() => { action(id); setOpen(false); }}>{label}</button>)}
        </div>
      </div>}
      {hud.activityMessage && <output className="activity-status">{hud.activityMessage}</output>}
      {mission && <section className="encounter-readout" aria-label="City objective"><header><b>{mission.name}</b><span>{Math.ceil(mission.remaining)}s</span></header><p>{mission.objective}</p><small>{mission.step}/{mission.steps} · Follow the cyan beacon</small><div><button type="button" onClick={() => action('retry')}>Retry objective</button><button type="button" onClick={() => action('stop')}>Leave objective</button></div></section>}
      {(hud.trickScore ?? 0) > 0 && <output className="flow-readout">{hud.trickScore?.toLocaleString()} PTS · FLOW ×{hud.flowMultiplier?.toFixed(1)}</output>}
    </aside>
  );
}
