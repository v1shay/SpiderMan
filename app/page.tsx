'use client';

import Image from 'next/image';
import { Activity, Gauge, Move3d, Navigation, Radio, Rotate3d } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { GameHud, SpiderGameHandle } from '@/components/game/SpiderGame';
import { SpideyTracker } from '@/components/game/SpideyTracker';
import { DISTRICTS, SUITS, type DistrictId, type SuitId } from '@/lib/game-config';

const SpiderGame = lazy(() => import('@/components/game/SpiderGame'));

type Phase = 'select' | 'loading' | 'game';

export default function Home() {
  const [selected, setSelected] = useState<SuitId>('advanced');
  const [phase, setPhase] = useState<Phase>('select');
  const [status, setStatus] = useState('Waiting for suit selection');
  const [progress, setProgress] = useState(0);
  const [trackerOpen, setTrackerOpen] = useState(false);
  const [loadedDistricts, setLoadedDistricts] = useState<Set<DistrictId>>(() => new Set());
  const [currentDistrict, setCurrentDistrict] = useState<DistrictId>('times-square');
  const [hud, setHud] = useState<GameHud>({ speed: 0, altitude: 0, fps: 60, swinging: false });
  const gameRef = useRef<SpiderGameHandle>(null);
  const activeSuit = SUITS.find((suit) => suit.id === selected) ?? SUITS[0];
  const activeDistrict = DISTRICTS.find((district) => district.id === currentDistrict) ?? DISTRICTS[0];

  useEffect(() => { void import('@/lib/analytics').then(({ trackVisit }) => trackVisit()); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Escape' && phase === 'game') setTrackerOpen((open) => !open);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  const enterCity = () => {
    setLoadedDistricts(new Set());
    setStatus(`Preparing ${activeSuit.name}`);
    setProgress(1);
    setPhase('loading');
  };

  const travelTo = (district: DistrictId) => {
    setStatus(`Route selected: ${DISTRICTS.find((item) => item.id === district)?.name ?? 'New York'}`);
    gameRef.current?.travelTo(district);
    setTrackerOpen(false);
  };

  if (phase === 'select') {
    return (
      <main className="launch-screen">
        <div className="city-haze" aria-hidden="true" />
        <header className="launch-header">
          <div className="brand-lockup" aria-label="New York Spider-Man"><span className="brand-kicker">Spider-Man</span><span className="brand-title">New York</span></div>
          <div className="system-ready"><span /> Systems ready</div>
        </header>

        <section className="selector-shell" aria-labelledby="select-heading">
          <div className="selector-heading">
            <div><p className="eyebrow">Suit archive // 05 found</p><h1 id="select-heading">Choose your Spider-Man</h1></div>
            <p className="selector-copy">Every hero moves differently. Pick a suit, enter Manhattan, and own the skyline.</p>
          </div>
          <ul className="suit-grid" aria-label="Available Spider-Man suits">
            {SUITS.map((suit, index) => (
              <li key={suit.id}>
                <button className={`suit-card ${selected === suit.id ? 'is-selected' : ''}`} onClick={() => setSelected(suit.id)} type="button" aria-pressed={selected === suit.id}>
                  <span className="card-index">0{index + 1}</span>
                  <span className="portrait-wrap"><Image src={suit.image} alt={`${suit.name} suit`} fill sizes="(max-width: 700px) 70vw, 20vw" priority={index < 3} /></span>
                  <span className="card-scan" aria-hidden="true" />
                  <span className="suit-meta"><strong>{suit.name}</strong><small>{suit.universe}</small></span>
                </button>
              </li>
            ))}
          </ul>
          <footer className="selector-footer">
            <div className="selection-readout"><span>Selected suit</span><strong>{activeSuit.name}</strong></div>
            <button className="enter-city" type="button" onClick={enterCity}>Enter New York <span aria-hidden="true">→</span></button>
          </footer>
        </section>
        <p className="build-mark">NYC // Build 01.08.28</p>
      </main>
    );
  }

  return (
    <main className="game-shell">
      <Suspense fallback={null}>
        <SpiderGame
          ref={gameRef}
          suitId={selected}
          onReady={() => setPhase('game')}
          onStatus={(message, nextProgress) => { setStatus(message); setProgress(Math.round(nextProgress)); }}
          onHud={setHud}
          onLoadedDistricts={setLoadedDistricts}
          onDistrictChange={setCurrentDistrict}
        />
      </Suspense>

      {phase === 'loading' && (
        <section className="loading-screen" aria-live="polite" aria-label="Loading New York">
          <div className="loading-web" aria-hidden="true"><span /><span /><span /><span /></div>
          <div className="loading-logo"><small>Spider-Man</small><strong>New York</strong></div>
          <div className="loading-progress"><span style={{ width: `${progress}%` }} /></div>
          <div className="loading-readout"><span>{status}</span><strong>{progress}%</strong></div>
          <p>District streaming enabled · only nearby streets enter memory</p>
        </section>
      )}

      {phase === 'game' && (
        <>
          <header className="game-topbar">
            <div className="game-brand"><span>Spider-Man</span><strong>New York</strong></div>
            <div className="district-readout"><Navigation aria-hidden="true" /><span><small>Current sector</small><strong>{activeDistrict.name}</strong></span></div>
            <div className={`stream-state ${status.includes('Streaming') || status.includes('Opening') ? 'busy' : ''}`}><Radio aria-hidden="true" /><span>{status}</span></div>
          </header>

          <aside className="telemetry" aria-label="Traversal telemetry">
            <div><Gauge aria-hidden="true" /><span><strong>{hud.speed}</strong><small>km/h</small></span></div>
            <div><Move3d aria-hidden="true" /><span><strong>{hud.altitude}</strong><small>meters</small></span></div>
            <div><Activity aria-hidden="true" /><span><strong>{hud.fps}</strong><small>fps</small></span></div>
          </aside>

          <div className={`swing-indicator ${hud.swinging ? 'active' : ''}`}><span className="web-orb" /><div><small>Web line</small><strong>{hud.swinging ? 'Attached' : 'Ready'}</strong></div></div>
          <div className="reticle" aria-hidden="true"><span /><i /></div>

          <aside className="controls-card">
            <div><kbd>WASD</kbd><span>Move</span></div>
            <div><kbd>↑ ↓ ← →</kbd><span>Look</span></div>
            <div><kbd>Space</kbd><span>Hold to swing</span></div>
            <div><kbd>Click</kbd><span>Web to pointer</span></div>
            <Rotate3d aria-hidden="true" />
          </aside>

          <SpideyTracker open={trackerOpen} current={currentDistrict} loaded={loadedDistricts} onClose={() => setTrackerOpen(false)} onOpen={() => setTrackerOpen(true)} onTravel={travelTo} />
        </>
      )}
    </main>
  );
}
