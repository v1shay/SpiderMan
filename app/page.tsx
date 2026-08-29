'use client';

import { Activity, Gauge, Move3d, Navigation, Radio, Rotate3d } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { GameHud, SpiderGameHandle } from '@/components/game/SpiderGame';
import { SpideyTracker } from '@/components/game/SpideyTracker';
import SuitShowroom from '@/components/game/SuitShowroom';
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
  const [currentDistrict, setCurrentDistrict] = useState<DistrictId>('new-york-buildings');
  const [hud, setHud] = useState<GameHud>({ speed: 0, altitude: 0, fps: 60, swinging: false });
  const [showroomStatus, setShowroomStatus] = useState({ message: 'Opening Avengers warehouse', progress: 0 });
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
        <SuitShowroom
          selected={selected}
          onSelect={setSelected}
          onStatus={(message, nextProgress) => setShowroomStatus({ message, progress: Math.round(nextProgress) })}
        />
        <div className="warehouse-vignette" aria-hidden="true" />
        <header className="launch-header">
          <div className="brand-lockup" aria-label="New York Spider-Man"><span className="brand-kicker">Spider-Man</span><span className="brand-title">New York</span></div>
          <div className="system-ready"><span /> {showroomStatus.message} · {showroomStatus.progress}%</div>
        </header>

        <section className="selector-shell" aria-labelledby="select-heading">
          <div className="selector-heading">
            <div><p className="eyebrow">Avengers warehouse // 08 heroes online</p><h1 id="select-heading">Choose your hero</h1></div>
            <p className="selector-copy">Move across the lineup and click a real rigged model to select it.</p>
          </div>
          <ul className="suit-roster" aria-label="Available heroes and Spider-Man suits">
            {SUITS.map((suit, index) => (
              <li key={suit.id}>
                <button className={`suit-chip ${selected === suit.id ? 'is-selected' : ''}`} onClick={() => setSelected(suit.id)} type="button" aria-pressed={selected === suit.id}>
                  <span>0{index + 1}</span>
                  <strong>{suit.name}</strong>
                  <small>{suit.universe}</small>
                </button>
              </li>
            ))}
          </ul>
          <footer className="selector-footer">
            <div className="selection-readout"><span>Selected hero</span><strong>{activeSuit.name}</strong></div>
            <button className="enter-city" type="button" onClick={enterCity} disabled={showroomStatus.progress < 100}>
              {showroomStatus.progress < 100 ? 'Assembling suits' : 'Enter New York'} <span aria-hidden="true">→</span>
            </button>
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
            <div className="game-brand"><span>{activeSuit.traversal === 'ironman' ? 'Iron Man' : 'Spider-Man'}</span><strong>New York</strong></div>
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
            <div><kbd>Space</kbd><span>{activeSuit.traversal === 'ironman' ? 'Repulsor ascent' : 'Jump / swing'}</span></div>
            <div><kbd>Click</kbd><span>{activeSuit.traversal === 'ironman' ? 'Boost cruise' : 'Web / zip'}</span></div>
            <div><kbd>E</kbd><span>{activeSuit.traversal === 'ironman' ? 'Repulsor boost' : 'Zip / point launch'}</span></div>
            <div><kbd>Shift</kbd><span>{activeSuit.traversal === 'ironman' ? 'Descend' : 'Dive'}</span></div>
            {activeSuit.traversal === 'spider' && <div><kbd>Q</kbd><span>Wall crawl</span></div>}
            <Rotate3d aria-hidden="true" />
          </aside>

          <SpideyTracker open={trackerOpen} current={currentDistrict} loaded={loadedDistricts} onClose={() => setTrackerOpen(false)} onOpen={() => setTrackerOpen(true)} onTravel={travelTo} />
        </>
      )}
    </main>
  );
}
